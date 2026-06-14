import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { BuildApiOptions, BuildProvenance, BuildRequestBody } from '../types/api.js';
import { findPandoc } from '../config/env.js';
import { applyDocxMetadata, applyStylesYaml } from './docx.service.js';
import { loadTemplatesConfig, resolveLuaFilters, resolveTemplate } from './template.service.js';
import { sanitizeDownloadName, sanitizeImportName, slugify } from '../utils/path.js';

interface ProcessResult {
  code: number;
  stderr: string;
}

type LineHandler = (stream: 'stdout' | 'stderr', line: string) => void;

function runProcess(command: string, args: string[], cwd: string, onLine?: LineHandler): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stderr = '';
    let outBuf = '';
    let errBuf = '';

    const flush = (stream: 'stdout' | 'stderr', chunk: string): void => {
      if (stream === 'stdout') {
        outBuf += chunk;
        const parts = outBuf.split(/\r?\n/);
        outBuf = parts.pop() || '';
        for (const line of parts) onLine?.('stdout', line);
      } else {
        errBuf += chunk;
        const parts = errBuf.split(/\r?\n/);
        errBuf = parts.pop() || '';
        for (const line of parts) {
          stderr += `${line}\n`;
          onLine?.('stderr', line);
        }
      }
    };

    child.stdout.on('data', (d) => flush('stdout', d.toString()));
    child.stderr.on('data', (d) => flush('stderr', d.toString()));

    child.on('error', (err) => {
      resolve({ code: 1, stderr: String(err) });
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
  if (t.includes('完成')) {
    write('pandoc', 'finish', 'DOCX 已生成');
    if (!options.noPostprocess) write('structure', 'wait');
  }
}

async function runPandocToDocx(
  repoRoot: string,
  inputMd: string,
  outputDocx: string,
  templateId: string,
  options: BuildApiOptions,
  onLine?: LineHandler,
): Promise<ProcessResult> {
  const pandoc = findPandoc();
  if (!pandoc) return { code: 1, stderr: '未检测到 Pandoc' };

  const cfg = loadTemplatesConfig(repoRoot);
  const template = resolveTemplate(cfg, templateId);
  const referenceDoc = path.join(repoRoot, template.reference_doc);
  const luaFilters = resolveLuaFilters(repoRoot, template);

  const args = [
    inputMd,
    '-o',
    outputDocx,
    '--reference-doc',
    referenceDoc,
    '--syntax-highlighting=none',
    `--resource-path=${path.dirname(inputMd)}`,
  ];

  for (const f of luaFilters) {
    args.push('--lua-filter', f);
  }

  if (options.noHtmlPipe) onLine?.('stdout', 'Node 后端: 直连 Pandoc 模式 (--no-html-pipe)');
  else onLine?.('stdout', 'Node 后端: 直连 Pandoc 模式 (默认)');

  return runProcess(pandoc, args, repoRoot, onLine);
}

export async function runStylePreview(
  repoRoot: string,
  cacheDir: string,
  templateId: string,
  stylesYaml: string,
): Promise<{ jobId: string; fileName: string; downloadUrl: string }> {
  const jobId = randomUUID();
  const workDir = path.join(cacheDir, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const stylesPath = path.join(workDir, 'styles.yaml');
  fs.writeFileSync(stylesPath, stylesYaml, 'utf-8');

  const inputMd = path.join(repoRoot, 'templates', 'hutb-shared', 'preview-styles.md');
  const outputDocx = path.join(workDir, 'output.docx');
  const result = await runPandocToDocx(repoRoot, inputMd, outputDocx, templateId, {}, undefined);
  if (result.code !== 0 || !fs.existsSync(outputDocx)) {
    throw new Error(result.stderr || `style preview failed: ${result.code}`);
  }

  await applyStylesYaml(outputDocx, stylesPath);
  const fileName = sanitizeDownloadName(`style-preview-${templateId}.docx`);
  return {
    jobId,
    fileName,
    downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${encodeURIComponent(fileName)}`,
  };
}

export async function runBuildStream(
  repoRoot: string,
  cacheDir: string,
  body: BuildRequestBody,
  writeStep: (id: string, status: string, message?: string) => void,
  writeLog: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<{ jobId: string; fileName: string; downloadUrl: string }> {
  const templateId = String(body.templateId || '');
  const options = body.options || {};
  const provenance = body.provenance || {};

  const useEntries = Array.isArray(body.entries) && body.entries.length > 0;
  const jobId = randomUUID();
  const workDir = path.join(cacheDir, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  let inputMd: string;
  let defaultName: string;

  if (useEntries) {
    writeStep('prepare', 'process', `写入 ${body.entries!.length} 个文件…`);
    const mdRel = String(body.mdRelPath || '').trim();
    if (!mdRel || !/\.md$/i.test(mdRel)) throw new Error('mdRelPath 必须指向 .md');

    for (const entry of body.entries!) {
      const rel = path.normalize(String(entry.relPath || '')).replace(/^([\\/])+/, '');
      const abs = path.join(workDir, rel);
      if (!abs.startsWith(workDir)) continue;
      const b64 = String(entry.contentBase64 || '');
      if (b64.length > 20 * 1024 * 1024 * 1.37) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
    }

    inputMd = path.join(workDir, path.normalize(mdRel).replace(/^([\\/])+/, ''));
    if (!fs.existsSync(inputMd)) throw new Error(`mdRelPath 未在上传列表中: ${mdRel}`);
    defaultName = `${path.basename(inputMd, path.extname(inputMd))}-${templateId}.docx`;
    writeStep('prepare', 'finish');
  } else {
    writeStep('prepare', 'process', '写入 Markdown…');
    inputMd = path.join(workDir, 'input.md');
    fs.writeFileSync(inputMd, String(body.markdown || ''), 'utf-8');
    defaultName = `export-${templateId}.docx`;
    writeStep('prepare', 'finish');
  }

  const outputDocx = path.join(workDir, 'output.docx');
  const fileName = sanitizeDownloadName(String(body.fileName || defaultName));

  writeStep('pandoc', 'process', '启动 Pandoc…');
  const result = await runPandocToDocx(repoRoot, inputMd, outputDocx, templateId, options, (stream, line) => {
    writeLog(line, stream);
    emitStepFromBuildLine(line, options, writeStep);
  });

  if (result.code !== 0 || !fs.existsSync(outputDocx)) {
    throw new Error(result.stderr || `build failed: ${result.code}`);
  }

  if (!options.noPostprocess) {
    writeStep('structure', 'process', '应用 Node 后处理…');
    const cfg = loadTemplatesConfig(repoRoot);
    const template = resolveTemplate(cfg, templateId);
    if (template.styles_yaml) {
      await applyStylesYaml(outputDocx, path.join(repoRoot, template.styles_yaml));
    }
    if (provenance.author || provenance.remark || provenance.title) {
      await applyDocxMetadata(outputDocx, {
        author: provenance.author,
        remark: provenance.remark,
        title: provenance.title || fileName,
      });
    }
    writeStep('structure', 'finish', '后处理完成');
    writeStep('ooxml', 'finish', 'styles.yaml 已应用（Node 版）');
    if (options.password) {
      writeLog('提示: Node 版暂不支持 DOCX 修改密码，已忽略该参数。', 'stderr');
    }
  } else {
    writeStep('pandoc', 'finish', '构建完成');
  }

  return {
    jobId,
    fileName,
    downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${encodeURIComponent(fileName)}`,
  };
}

async function runPandocDocxToMarkdown(
  repoRoot: string,
  inputDocx: string,
  outputMd: string,
  extractMediaDir: string,
): Promise<ProcessResult> {
  const pandoc = findPandoc();
  if (!pandoc) return { code: 1, stderr: '未检测到 Pandoc' };

  const args = [
    inputDocx,
    '-f',
    'docx',
    '-t',
    'markdown+tex_math_dollars+tex_math_single_backslash',
    '--wrap=none',
    '--extract-media',
    extractMediaDir,
    '-o',
    outputMd,
  ];
  return runProcess(pandoc, args, repoRoot);
}

function rewritePandocMediaLinks(markdown: string, slug: string): string {
  const target = `images/${slug}`;
  return markdown.replace(/\((?:[^)]*?)media\/(.*?)\)/g, `(${target}/$1)`);
}

function collectFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      if (entry.isFile()) out.push(abs);
    }
  }
  return out;
}

