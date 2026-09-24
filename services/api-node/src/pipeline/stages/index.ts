/**
 * 后处理编排：顺序与 build.py 完全一致。
 * structural 阶段对应 build.py 的 `if not --no-postprocess` 分支；
 * 页眉页脚 / 修改密码 / 文档属性只由各自入参决定，与 noPostprocess 无关。
 * 传入 upto 时只跑到该阶段为止，供 parity 工具逐阶段定位差异。
 */
import { openDocxSession } from '../ooxml/zip.js';
import type { StageContext, StageName, StageRun } from './context.js';
import { applyDocumentStage } from './document-postprocess.js';
import { applyHeaderFooterStage } from './header-footer.js';
import { applyMetadataStage } from './metadata.js';
import { applyPasswordStage } from './password.js';
import { applyStylesStage } from './styles-postprocess.js';
import { applyThreeLineTableStage } from './three-line-table.js';
import { applyVerbatimTableStage } from './verbatim-table.js';

interface Stage {
  name: StageName;
  /** 受 --no-postprocess 控制的文档结构类阶段。 */
  structural: boolean;
  run: (ctx: StageRun) => Promise<void>;
}

const STAGES: Stage[] = [
  { name: 'document', structural: true, run: applyDocumentStage },
  { name: 'styles', structural: true, run: applyStylesStage },
  { name: 'threeLine', structural: true, run: applyThreeLineTableStage },
  { name: 'verbatim', structural: true, run: applyVerbatimTableStage },
  { name: 'headerFooter', structural: false, run: applyHeaderFooterStage },
  { name: 'password', structural: false, run: applyPasswordStage },
  { name: 'metadata', structural: false, run: applyMetadataStage },
];

export async function runPostprocess(ctx: StageContext, upto?: StageName): Promise<void> {
  const zip = await openDocxSession(ctx.docxPath);
  const run = { ...ctx, zip };
  for (const stage of STAGES) {
    if (!ctx.options.noPostprocess || !stage.structural) {
      await stage.run(run);
    }
    if (upto && stage.name === upto) break;
  }
  // 阶段中途抛错时不落盘：与原来「该阶段未写回即构建失败」一致。
  await zip.flush();
}
