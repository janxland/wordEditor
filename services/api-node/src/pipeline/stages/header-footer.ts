/** 页眉页脚：对应 apply_docx_header_footer.py。 */
import type { StageContext } from './context.js';

export async function applyHeaderFooterStage(ctx: StageContext): Promise<void> {
  if (ctx.options.headerText == null && ctx.options.footerText == null) return;
  ctx.log('[后处理] 写入页眉页脚 …');
  ctx.log('[后处理] 该阶段尚未移植到 Node，已跳过。', 'stderr');
}
