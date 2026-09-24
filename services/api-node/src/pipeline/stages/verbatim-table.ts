/**
 * 附录代码块表格化阶段：对应 ooxml_verbatim_table.py。
 * 紧跟三线表之后运行，把连续代码段包进「表头行 + 代码行」的单列三线表。
 */
import { parseXml, serializeEl } from '../ooxml/xml.js';
import { applyVerbatimTables } from '../ooxml/verbatim-table.js';
import type { StageRun } from './context.js';

export async function applyVerbatimTableStage(ctx: StageRun): Promise<void> {
  if (!ctx.template.def.three_line_tables) return;
  ctx.log('[后处理] 附录代码块 → 三线表 …');

  const source = await ctx.zip.readPart('word/document.xml');
  if (source === null) return;

  const root = parseXml(source).documentElement;
  const { count, captions } = applyVerbatimTables(root);
  if (!count) {
    ctx.log('[verbatim-table] 未发现代码块，跳过');
    return;
  }
  const next = serializeEl(root);
  await ctx.zip.patch({ 'word/document.xml': () => next });
  ctx.log(
    `[verbatim-table] 已把 ${count} 处代码块改为三线表，表头：[` +
      captions.map((c) => `'${c}'`).join(', ') +
      `]`,
  );
}
