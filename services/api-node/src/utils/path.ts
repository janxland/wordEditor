import path from 'node:path';

export function safeResolve(repoRoot: string, rel: string): string | null {
  const normalized = path.normalize(rel || '').replace(/^(\.\.(\\|\/|$))+/, '');
  const abs = path.resolve(repoRoot, normalized);
  if (!abs.startsWith(repoRoot)) return null;
  return abs;
}

export function sanitizeDownloadName(name: string): string {
  const base = path.basename(name || 'export.docx');
  const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff\s]/g, '_').trim();
  return cleaned.endsWith('.docx') ? cleaned : `${cleaned || 'export'}.docx`;
}

export function sanitizeImportName(name: string): string {
  const base = path.basename(name || 'input.docx');
  const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff\s]/g, '_').trim() || 'input.docx';
  return cleaned.toLowerCase().endsWith('.docx') ? cleaned : `${cleaned}.docx`;
}

export function slugify(input: string): string {
  const cleaned = (input || '')
    .trim()
    .replace(/\.docx$/i, '')
    .replace(/[\s\\/]+/g, '-')
    .replace(/[^\w\-\u4e00-\u9fff]/g, '');
  return cleaned || 'doc';
}
