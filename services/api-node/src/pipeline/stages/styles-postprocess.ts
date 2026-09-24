/** OOXML 样式注入：对应 postprocess_styles.py（含 numbering / list styles）。 */
import fs from 'node:fs';
import path from 'node:path';

import type { StageContext } from './context.js';

export function resolveStylesYaml(ctx: StageContext): string | null {
  const stylesYaml = ctx.stylesYaml === undefined ? ctx.template.stylesYaml : ctx.stylesYaml;
  if (stylesYaml && !fs.existsSync(stylesYaml)) {
    throw new Error(`styles.yaml 不存在: ${path.resolve(stylesYaml)}`);
  }
  return stylesYaml;
}

export async function applyStylesStage(ctx: StageContext): Promise<void> {
  const stylesYaml = resolveStylesYaml(ctx);
  if (!stylesYaml) return;

  ctx.step('ooxml', 'process', '注入 styles.yaml…');
  ctx.log(`[后处理] 注入 OOXML 样式 … ${path.relative(ctx.repoRoot, stylesYaml)}`);
  ctx.log('[后处理] 该阶段尚未移植到 Node，已跳过。', 'stderr');
  ctx.step('ooxml', 'finish');
}
