/**
 * docx → Markdown：对应 pipeline/extract_docx_to_md.py。
 *
 * 当前走 Pandoc --extract-media 的直连路径；正文样式回填、三线表转 Markdown 表格、
 * 图题回写等结构还原随导入阶段移植。
 */
import fs from 'node:fs';
import path from 'node:path';

import { sanitizeImportName, slugify } from './naming.js';
import { run } from './process.js';

export interface ImportedDocx {
  markdown: string;
  stem: string;
  imageRelDir: string;
  /** 相对任务目录的 [相对路径, 绝对路径] 列表，供前端回传 entries。 */
  files: Array<{ relPath: string; absPath: string }>;
  log: string;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

export async function extractDocxToMarkdown(options: {
  repoRoot: string;
  pandoc: string;
  workDir: string;
  filename: string;
  contentBase64: string;
  imageSlug?: string;
}): Promise<ImportedDocx> {
  const { repoRoot, pandoc, workDir } = options;
  const filename = sanitizeImportName(options.filename || 'input.docx');
  const stem = filename.replace(/\.docx$/i, '') || 'document';
  const slug =
    options.imageSlug && /^[\w一-鿿-]+$/.test(options.imageSlug)
      ? options.imageSlug
      : slugify(stem);

  const docxPath = path.join(workDir, filename);
  fs.writeFileSync(docxPath, Buffer.from(options.contentBase64, 'base64'));

  const mdPath = path.join(workDir, `${stem}.md`);
  const extractRoot = path.join(workDir, 'pandoc-media');
  const imageDir = path.join(workDir, 'images', slug);

  const result = await run(
    pandoc,
    [
      docxPath,
      '-f',
      'docx',
      '-t',
      'markdown+tex_math_dollars+tex_math_single_backslash',
      '--wrap=none',
      '--extract-media',
      extractRoot,
      '-o',
      mdPath,
    ],
    { cwd: repoRoot },
  );
  if (result.code !== 0 || !fs.existsSync(mdPath)) {
    throw new Error(result.stderr.trim() || `extract failed: ${result.code}`);
  }

  const mediaDir = path.join(extractRoot, 'media');
  for (const source of walk(mediaDir)) {
    const dest = path.join(imageDir, path.relative(mediaDir, source));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }

  const rewritten = fs
    .readFileSync(mdPath, 'utf-8')
    .replace(/\((?:[^)]*?)media\/(.*?)\)/g, `(${`images/${slug}`}/$1)`);
  fs.writeFileSync(mdPath, rewritten, 'utf-8');

  return {
    markdown: rewritten,
    stem,
    imageRelDir: `images/${slug}`,
    files: [
      { relPath: `${stem}.md`, absPath: mdPath },
      ...walk(imageDir).map((abs) => ({
        relPath: path.relative(workDir, abs).split(path.sep).join('/'),
        absPath: abs,
      })),
    ],
    log: (result.stdout + result.stderr).trim().slice(-4000),
  };
}
