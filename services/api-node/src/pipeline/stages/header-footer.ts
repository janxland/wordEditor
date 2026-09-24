/** 页眉页脚：对应 apply_docx_header_footer.py。 */
import { parseXml, serializeEl } from '../ooxml/xml.js';
import type { PartPatch } from '../ooxml/zip.js';
import {
  applyHeaderFooter,
  checkAlignments,
  HEADER_FOOTER_PART_RE,
  type Alignments,
} from '../ooxml/header-footer.js';
import type { StageRun } from './context.js';

function alignments(horiz?: string, vert?: string): Alignments {
  return { horizontal: horiz ?? 'center', vertical: vert ?? 'center' };
}

export async function applyHeaderFooterStage(ctx: StageRun): Promise<void> {
  const { headerText, footerText } = ctx.options;
  if (headerText == null && footerText == null) return;

  ctx.log('[后处理] 写入页眉页脚 …');
  const header = alignments(ctx.options.headerAlign, ctx.options.headerVerticalAlign);
  const footer = alignments(ctx.options.footerAlign, ctx.options.footerVerticalAlign);
  checkAlignments(header, footer);

  const parts = await ctx.zip.listParts();
  const patches: Record<string, PartPatch> = {};
  let count = 0;
  for (const part of parts) {
    const kind = part.match(HEADER_FOOTER_PART_RE)?.[1];
    const text = kind === 'header' ? headerText : kind === 'footer' ? footerText : undefined;
    if (text == null) continue;
    const aligns = kind === 'header' ? header : footer;
    patches[part] = (source) => {
      if (!source) return null;
      const root = parseXml(source).documentElement;
      applyHeaderFooter(root, text, aligns);
      return serializeEl(root);
    };
    count += 1;
  }

  await ctx.zip.patch(patches);
  ctx.log(`[apply_docx_header_footer] 完成，更新 ${count} 个部件`);
}
