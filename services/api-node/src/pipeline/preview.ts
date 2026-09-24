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

import YAML from 'yaml';

import { findPandoc } from '../config.js';
import { createJob } from '../jobs/workspace.js';
import type { PipelineEvent } from './types.js';
import { sanitizeDownloadName } from './naming.js';
import { runBuild } from './build.js';
import { materializeMarkdownImages } from './preview-images.js';
import { openDocxSession } from './ooxml/zip.js';
import { applyStylesStage } from './stages/styles-postprocess.js';
import {
  findTemplate,
  loadTemplatesConfig,
  resolveTemplate,
  type ResolvedTemplate,
} from './templates.js';

const SHARED_PREVIEW_MD = 'templates/hutb-shared/preview-styles.md';

/**
 * 传入的是编辑器里的模板 styles.yaml 文本，落到任务目录后顶层相对 extends
 * （`../_shared/hutb-base.yaml`）就以 `.cache/<job>/` 为基准而找不到，先锚定到模板目录。
 */
function anchorExtends(text: string, baseDir: string): string {
  let dsl: { extends?: unknown } | null;
  try {
    dsl = YAML.parse(text);
  } catch {
    // 语法错误留给下游的 YAML 读取报错，错误文案与不锚定时一致。
    return text;
  }
  const rel = dsl?.extends;
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return text;
  return YAML.stringify({ ...dsl, extends: path.resolve(baseDir, rel) });
}

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
  fs.writeFileSync(stylesPath, anchorExtends(options.stylesYaml, path.dirname(ownSample)), 'utf-8');

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
    const zip = await openDocxSession(job.outputDocx);
    await applyStylesStage({
      repoRoot: options.repoRoot,
      docxPath: job.outputDocx,
      template,
      options: {},
      stylesYaml: stylesPath,
      log: (line) => options.onEvent({ type: 'log', line, stream: 'stdout' }),
      step: () => undefined,
      zip,
    });
    await zip.flush();
  }

  return {
    jobId: job.id,
    fileName: sanitizeDownloadName(`style-preview-${options.templateId}.docx`),
    template,
  };
}
