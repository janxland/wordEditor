/**
 * 重任务并发闸门：构建 / 样式预览 / 导入各拉起一个 RSS 300~400MB 的 Pandoc 子进程，
 * 不设上限就是「来多少请求并发多少」，机型稍小即被 OOM。零依赖信号量：槽满排队，
 * 队列位次可反馈给前端（SSE 日志）。
 */
import os from 'node:os';

/** 单路重任务按 400MB 计（实测构建树峰 323MB、样式预览 431MB），只用一半物理内存。 */
const BYTES_PER_SLOT = 400 * 1024 * 1024;

export function defaultConcurrency(): number {
  const byMem = Math.floor((os.totalmem() * 0.5) / BYTES_PER_SLOT);
  return Math.max(1, Math.min(8, byMem));
}

const fromEnv = Number.parseInt(process.env.WORDEDITOR_MAX_CONCURRENCY ?? '', 10);
export const MAX_CONCURRENCY = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : defaultConcurrency();

let running = 0;
const waiting: (() => void)[] = [];

/** 拿到槽位后执行 task；排队期间回调 onQueued(队列中位次)，用于 SSE 反馈。 */
export async function withSlot<T>(
  task: () => Promise<T>,
  onQueued?: (position: number) => void,
): Promise<T> {
  if (running >= MAX_CONCURRENCY) {
    onQueued?.(waiting.length + 1);
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
