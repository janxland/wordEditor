/**
 * 「读+解析」缓存：templates.json / preview-cdn.json / reference.docx 每请求都要重解，
 * 键里带 (mtime, size)，所以改文件立刻生效、不必重启。按最近使用淘汰，
 * 免得任何按路径增长的解析结果变成只增不减的常驻内存。
 */
import fs from 'node:fs';

const MAX_ENTRIES = 32;

const memo = new Map<string, { key: string; value: unknown }>();

export function parseCached<T>(absPath: string, parse: (absPath: string) => T): T {
  const st = fs.statSync(absPath, { throwIfNoEntry: false });
  const key = st ? `${st.mtimeMs}|${st.size}` : 'missing';
  const hit = memo.get(absPath);
  if (hit && hit.key === key) {
    memo.delete(absPath);
    memo.set(absPath, hit);
    return hit.value as T;
  }
  const value = parse(absPath);
  // 缓存值可能是 Promise（reference-styles 就是）：失败要把它摘掉，
  // 否则这个键会一直重放同一个错误，直到文件 mtime 变化才恢复。
  if (value instanceof Promise) {
    void value.catch(() => {
      if (memo.get(absPath)?.value === value) memo.delete(absPath);
    });
  }
  memo.set(absPath, { key, value });
  if (memo.size > MAX_ENTRIES) memo.delete(memo.keys().next().value as string);
  return value;
}
