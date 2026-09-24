/** 附录代码块 → 三线表：对应 ooxml_verbatim_table.py。 */
import type { StageContext } from './context.js';

export async function applyVerbatimTableStage(ctx: StageContext): Promise<void> {
  if (!ctx.template.def.three_line_tables) return;
  ctx.log('[后处理] 附录代码块 → 三线表 …');
  ctx.log('[后处理] 该阶段尚未移植到 Node，已跳过。', 'stderr');
}
