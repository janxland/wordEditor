/** 跨层共用的文件系统小工具：越界守卫 + 递归列文件。 */
import fs from 'node:fs';
import path from 'node:path';

/** `rel` 解析到 `root` 之内并返回绝对路径；越界或空路径返回 null。等价于 app.py 的 _safe_resolve。 */
export function insideDir(root: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, cleaned);
  return abs === base || abs.startsWith(base + path.sep) ? abs : null;
}

/** 目录树的文件绝对路径，按名称稳定排序；目录不存在时返回空表。 */
export function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}
