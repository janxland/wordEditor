/** 文档属性阶段：对应 build.py 的 metadata 分支——任一属性非空才运行。 */
import { applyDocxMetadata, type DocxProvenance } from '../metadata.js';
import type { StageRun } from './context.js';

export async function applyMetadataStage(ctx: StageRun): Promise<void> {
  const { author, remark, title } = ctx.provenance ?? {};
  const provenance: DocxProvenance = { author: author?.trim(), remark: remark?.trim(), title: title?.trim() };
  if (!provenance.author && !provenance.remark && !provenance.title) return;

  ctx.log('[后处理] 写入文档属性 …');
  await applyDocxMetadata(ctx.zip, provenance);
  ctx.log('[apply_docx_metadata] 完成');
}
