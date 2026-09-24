/**
 * docx → Markdown 导入：对应 build 之外的 pipeline/extract_docx_to_md.py。
 *
 * 走自建结构还原（样式驱动），而不是 Pandoc 直转——学校模板里样式名才是结构的权威来源。
 */
import fs from 'node:fs';
import path from 'node:path';

import { walkFiles } from '../fs-utils.js';
import { docxToMarkdown, parseRelations, planImages } from './ooxml/docx-to-md.js';
import { parseXml } from './ooxml/xml.js';
import { openDocxSession } from './ooxml/zip.js';
import { sanitizeImportName, slugify } from './naming.js';

export interface ImportedDocx {
  markdown: string;
  stem: string;
  imageRelDir: string;
  /** 相对任务目录的 [相对路径, 绝对路径] 列表，供前端回传 entries。 */
  files: Array<{ relPath: string; absPath: string }>;
  log: string;
}

export async function extractDocxToMarkdown(options: {
  workDir: string;
  filename: string;
  contentBase64: string;
  imageSlug?: string;
}): Promise<ImportedDocx> {
  const { workDir } = options;
  const filename = sanitizeImportName(options.filename || 'input.docx');
  const stem = filename.replace(/\.docx$/i, '') || 'document';
  const requestedSlug = String(options.imageSlug ?? '').trim();
  const slug = /^[\w一-鿿-]+$/.test(requestedSlug) ? requestedSlug : slugify(stem);

  const docxPath = path.join(workDir, filename);
  fs.writeFileSync(docxPath, Buffer.from(options.contentBase64, 'base64'));

  const mdPath = path.join(workDir, `${stem}.md`);
  const imageDir = path.join(workDir, 'images', slug);
  const imageRel = `images/${slug}`;

  // 一次导入只解一遍整包：文本部件和图片部件共用同一个会话。
  const zip = await openDocxSession(docxPath);
  const sources = await zip.readParts([
    'word/document.xml',
    'word/styles.xml',
    'word/_rels/document.xml.rels',
  ]);
  const documentSource = sources.get('word/document.xml');
  const stylesSource = sources.get('word/styles.xml');
  if (!documentSource || !stylesSource) {
    throw new Error('extract failed: 不是有效的 docx（缺少 word/document.xml 或 word/styles.xml）');
  }

  const relsRoot = parseXml(sources.get('word/_rels/document.xml.rels') ?? '<Relationships/>')
    .documentElement;
  const rels = parseRelations(relsRoot);
  const plans = planImages(rels);
  fs.mkdirSync(imageDir, { recursive: true });
  // 逐张「解→落盘→释放」：整包媒体一次性物化会让峰值等于图片总大小。
  for (const plan of plans) {
    const bytes = await zip.readPartBytes(plan.source);
    if (bytes) fs.writeFileSync(path.join(imageDir, plan.name), bytes);
  }

  const result = docxToMarkdown({
    documentRoot: parseXml(documentSource).documentElement,
    stylesRoot: parseXml(stylesSource).documentElement,
    rels,
    titleFallback: stem,
    imageRel,
  });
  fs.writeFileSync(mdPath, result.markdown, 'utf-8');

  const { headings, paragraphs, lists, images, tables } = result.stats;
  const log = [
    `[extract] 写入 ${mdPath}`,
    `[extract] 标题: ${result.title ?? 'None'}`,
    `[extract] 标题段 ${headings} | 段落 ${paragraphs} | 列表 ${lists} | 图 ${images} | 表 ${tables}`,
  ].join('\n');

  return {
    markdown: result.markdown,
    stem,
    imageRelDir: imageRel,
    files: [
      { relPath: `${stem}.md`, absPath: mdPath },
      ...walkFiles(imageDir).map((abs) => ({
        relPath: path.relative(workDir, abs).split(path.sep).join('/'),
        absPath: abs,
      })),
    ],
    log,
  };
}
