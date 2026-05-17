import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { resolvePython, spawnPython } from './pythonResolve';

export const REPO_ROOT = path.resolve(__dirname, '../../..');
const CACHE_DIR = path.join(REPO_ROOT, '.cache', 'wordeditor-ui');
const MAX_BODY = 12 * 1024 * 1024;

export function safeResolve(rel: string): string | null {
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  const abs = path.resolve(REPO_ROOT, normalized);
  if (!abs.startsWith(REPO_ROOT)) return null;
  return abs;
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export interface BuildApiOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
  withFormulaMacro?: boolean;
  renderMath?: boolean;
}

function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  const pandocDir = findPandocDirForPath();
  if (pandocDir) {
    env.PATH = `${pandocDir}${path.delimiter}${env.PATH ?? ''}`;
    if (!env.PANDOC) {
      env.PANDOC = path.join(pandocDir, 'pandoc.exe');
    }
  }
  return env;
}

/** 将 WinGet 等非常规安装目录加入 PATH，便于子进程与 Pandoc 插件 */
function findPandocDirForPath(): string | null {
  const fromEnv = process.env.PANDOC;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.dirname(fromEnv);
  }
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const fixed = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
    path.join(home, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
  ];
  for (const exe of fixed) {
    if (fs.existsSync(exe)) return path.dirname(exe);
  }
  const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(winget)) return null;
  for (const name of fs.readdirSync(winget)) {
    if (!/pandoc/i.test(name)) continue;
    const pkgDir = path.join(winget, name);
    const found = findPandocExeInDir(pkgDir);
    if (found) return path.dirname(found);
  }
  return null;
}

function findPandocExeInDir(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === 'pandoc.exe') return full;
    if (e.isDirectory()) {
      const nested = findPandocExeInDir(full);
      if (nested) return nested;
    }
  }
  return null;
}

function runPythonJson(scriptArgs: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnPython(scriptArgs, {
      cwd: REPO_ROOT,
      env: spawnEnv(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      const py = resolvePython();
      reject(
        new Error(
          `无法启动 Python (${py.command}): ${err.message}。请激活 Conda 或设置 WORDEDITOR_PYTHON。`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `exit ${code}`));
      else resolve(stdout);
    });
  });
}

