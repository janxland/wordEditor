/**
 * 样式预览：等价于 pipeline/preview_styles.py 的 run_style_preview。
 *
 * 样例稿优先取 templates/<id>/preview-styles.md；缺失时退回共享样例稿。
 * 两条路径最终都以传入的 styles.yaml 覆盖模板自带样式（与 app.py 一致）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { findPandoc } from '../config.js';
import { createJob } from '../jobs/workspace.js';
import type { PipelineEvent } from './types.js';
import { sanitizeDownloadName } from './naming.js';
import { runBuild } from './build.js';
import { materializeMarkdownImages } from './preview-images.js';
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

/** 模板自带的样例稿，缺失时由调用方退回共享样例稿。 */
function templatePreviewMd(repoRoot: string, templateId: string): string | null {
  const file = path.join(repoRoot, 'templates', templateId, 'preview-styles.md');
  return fs.existsSync(file) ? file : null;
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

  const ownSample = templatePreviewMd(options.repoRoot, def.id);
  const sourceMd = ownSample ?? path.join(options.repoRoot, SHARED_PREVIEW_MD);
  if (!fs.existsSync(sourceMd)) throw new Error(`缺少样式样例稿: ${sourceMd}`);

  const job = createJob(options.cacheDir);
  const mdText = await materializeMarkdownImages(
    options.repoRoot,
    fs.readFileSync(sourceMd, 'utf-8'),
    job.dir,
  );
  const inputMd = path.join(job.dir, 'preview-input.md');
  fs.writeFileSync(inputMd, mdText, 'utf-8');

  const stylesPath = path.join(job.dir, 'styles.yaml');
  fs.writeFileSync(stylesPath, options.stylesYaml, 'utf-8');

  await runBuild({
    repoRoot: options.repoRoot,
    pandoc,
    template,
    inputMd,
    outputDocx: job.outputDocx,
    options: {},
    stylesYaml: stylesPath,
    emit: options.onEvent,
  });

  return {
    jobId: job.id,
    fileName: sanitizeDownloadName(`style-preview-${def.id}.docx`),
    template,
  };
}
