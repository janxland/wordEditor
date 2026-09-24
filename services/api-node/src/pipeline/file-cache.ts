/**
 * 本地配置文件的「读+解析」缓存：按 (mtime, size) 判新。
 *
 * 这些文件都在每次请求里被重复读取解析（templates.json 每个构建请求、preview-cdn.json
 * 每次拼 CDN 地址、reference.docx 每次样式查询），改成缓存后二次请求零解析。
 * 键里带 mtime，所以编辑文件立刻生效，不需要重启服务。
 *
 * 缓存本身按最近使用淘汰（上限 32 项）：正常只有二十来个稳定路径，加界是为了让
 * 「任何按路径增长的解析结果」都不可能把进程喂成只增不减的常驻内存。
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
