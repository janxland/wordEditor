/**
 * 构建编排：等价于 pipeline/build.py 的 main()。
 * pandoc 转换 + 后处理阶段委托给 stages/（顺序与 Python 完全一致）。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { DocxProvenance } from './metadata.js';
import { markdownToDocx } from './pandoc.js';
import type { ResolvedTemplate } from './templates.js';
import { runPostprocess } from './stages/index.js';
import type { StageContext, StageName } from './stages/context.js';
import type { BuildOptions, PipelineEvent } from './types.js';

export interface BuildContext {
  repoRoot: string;
  pandoc: string;
  template: ResolvedTemplate;
  inputMd: string;
  outputDocx: string;
  options: BuildOptions;
  provenance?: DocxProvenance;
  emit: (event: PipelineEvent) => void;
  /** 样式预览用：改用传入的 styles.yaml 而非模板自带的。 */
  stylesYaml?: string | null;
  skipRefs?: boolean;
  /** 只跑到某个后处理阶段：parity 工具逐阶段定位、样式预览主路径都在用。 */
  uptoStage?: StageName;
}

export class BuildError extends Error {}

export async function runBuild(ctx: BuildContext): Promise<void> {
  const { template, options, emit } = ctx;
  const log = (line: string, stream: 'stdout' | 'stderr' = 'stdout'): void =>
    emit({ type: 'log', line, stream });

  if (!fs.existsSync(template.referenceDoc)) {
    throw new BuildError(`模板文件不存在: ${path.relative(ctx.repoRoot, template.referenceDoc)}`);
  }
  if (!fs.existsSync(ctx.inputMd)) {
    throw new BuildError(`找不到输入文件: ${ctx.inputMd}`);
  }

  emit({ type: 'step', id: 'pandoc', status: 'process', message: '启动 Pandoc…' });
  log(`模板: ${template.def.name} (${template.def.id})`);
  log(`输入: ${ctx.inputMd}`);
  log(`输出: ${ctx.outputDocx}`);
  if (template.luaFilters.length) {
    log(`Lua: ${template.luaFilters.map((f) => path.relative(ctx.repoRoot, f)).join(', ')}`);
  }
  emit({ type: 'step', id: 'pandoc', status: 'process', message: 'Pandoc 转换中…' });

  const result = await markdownToDocx({
    repoRoot: ctx.repoRoot,
    pandoc: ctx.pandoc,
    inputMd: ctx.inputMd,
    outputDocx: ctx.outputDocx,
    referenceDoc: template.referenceDoc,
    luaFilters: template.luaFilters,
    useHtmlPipe: !options.noHtmlPipe,
    onLine: (stream, line) => emit({ type: 'log', line, stream }),
  });
  if (result.code !== 0 || !fs.existsSync(ctx.outputDocx)) {
    throw new BuildError(result.stderr.trim() || `Pandoc 执行失败: ${result.code}`);
  }
  log('完成。');
  emit({ type: 'step', id: 'pandoc', status: 'finish', message: 'DOCX 已生成' });
  emit({ type: 'step', id: 'structure', status: 'wait' });

  const stageCtx: StageContext = {
    repoRoot: ctx.repoRoot,
    docxPath: ctx.outputDocx,
    template,
    options,
    provenance: ctx.provenance,
    stylesYaml: ctx.stylesYaml,
    skipRefs: ctx.skipRefs,
    log,
    step: (id, status, message) => emit({ type: 'step', id, status, message }),
  };
  await runPostprocess(stageCtx, ctx.uptoStage);
}
