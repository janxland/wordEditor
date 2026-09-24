/** 任务工作区：每个任务一个 .cache/wordeditor-api-node/<jobId>/ 目录。 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isFile, MAX_ENTRY_B64_CHARS } from '../config.js';
import { sanitizeDownloadName } from '../pipeline/naming.js';

export interface Job {
  id: string;
  dir: string;
  outputDocx: string;
}

export function createJob(cacheDir: string): Job {
  const id = randomUUID();
  const dir = path.join(cacheDir, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir, outputDocx: path.join(dir, 'output.docx') };
}

export function jobDocxPath(cacheDir: string, jobId: string): string {
  return path.join(cacheDir, jobId, 'output.docx');
}

export interface UploadEntry {
  relPath: string;
  contentBase64: string;
}

export interface MaterializedInput {
  inputMd: string;
  defaultFileName: string;
  /** 跳过的条目数（越界路径或超大文件），用于回给前端的告警日志。 */
  skipped: number;
}

function insideWorkDir(workDir: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) return null;
  const abs = path.resolve(workDir, cleaned);
  return abs === workDir || abs.startsWith(workDir + path.sep) ? abs : null;
}

/** 前端「上传整个文件夹」模式：落盘全部条目后按 mdRelPath 定位主 Markdown。 */
export function writeUploadEntries(
  job: Job,
  entries: UploadEntry[],
  mdRelPath: string,
  templateId: string,
): MaterializedInput {
  const rel = mdRelPath.replace(/\\/g, '/').replace(/^\/+/, '');

  let skipped = 0;
  for (const entry of entries) {
    const abs = insideWorkDir(job.dir, String(entry.relPath ?? ''));
    const b64 = String(entry.contentBase64 ?? '');
    if (!abs || b64.length > MAX_ENTRY_B64_CHARS) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  }

  const inputMd = insideWorkDir(job.dir, rel);
  if (!inputMd || !isFile(inputMd)) {
    throw new Error(`mdRelPath 未在上传列表中: ${mdRelPath}`);
  }
  const stem = path.basename(inputMd, path.extname(inputMd));
  return {
    inputMd,
    defaultFileName: sanitizeDownloadName(`${stem}-${templateId}.docx`),
    skipped,
  };
}

/** 纯 Markdown 模式（无附件）。 */
export function writeMarkdown(job: Job, markdown: string, templateId: string): MaterializedInput {
  const inputMd = path.join(job.dir, 'input.md');
  fs.writeFileSync(inputMd, markdown, 'utf-8');
  return {
    inputMd,
    defaultFileName: sanitizeDownloadName(`export-${templateId}.docx`),
    skipped: 0,
  };
}
