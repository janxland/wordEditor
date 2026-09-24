/** 三线表边框：对应 ooxml_three_line_table.py。 */
import type { StageContext } from './context.js';

export async function applyThreeLineTableStage(ctx: StageContext): Promise<void> {
  if (!ctx.template.def.three_line_tables) return;
  ctx.log('[后处理] 三线表边框 …');
  ctx.log('[后处理] 该阶段尚未移植到 Node，已跳过。', 'stderr');
}
