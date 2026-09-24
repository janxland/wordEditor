/** 产物与导入文件名规范：等价于 app.py 的 _sanitize_* / _slugify。 */
import path from 'node:path';

const UNSAFE = /[^\w.\-()一-鿿\s]/g;

function sanitizeDocxName(name: string, fallback: string): string {
  const base = path.basename(name || fallback);
  const cleaned = base.replace(UNSAFE, '_').trim() || fallback;
  return cleaned.toLowerCase().endsWith('.docx') ? cleaned : `${cleaned}.docx`;
}

export function sanitizeDownloadName(name: string): string {
  return sanitizeDocxName(name, 'export.docx');
}

export function sanitizeImportName(name: string): string {
  return sanitizeDocxName(name, 'input.docx');
}

/** docx 文件名 → 图片目录用的 slug。 */
export function slugify(name: string): string {
  const cleaned = name
    .replace(/\.docx$/i, '')
    .trim()
    .replace(/[\s\\/]+/g, '-')
    .replace(/[^\w\-一-鿿]/g, '');
  return cleaned || 'doc';
}
