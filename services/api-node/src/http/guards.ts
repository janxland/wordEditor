/** 入站路径校验：只允许仓库内路径。等价于 app.py 的 _safe_resolve。 */
import path from 'node:path';

export function safeResolve(repoRoot: string, rel: string): string | null {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) return null;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, cleaned);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}
