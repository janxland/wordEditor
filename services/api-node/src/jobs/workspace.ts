/** 任务工作区：每个任务一个 .cache/wordeditor-api-node/<jobId>/ 目录。 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isFile, MAX_ENTRY_B64_CHARS } from '../config.js';
import { insideDir } from '../fs-utils.js';
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

/**
 * 请求失败即回收：jobId/产物从未回给调用方，目录（含已落盘的上传内容）
 * 留到 6 小时 TTL 纯属垃圾，坏请求一多 .cache 就线性膨胀。
 */
export function dropJob(job: Job): void {
  fs.rmSync(job.dir, { recursive: true, force: true });
}

/** 任务目录从最后一次写入起保留多久（分钟）；下载链接指向盘上的 output.docx，不能即用即删。 */
const JOB_TTL_MINUTES = Number.parseInt(process.env.WORDEDITOR_JOB_TTL_MINUTES ?? '', 10) || 360;

/**
 * 回收过期任务目录：一次构建会落盘输入、图片与产物，不回收就只增不减
 * （实测跑了几轮回归后堆到 217 个目录 / 151MB）。返回删除个数。
 */
export function pruneJobs(cacheDir: string, now = Date.now()): number {
  const ttlMs = JOB_TTL_MINUTES * 60_000;
  let removed = 0;
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(cacheDir, entry.name);
    // 逐条目容错：单个目录抛错（权限、双实例并发的删除竞态）不能中断整轮，
    // 否则 readdir 序里排在它后面的过期目录永远清不掉。
    try {
      if (now - fs.statSync(dir).mtimeMs < ttlMs) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* 坏条目留给下一轮或人工处置 */
    }
  }
  return removed;
}

/** 启动清一次 + 定期巡检；定时器 unref，不阻止进程退出。 */
export function startJobJanitor(cacheDir: string): void {
  const sweep = (): void => {
    try {
      pruneJobs(cacheDir);
    } catch {
      /* 巡检失败等下一轮，不影响请求路径 */
    }
  };
  sweep();
  setInterval(sweep, 15 * 60_000).unref();
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
    const abs = insideDir(job.dir, String(entry.relPath ?? ''));
    const b64 = String(entry.contentBase64 ?? '');
    if (!abs || b64.length > MAX_ENTRY_B64_CHARS) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  }

  const inputMd = insideDir(job.dir, rel);
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
