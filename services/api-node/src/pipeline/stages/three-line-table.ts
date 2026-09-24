/**
 * 三线表阶段：对应 ooxml_three_line_table.py（读 document.xml → 改所有表格边框 → 回写）。
 * 必须在附录代码块表格化之前运行，顺序与 build.py 一致。
 */
import { applyThreeLineTables } from '../ooxml/three-line-table.js';
import { parseXml, serializeEl } from '../ooxml/xml.js';
import { patchDocxParts, readPart } from '../ooxml/zip.js';
import type { StageContext } from './context.js';

export async function applyThreeLineTableStage(ctx: StageContext): Promise<void> {
  if (!ctx.template.def.three_line_tables) return;
  ctx.log('[后处理] 三线表边框 …');

  const source = await readPart(ctx.docxPath, 'word/document.xml');
  if (source === null) return;

  const root = parseXml(source).documentElement;
  const count = applyThreeLineTables(root);
  const next = serializeEl(root);
  await patchDocxParts(ctx.docxPath, { 'word/document.xml': () => next });
  ctx.log(`[three-line-table] 已改写 ${count} 个表格 → 三线表`);
}
