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

function buildScriptArgs(
  inputMd: string,
  outputDocx: string,
  templateId: string,
  options: BuildApiOptions,
): string[] {
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
  return scriptArgs;
}

function sanitizeDownloadName(name: string): string {
  const base = path.basename(name || 'export.docx');
  const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff\s]/g, '_').trim();
  return cleaned.endsWith('.docx') ? cleaned : `${cleaned || 'export'}.docx`;
}

type BuildLineHandler = (stream: 'stdout' | 'stderr', line: string) => void;

function emitStepFromBuildLine(
  line: string,
  options: BuildApiOptions,
  write: (id: string, status: string, message?: string) => void,
): void {
  const t = line.trim();
  if (!t) return;
  if (t.includes('模板:') || t.startsWith('输入:')) {
    write('prepare', 'finish');
    write('pandoc', 'process', 'Pandoc 转换中…');
  }
  if (t === '完成。') {
    write('pandoc', 'finish', 'DOCX 已生成');
    if (!options.noPostprocess) write('structure', 'wait');
  }
  if (t.includes('[后处理] 标题识别') || t.includes('[postprocess_headings]')) {
    write('structure', 'process', '标题与交叉引用…');
  }
  if (t.includes('[postprocess_document] 完成')) {
    write('structure', 'finish');
  }
  if (t.includes('注入 OOXML') || t.includes('[postprocess_styles]')) {
    if (!t.includes('完成')) write('ooxml', 'process', '注入 styles.yaml…');
  }
  if (t.includes('[postprocess_styles] 完成')) {
    write('ooxml', 'finish');
  }
}

function runStylePreview(
  templateId: string,
  outputDocx: string,
  stylesYaml: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnPython(
      [
        path.join(REPO_ROOT, 'scripts', 'preview_styles.py'),
        '-t',
        templateId,
        '-o',
        outputDocx,
        '--styles',
        stylesYaml,
      ],
      { cwd: REPO_ROOT, env: spawnEnv() },
    );
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.stdout?.on('data', (d) => {
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

function runBuild(
  inputMd: string,
  outputDocx: string,
  templateId: string,
  options: BuildApiOptions,
  onLine?: BuildLineHandler,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnPython(buildScriptArgs(inputMd, outputDocx, templateId, options), {
      cwd: REPO_ROOT,
      env: spawnEnv(),
    });
    let stderr = '';
    let outBuf = '';
    let errBuf = '';

    const flush = (stream: 'stdout' | 'stderr', chunk: string) => {
      const bufRef = stream === 'stdout' ? { get: () => outBuf, set: (v: string) => { outBuf = v; } } : { get: () => errBuf, set: (v: string) => { errBuf = v; } };
      bufRef.set(bufRef.get() + chunk);
      const parts = bufRef.get().split(/\r?\n/);
      bufRef.set(parts.pop() ?? '');
      for (const line of parts) {
        if (stream === 'stderr') stderr += `${line}\n`;
        onLine?.(stream, line);
      }
    };

    child.stdout?.on('data', (d) => flush('stdout', d.toString()));
    child.stderr?.on('data', (d) => flush('stderr', d.toString()));
    child.on('error', (err) => {
      const py = resolvePython();
      stderr += `无法启动 Python (${py.command}): ${err.message}\n`;
      resolve({ code: 1, stderr });
    });
    child.on('close', (code) => {
      if (outBuf.trim()) onLine?.('stdout', outBuf.trim());
      if (errBuf.trim()) {
        stderr += `${errBuf}\n`;
        onLine?.('stderr', errBuf.trim());
      }
      resolve({ code: code ?? 1, stderr });
    });
  });
}

function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
      const fileName = sanitizeDownloadName(url.searchParams.get('fileName') ?? 'export.docx');
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      fs.createReadStream(docx).pipe(res);
      return;
    }

    if (req.method === 'POST' && pathname === '/preview/styles') {
      void (async () => {
        try {
          const raw = await readBody(req);
          const body = JSON.parse(raw) as {
            templateId?: string;
            stylesYaml?: string;
          };
          if (!body.templateId) {
            sendJson(res, 400, { error: 'templateId is required' });
            return;
          }
          if (!body.stylesYaml?.trim()) {
            sendJson(res, 400, { error: 'stylesYaml is required' });
            return;
          }

          const jobId = randomUUID();
          const workDir = path.join(CACHE_DIR, jobId);
          fs.mkdirSync(workDir, { recursive: true });
          const stylesPath = path.join(workDir, 'styles.yaml');
          const outputDocx = path.join(workDir, 'output.docx');
          fs.writeFileSync(stylesPath, body.stylesYaml, 'utf-8');

          const { code, stderr } = await runStylePreview(
            body.templateId,
            outputDocx,
            stylesPath,
          );

          if (code !== 0 || !fs.existsSync(outputDocx)) {
            sendJson(res, 500, {
              error: 'style preview failed',
              detail: stderr.slice(-4000) || `exit code ${code}`,
              jobId,
            });
            return;
          }

          const fileName = sanitizeDownloadName(`style-preview-${body.templateId}.docx`);
          sendJson(res, 200, {
            jobId,
            fileName,
            downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${encodeURIComponent(fileName)}`,
          });
        } catch (e) {
          sendJson(res, 500, { error: String(e) });
        }
      })();
      return;
    }

    if (req.method === 'POST' && pathname === '/build/stream') {
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

          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });

          const options = body.options ?? {};
          const jobId = randomUUID();
          const workDir = path.join(CACHE_DIR, jobId);
          fs.mkdirSync(workDir, { recursive: true });
          const inputMd = path.join(workDir, 'input.md');
          const outputDocx = path.join(workDir, 'output.docx');
          const fileName = sanitizeDownloadName(body.fileName ?? `export-${body.templateId}.docx`);

          const pushStep = (id: string, status: string, message?: string) => {
            writeSse(res, 'step', { id, status, message });
          };

          pushStep('prepare', 'process', '写入 Markdown…');
          fs.writeFileSync(inputMd, body.markdown, 'utf-8');
          pushStep('prepare', 'finish');
          pushStep('pandoc', 'process', '启动 Pandoc…');

          const { code, stderr } = await runBuild(
            inputMd,
            outputDocx,
            body.templateId,
            options,
            (stream, line) => {
              writeSse(res, 'log', { line, stream });
              emitStepFromBuildLine(line, options, pushStep);
            },
          );

          if (code !== 0 || !fs.existsSync(outputDocx)) {
            writeSse(res, 'error', {
              error: 'build failed',
              detail: stderr.slice(-4000) || `exit code ${code}`,
              jobId,
            });
            res.end();
            return;
          }

          if (options.noPostprocess) {
            pushStep('pandoc', 'finish', '构建完成');
          }

          writeSse(res, 'done', {
            jobId,
            fileName,
            downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${encodeURIComponent(fileName)}`,
          });
          res.end();
        } catch (e) {
          if (!res.headersSent) {
            sendJson(res, 500, { error: String(e) });
          } else {
            writeSse(res, 'error', { error: String(e) });
            res.end();
          }
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
