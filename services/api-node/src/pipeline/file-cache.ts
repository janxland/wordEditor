/**
 * 本地配置文件的「读+解析」缓存：按 (mtime, size) 判新。
 *
 * 这些文件都在每次请求里被重复读取解析（templates.json 每个构建请求、preview-cdn.json
 * 每次拼 CDN 地址、reference.docx 每次样式查询），改成缓存后二次请求零解析。
 * 键里带 mtime，所以编辑文件立刻生效，不需要重启服务。
 */
import fs from 'node:fs';

const memo = new Map<string, { key: string; value: unknown }>();

export function parseCached<T>(absPath: string, parse: (absPath: string) => T): T {
  const st = fs.statSync(absPath, { throwIfNoEntry: false });
  const key = st ? `${st.mtimeMs}|${st.size}` : 'missing';
  const hit = memo.get(absPath);
  if (hit && hit.key === key) return hit.value as T;
  const value = parse(absPath);
  memo.set(absPath, { key, value });
  return value;
}