export async function runImportDocx(
  repoRoot: string,
  cacheDir: string,
  payload: { filename?: string; contentBase64?: string; imageSlug?: string },
): Promise<{ jobId: string; fileName: string; mdRelPath: string; markdown: string; entries: Array<{ relPath: string; contentBase64: string; size: number }>; log?: string }> {
  if (!payload.contentBase64) throw new Error('contentBase64 is required');

  const filename = sanitizeImportName(payload.filename || 'input.docx');
  const stem = filename.replace(/\.docx$/i, '') || 'document';
  const slug = payload.imageSlug && /^[\w\-]+$/.test(payload.imageSlug)
    ? payload.imageSlug
    : slugify(stem);

  const jobId = randomUUID();
  const workDir = path.join(cacheDir, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const docxPath = path.join(workDir, filename);
  const mdPath = path.join(workDir, `${stem}.md`);
  const extractRoot = path.join(workDir, 'pandoc-extract');
  const imageDir = path.join(workDir, 'images', slug);

  fs.writeFileSync(docxPath, Buffer.from(payload.contentBase64, 'base64'));

  const result = await runPandocDocxToMarkdown(repoRoot, docxPath, mdPath, extractRoot);
  if (result.code !== 0 || !fs.existsSync(mdPath)) {
    throw new Error(result.stderr || `extract failed: ${result.code}`);
  }

  fs.mkdirSync(imageDir, { recursive: true });
  const mediaDir = path.join(extractRoot, 'media');
  if (fs.existsSync(mediaDir)) {
    for (const src of collectFilesRecursive(mediaDir)) {
      const rel = path.relative(mediaDir, src);
      const dst = path.join(imageDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  let markdown = fs.readFileSync(mdPath, 'utf-8');
  markdown = rewritePandocMediaLinks(markdown, slug);
  fs.writeFileSync(mdPath, markdown, 'utf-8');

  const entries: Array<{ relPath: string; contentBase64: string; size: number }> = [
    {
      relPath: `${stem}.md`,
      contentBase64: Buffer.from(markdown, 'utf-8').toString('base64'),
      size: Buffer.byteLength(markdown, 'utf-8'),
    },
  ];

  for (const abs of collectFilesRecursive(imageDir)) {
    const stat = fs.statSync(abs);
    entries.push({
      relPath: path.relative(workDir, abs).replace(/\\/g, '/'),
      contentBase64: fs.readFileSync(abs).toString('base64'),
      size: stat.size,
    });
  }

  return {
    jobId,
    fileName: `${stem}.md`,
    mdRelPath: `${stem}.md`,
    markdown,
    entries,
    log: result.stderr.slice(-4000),
  };
}
