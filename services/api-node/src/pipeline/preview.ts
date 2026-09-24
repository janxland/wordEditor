/**
 * 样式预览：对齐 app.py /api/preview/styles 的两条路径。
 *
 * 1. templates/<请求里的原始 templateId>/preview-styles.md 存在 → 等价 preview_styles.py：
 *    pandoc → 文档结构 → 只注入传入的 styles.yaml（不叠加模板自带样式，不跑三线表等阶段）。
 * 2. 否则退回共享样例稿：先按模板完整链路构建（含模板自带 styles.yaml），
 *    再用传入的 styles.yaml 覆盖一次样式阶段。
 */
import fs from 'node:fs';
import path from 'node:path';

import { findPandoc } from '../config.js';
import { createJob } from '../jobs/workspace.js';
import type { PipelineEvent } from './types.js';
import { sanitizeDownloadName } from './naming.js';
import { runBuild } from './build.js';
import { materializeMarkdownImages } from './preview-images.js';
import { applyStylesStage } from './stages/styles-postprocess.js';
import {
  findTemplate,
  loadTemplatesConfig,
  resolveTemplate,
  type ResolvedTemplate,
} from './templates.js';

const SHARED_PREVIEW_MD = 'templates/hutb-shared/preview-styles.md';

export interface StylePreviewResult {
  jobId: string;
  fileName: string;
  template: ResolvedTemplate;
}

export async function runStylePreview(options: {
  repoRoot: string;
  cacheDir: string;
  templateId: string;
  stylesYaml: string;
  onEvent: (event: PipelineEvent) => void;
}): Promise<StylePreviewResult> {
  const pandoc = findPandoc(options.repoRoot);
  if (!pandoc) throw new Error('未检测到 Pandoc');

  const def = findTemplate(loadTemplatesConfig(options.repoRoot), options.templateId);
  const template = resolveTemplate(options.repoRoot, def);
  if (!fs.existsSync(template.referenceDoc)) {
    throw new Error(`模板文件不存在: ${template.referenceDoc}`);
  }

  // 样例稿按请求原样给出的 id 查找，别名只用于解析模板定义。
  const ownSample = path.join(options.repoRoot, 'templates', options.templateId, 'preview-styles.md');
  const hasOwnSample = fs.existsSync(ownSample);
  const sourceMd = hasOwnSample ? ownSample : path.join(options.repoRoot, SHARED_PREVIEW_MD);

  const job = createJob(options.cacheDir);
  const stylesPath = path.join(job.dir, 'styles.yaml');
  fs.writeFileSync(stylesPath, options.stylesYaml, 'utf-8');

  // 主路径先把 CDN 图落到任务目录（preview_styles.py 的做法）；
  // 回退路径直接把样例稿交给构建链路，让 Pandoc 按 HTML 管道自行内联。
  let inputMd = sourceMd;
  if (hasOwnSample) {
    const mdText = await materializeMarkdownImages(
      options.repoRoot,
      fs.readFileSync(sourceMd, 'utf-8'),
      job.dir,
    );
    inputMd = path.join(job.dir, 'preview-input.md');
    fs.writeFileSync(inputMd, mdText, 'utf-8');
  }

  await runBuild({
    repoRoot: options.repoRoot,
    pandoc,
    template,
    inputMd,
    outputDocx: job.outputDocx,
    options: {},
    stylesYaml: hasOwnSample ? stylesPath : undefined,
    uptoStage: hasOwnSample ? 'styles' : undefined,
    emit: options.onEvent,
  });

  if (!hasOwnSample) {
    await applyStylesStage({
      repoRoot: options.repoRoot,
      docxPath: job.outputDocx,
      template,
      options: {},
      stylesYaml: stylesPath,
      log: (line) => options.onEvent({ type: 'log', line, stream: 'stdout' }),
      step: () => undefined,
    });
  }

  return {
    jobId: job.id,
    fileName: sanitizeDownloadName(`style-preview-${options.templateId}.docx`),
    template,
  };
}
