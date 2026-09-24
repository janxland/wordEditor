/** 文档属性阶段：对应 apply_docx_metadata.py。 */
import { applyDocxMetadata } from '../metadata.js';
import type { StageContext } from './context.js';

export async function applyMetadataStage(ctx: StageContext): Promise<void> {
  const { author, remark, title } = ctx.provenance ?? {};
  const count = await applyDocxMetadata(ctx.docxPath, {
    author: author?.trim(),
    remark: remark?.trim(),
    title: title?.trim(),
  });
  if (count) ctx.log(`[apply_docx_metadata] 完成，写入 ${count} 项`);
}
