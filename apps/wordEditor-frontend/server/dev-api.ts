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
  /** Word 「修改密码」（writeProtection），空则不设置 */
  password?: string;
  headerText?: string;
  headerAlign?: 'left' | 'center' | 'right';
  headerVerticalAlign?: 'top' | 'center' | 'bottom';
  footerText?: string;
  footerAlign?: 'left' | 'center' | 'right';
  footerVerticalAlign?: 'top' | 'center' | 'bottom';
}

export interface BuildProvenance {
  author?: string;
  remark?: string;
  title?: string;
}

function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  const pandocBin = findPandocBin();
  if (pandocBin) {
    const pandocDir = path.dirname(pandocBin);
    env.PATH = `${pandocDir}${path.delimiter}${env.PATH ?? ''}`;
    if (!env.PANDOC) env.PANDOC = pandocBin;
  }
  return env;
}

function findPandocBinInRepoTools(): string | null {
  const toolsDir = path.join(REPO_ROOT, '.tools');
  if (!fs.existsSync(toolsDir)) return null;
  const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!/pandoc/i.test(e.name)) continue;
    const base = path.join(toolsDir, e.name);
    candidates.push(path.join(base, 'bin', process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'));
    candidates.push(path.join(base, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'));
    candidates.push(path.join(base, 'bin', 'pandoc.exe'));
    candidates.push(path.join(base, 'bin', 'pandoc'));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** 将 WinGet / Homebrew / 仓库内置工具目录加入 PATH，便于子进程与 Pandoc 插件 */
function findPandocBin(): string | null {
  const fromEnv = process.env.PANDOC;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const repoTool = findPandocBinInRepoTools();
  if (repoTool) return repoTool;

  if (process.platform !== 'win32') {
    const fixed = ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc'];
    for (const p of fixed) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const fixed = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
    path.join(home, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
  ];
  for (const exe of fixed) {
    if (fs.existsSync(exe)) return exe;
  }
  const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(winget)) return null;
  for (const name of fs.readdirSync(winget)) {
    if (!/pandoc/i.test(name)) continue;
    const pkgDir = path.join(winget, name);
    const found = findPandocExeInDir(pkgDir);
    if (found) return found;
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
  provenance?: BuildProvenance,
): string[] {
  const scriptArgs = [
    path.join(REPO_ROOT, 'services', 'api-python', 'pipeline', 'build.py'),
    '-i',
    inputMd,
    '-o',
    outputDocx,
    '-t',
    templateId,
  ];
  if (options.noHtmlPipe) scriptArgs.push('--no-html-pipe');
  if (options.noPostprocess) scriptArgs.push('--no-postprocess');
  if (options.password) scriptArgs.push('--password-env', 'WORDEDITOR_DOCX_PASSWORD');
  const optionFlags: Array<[keyof BuildApiOptions, string]> = [
    ['headerText', '--header-text'],
    ['headerAlign', '--header-align'],
    ['headerVerticalAlign', '--header-vertical-align'],
    ['footerText', '--footer-text'],
    ['footerAlign', '--footer-align'],
    ['footerVerticalAlign', '--footer-vertical-align'],
  ];
  for (const [key, flag] of optionFlags) {
    const value = options[key];
    if (value != null) scriptArgs.push(flag, String(value));
  }
  if (provenance?.author?.trim()) scriptArgs.push('--author', provenance.author.trim());
  if (provenance?.remark != null && provenance.remark.trim()) {
    scriptArgs.push('--remark', provenance.remark.trim());
  }
  if (provenance?.title?.trim()) scriptArgs.push('--doc-title', provenance.title.trim());
  return scriptArgs;
}

function sanitizeDownloadName(name: string): string {
  const base = path.basename(name || 'export.docx');
  const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff\s]/g, '_').trim();
  return cleaned.endsWith('.docx') ? cleaned : `${cleaned || 'export'}.docx`;
}

function sanitizeImportName(name: string): string {
  const base = path.basename(name || 'input.docx');
  const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff\s]/g, '_').trim() || 'input.docx';
  return cleaned.toLowerCase().endsWith('.docx') ? cleaned : `${cleaned}.docx`;
}

function slugify(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\.docx$/i, '')
    .replace(/[\s\\/]+/g, '-')
    .replace(/[^\w\-\u4e00-\u9fff]/g, '');
  return cleaned || 'doc';
}

