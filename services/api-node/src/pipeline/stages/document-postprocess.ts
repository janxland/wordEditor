/**
 * 文档结构阶段：对应 postprocess_document.py。
 * 一次读取 document.xml / styles.xml，按「标题 → 引用 → 表题」顺序改写后回写。
 */
import { parseXml, serializeEl } from '../ooxml/xml.js';
import type { DocxSession } from '../ooxml/zip.js';
import {
  applyHeadings,
  applyRefs,
  applyTableCaptionFallback,
} from '../ooxml/document.js';
import type { StageRun } from './context.js';

export interface DocumentStageStats {
  headings: number;
  refs: number;
  tableCaptions: number;
}

export async function postprocessDocument(
  zip: DocxSession,
  options: { skipRefs?: boolean } = {},
): Promise<DocumentStageStats> {
  const stats: DocumentStageStats = { headings: 0, refs: 0, tableCaptions: 0 };
  const documentSource = await zip.readPart('word/document.xml');
  if (documentSource === null) return stats;

  const root = parseXml(documentSource).documentElement;

  const stylesSource = await zip.readPart('word/styles.xml');
  if (stylesSource === null) throw new Error('word/styles.xml 不存在');
  stats.headings = applyHeadings(root, parseXml(stylesSource).documentElement);
  if (!options.skipRefs) stats.refs = applyRefs(root);
  stats.tableCaptions = applyTableCaptionFallback(root);

  const next = serializeEl(root);
  await zip.patch({ 'word/document.xml': () => next });
  return stats;
}

export async function applyDocumentStage(ctx: StageRun): Promise<void> {
  const scheme = ctx.template.def.heading_numbering ?? 'guanke';
  ctx.step('structure', 'process', '标题与交叉引用…');
  ctx.log(`[后处理] 标题识别与交叉引用（OOXML · ${scheme}）…`);

  const stats = await postprocessDocument(ctx.zip, { skipRefs: ctx.skipRefs });
  ctx.log(`[postprocess_headings] ${stats.headings} 段（scheme=${scheme}）`);
  if (!ctx.skipRefs) ctx.log(`[postprocess_refs] ${stats.refs} 段含引用`);
  ctx.log(`[postprocess_table_caption_fallback] ${stats.tableCaptions} 段`);
  ctx.log('[postprocess_document] 完成');
  ctx.step('structure', 'finish');
}