function runBuild(
  inputMd: string,
  outputDocx: string,
  templateId: string,
  options: BuildApiOptions,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const scriptArgs = [
      path.join(REPO_ROOT, 'scripts', 'build.py'),
      '-i',
      inputMd,
      '-o',
      outputDocx,
      '-t',
      templateId,
    ];
    if (options.noHtmlPipe) scriptArgs.push('--no-html-pipe');
    if (options.noPostprocess) scriptArgs.push('--no-postprocess');
    if (options.withFormulaMacro) scriptArgs.push('--with-formula-macro');
    if (options.renderMath) scriptArgs.push('--render-math');

    const child = spawnPython(scriptArgs, {
      cwd: REPO_ROOT,
      env: spawnEnv(),
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      const py = resolvePython();
      stderr += `无法启动 Python (${py.command}): ${err.message}\n`;
      resolve({ code: 1, stderr });
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export function createDevApiMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, repo: REPO_ROOT });
      return;
    }

    if (req.method === 'GET' && pathname === '/tools') {
      void (async () => {
        try {
          const out = await runPythonJson([
            path.join(REPO_ROOT, 'scripts', 'tool_paths.py'),
            '--json',
          ]);
          sendJson(res, 200, JSON.parse(out));
        } catch (e) {
          sendJson(res, 500, { error: String(e) });
        }
      })();
      return;
    }

    if (req.method === 'GET' && pathname === '/templates') {
      const p = path.join(REPO_ROOT, 'config', 'templates.json');
      try {
        sendJson(res, 200, JSON.parse(fs.readFileSync(p, 'utf-8')));
      } catch (e) {
        sendJson(res, 500, { error: String(e) });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/macros') {
      try {
        const dir = path.join(REPO_ROOT, 'macros');
        const files = fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.bas'))
          .map((f) => ({ name: f.replace(/\.bas$/, ''), file: `macros/${f}` }));
        sendJson(res, 200, files);
      } catch (e) {
        sendJson(res, 500, { error: String(e) });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/docs') {
      const name = url.searchParams.get('name');
      if (!name || !/^[\w-]+\.md$/.test(name)) {
        sendJson(res, 400, { error: 'invalid doc name' });
        return;
      }
      const abs = safeResolve(path.join('docs', name));
      if (!abs) {
        sendJson(res, 400, { error: 'invalid path' });
        return;
      }
      try {
        sendJson(res, 200, { content: fs.readFileSync(abs, 'utf-8') });
      } catch (e) {
        sendJson(res, 404, { error: String(e) });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/build/download') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId || !/^[\w-]+$/.test(jobId)) {
        sendJson(res, 400, { error: 'invalid jobId' });
        return;
      }
      const docx = path.join(CACHE_DIR, jobId, 'output.docx');
      if (!fs.existsSync(docx)) {
        sendJson(res, 404, { error: 'file not found or expired' });
        return;
      }
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="wordeditor-${jobId.slice(0, 8)}.docx"`,
      );
      fs.createReadStream(docx).pipe(res);
      return;
    }

    if (req.method === 'POST' && pathname === '/build') {
      void (async () => {
        try {
          const raw = await readBody(req);
          const body = JSON.parse(raw) as {
            markdown?: string;
            templateId?: string;
            fileName?: string;
            options?: BuildApiOptions;
          };
          if (!body.markdown?.trim()) {
            sendJson(res, 400, { error: 'markdown is required' });
            return;
          }
          if (!body.templateId) {
            sendJson(res, 400, { error: 'templateId is required' });
            return;
          }

          const jobId = randomUUID();
          const workDir = path.join(CACHE_DIR, jobId);
          fs.mkdirSync(workDir, { recursive: true });
          const inputMd = path.join(workDir, 'input.md');
          const outputDocx = path.join(workDir, 'output.docx');
          fs.writeFileSync(inputMd, body.markdown, 'utf-8');

          const { code, stderr } = await runBuild(
            inputMd,
            outputDocx,
            body.templateId,
            body.options ?? {},
          );

          if (code !== 0 || !fs.existsSync(outputDocx)) {
            sendJson(res, 500, {
              error: 'build failed',
              detail: stderr.slice(-4000) || `exit code ${code}`,
              jobId,
            });
            return;
          }

          sendJson(res, 200, {
            jobId,
            fileName: body.fileName ?? `export-${body.templateId}.docx`,
            downloadUrl: `/api/build/download?jobId=${jobId}`,
          });
        } catch (e) {
          sendJson(res, 500, { error: String(e) });
        }
      })();
      return;
    }

    if (pathname === '/file') {
      const rel = url.searchParams.get('path');
      if (!rel) {
        sendJson(res, 400, { error: 'path required' });
        return;
      }
      const abs = safeResolve(rel);
      if (!abs) {
        sendJson(res, 400, { error: 'invalid path' });
        return;
      }

      if (req.method === 'GET') {
        try {
          sendJson(res, 200, { content: fs.readFileSync(abs, 'utf-8') });
        } catch (e) {
          sendJson(res, 404, { error: String(e) });
        }
        return;
      }

      if (req.method === 'PUT') {
        void (async () => {
          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as { content?: string };
            if (typeof body.content !== 'string') {
              sendJson(res, 400, { error: 'content required' });
              return;
            }
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body.content, 'utf-8');
            sendJson(res, 200, { ok: true });
          } catch (e) {
            sendJson(res, 500, { error: String(e) });
          }
        })();
        return;
      }
    }

    next();
  };
}