function runExtract(
  inputDocx: string,
  outputMd: string,
  imageDir: string,
  imageRel: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnPython(
      [
        path.join(REPO_ROOT, 'services', 'api-python', 'pipeline', 'extract_docx_to_md.py'),
        '-i',
        inputDocx,
        '-o',
        outputMd,
        '--image-dir',
        imageDir,
        '--image-rel',
        imageRel,
      ],
      { cwd: REPO_ROOT, env: spawnEnv() },
    );
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stderr += d.toString();
    });
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
  if (t.includes('[apply_docx_metadata]')) {
    write('ooxml', 'finish', '文档属性已写入');
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
        path.join(REPO_ROOT, 'services', 'api-python', 'pipeline', 'preview_styles.py'),
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
  provenance?: BuildProvenance,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const env = spawnEnv();
    if (options.password) env.WORDEDITOR_DOCX_PASSWORD = options.password;
    const child = spawnPython(
      buildScriptArgs(inputMd, outputDocx, templateId, options, provenance),
      {
        cwd: REPO_ROOT,
        env,
      },
    );
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
            path.join(REPO_ROOT, 'services', 'api-python', 'pipeline', 'tool_paths.py'),
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

    if (req.method === 'GET' && pathname === '/templates/reference-styles') {
      const templateId = url.searchParams.get('template');
      if (!templateId || !/^[\w-]+$/.test(templateId)) {
        sendJson(res, 400, { error: 'template 参数缺失或非法' });
        return;
      }
      void (async () => {
        try {
          const out = await runPythonJson([
            path.join(REPO_ROOT, 'services', 'api-python', 'pipeline', 'list_reference_styles.py'),
            '-t',
            templateId,
            '--json',
          ]);
          sendJson(res, 200, JSON.parse(out));
        } catch (e) {
          sendJson(res, 500, { error: String(e) });
        }
      })();
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
          // 上传文件夹时 body 可能为数 MB，放宽到 96MB
          const raw = await readBody(req, 96 * 1024 * 1024);
          const body = JSON.parse(raw) as {
            markdown?: string;
            entries?: { relPath: string; contentBase64: string }[];
            mdRelPath?: string;
            templateId?: string;
            fileName?: string;
            options?: BuildApiOptions;
            provenance?: BuildProvenance;
          };
          if (!body.templateId) {
            sendJson(res, 400, { error: 'templateId is required' });
            return;
          }
          const useEntries = Array.isArray(body.entries) && body.entries.length > 0;
          if (!useEntries && !body.markdown?.trim()) {
            sendJson(res, 400, { error: 'markdown 或 entries 必填' });
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

          const pushStep = (id: string, status: string, message?: string) => {
            writeSse(res, 'step', { id, status, message });
          };

          let inputMd: string;
          let defaultName: string;

          if (useEntries) {
            pushStep('prepare', 'process', `写入 ${body.entries!.length} 个文件…`);
            const mdRel = (body.mdRelPath ?? '').trim();
            if (!mdRel || !/\.md$/i.test(mdRel)) {
              writeSse(res, 'error', { error: 'mdRelPath 必须指向 .md' });
              res.end();
              return;
            }
            // 安全落盘：防止 .. 穿越
            for (const ent of body.entries!) {
              const rel = path.normalize(ent.relPath).replace(/^([\\/])+/, '');
              const abs = path.join(workDir, rel);
              if (!abs.startsWith(workDir)) continue;
              // 跳过超过 20MB 的单个条目（base64 长度约为原始大小 * 1.37）
              if (ent.contentBase64.length > 20 * 1024 * 1024 * 1.37) continue;
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, Buffer.from(ent.contentBase64, 'base64'));
            }
            inputMd = path.join(workDir, path.normalize(mdRel).replace(/^([\\/])+/, ''));
            if (!fs.existsSync(inputMd)) {
              writeSse(res, 'error', { error: `mdRelPath 未在上传列表中: ${mdRel}` });
              res.end();
              return;
            }
            defaultName = `${path.basename(inputMd, path.extname(inputMd))}-${body.templateId}.docx`;
            pushStep('prepare', 'finish');
          } else {
            inputMd = path.join(workDir, 'input.md');
            defaultName = `export-${body.templateId}.docx`;
            pushStep('prepare', 'process', '写入 Markdown…');
            fs.writeFileSync(inputMd, body.markdown!, 'utf-8');
            pushStep('prepare', 'finish');
          }

          const outputDocx = path.join(workDir, 'output.docx');
          const fileName = sanitizeDownloadName(body.fileName || defaultName);
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
            body.provenance,
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

    if (req.method === 'POST' && pathname === '/import/docx') {
      void (async () => {
        try {
          // DOCX 通常 < 50MB；按 96MB 上限
          const raw = await readBody(req, 96 * 1024 * 1024);
          const body = JSON.parse(raw) as {
            filename?: string;
            contentBase64?: string;
            imageSlug?: string;
          };
          if (!body.contentBase64) {
            sendJson(res, 400, { error: 'contentBase64 is required' });
            return;
          }
          const filename = sanitizeImportName(body.filename ?? 'input.docx');
          const stem = filename.replace(/\.docx$/i, '') || 'document';
          const slug = (body.imageSlug && /^[\w\-]+$/.test(body.imageSlug)
            ? body.imageSlug
            : slugify(stem));

          const jobId = randomUUID();
          const workDir = path.join(CACHE_DIR, jobId);
          fs.mkdirSync(workDir, { recursive: true });
          const docxPath = path.join(workDir, filename);
          fs.writeFileSync(docxPath, Buffer.from(body.contentBase64, 'base64'));

          const mdPath = path.join(workDir, `${stem}.md`);
          const imageDir = path.join(workDir, 'images', slug);
          const imageRel = `images/${slug}`;

          const { code, stderr } = await runExtract(docxPath, mdPath, imageDir, imageRel);
          if (code !== 0 || !fs.existsSync(mdPath)) {
            sendJson(res, 500, {
              error: 'extract failed',
              detail: stderr.slice(-4000) || `exit code ${code}`,
              jobId,
            });
            return;
          }

          const markdown = fs.readFileSync(mdPath, 'utf-8');
          const entries: { relPath: string; contentBase64: string; size: number }[] = [];
          // 总是先把 md 自身作为 entry，便于后续“发送到导出页”
          entries.push({
            relPath: `${stem}.md`,
            contentBase64: Buffer.from(markdown, 'utf-8').toString('base64'),
            size: Buffer.byteLength(markdown, 'utf-8'),
          });
          if (fs.existsSync(imageDir)) {
            for (const name of fs.readdirSync(imageDir)) {
              const abs = path.join(imageDir, name);
              const st = fs.statSync(abs);
              if (!st.isFile()) continue;
              entries.push({
                relPath: `${imageRel}/${name}`,
                contentBase64: fs.readFileSync(abs).toString('base64'),
                size: st.size,
              });
            }
          }

          sendJson(res, 200, {
            jobId,
            fileName: `${stem}.md`,
            mdRelPath: `${stem}.md`,
            markdown,
            entries,
            log: stderr.slice(-4000),
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
