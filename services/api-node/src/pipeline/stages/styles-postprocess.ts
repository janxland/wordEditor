/**
 * OOXML 样式注入阶段：对应 postprocess_styles.py 的 patch_docx()。
 *
 * 顺序（与 Python 一致，不可调换）：
 *   styles.yaml DSL 覆盖 → 摘要/关键词段落识别 → 多级编号 → 列表样式库 → 列表 numId 重定向
 * 同一次 zip 写入里顺带清掉页眉/页脚的整页黑框。
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  applyAbstractStyles,
  type AbstractStyleIds,
} from '../ooxml/abstract-styles.js';
import { applyListStyles, redirectListNumIds } from '../ooxml/list-styles.js';
import { applyMultilevel } from '../ooxml/multilevel.js';
import { parseNumberingRoot } from '../ooxml/numbering.js';
import {
  applyStylesDsl,
  loadStylesDsl,
  stripPageFrameShapes,
  type StylesDsl,
} from '../ooxml/styles-dsl.js';
import { parseXml, serializeEl, type XEl } from '../ooxml/xml.js';
import type { DocxSession, PartPatch } from '../ooxml/zip.js';
import type { StageContext, StageRun } from './context.js';

const HEADER_FOOTER_PART_RE = /^word\/(header|footer)\d+\.xml$/;

const STYLE_PART = 'word/styles.xml';
const NUMBERING_PART = 'word/numbering.xml';
const DOCUMENT_PART = 'word/document.xml';

/** ctx.stylesYaml 显式覆盖（自然语言样式层用），否则用模板自带的 styles.yaml。 */
function resolveStylesYaml(ctx: StageContext): string | null {
  const stylesYaml = ctx.stylesYaml === undefined ? ctx.template.stylesYaml : ctx.stylesYaml;
  if (stylesYaml && !fs.existsSync(stylesYaml)) {
    throw new Error(`styles.yaml 不存在: ${path.resolve(stylesYaml)}`);
  }
  return stylesYaml;
}

/** 默认列表样式：`default_list_style` 显式指定，否则取 use_list_styles 第一项。 */
function defaultListStyleId(dsl: StylesDsl): string | undefined {
  if (dsl.default_list_style) return dsl.default_list_style;
  const first = dsl.use_list_styles?.[0];
  if (first === undefined) return undefined;
  return typeof first === 'string' ? first : first.id;
}

async function patchDocx(zip: DocxSession, dsl: StylesDsl, log: (line: string) => void): Promise<void> {
  const names = await zip.listParts();
  const wanted = [STYLE_PART, NUMBERING_PART, DOCUMENT_PART];
  const headerFooterParts = names.filter((name) => HEADER_FOOTER_PART_RE.test(name));
  const sources = await zip.readParts([...wanted, ...headerFooterParts]);

  const stylesSource = sources.get(STYLE_PART);
  const documentSource = sources.get(DOCUMENT_PART);
  if (!stylesSource || !documentSource) return;

  const stylesRoot = parseXml(stylesSource).documentElement;
  const documentRoot = parseXml(documentSource).documentElement;

  // 第 1 步：DSL 样式覆盖（只改 styles.xml）
  applyStylesDsl(stylesRoot, dsl, log);

  // 第 2 步：摘要 / Abstract / 关键词段落注入
  if (dsl.custom_styles?.length) {
    const changed = applyAbstractStyles(documentRoot, stylesRoot, {
      styleIds: abstractStyleIds(dsl.abstract),
      customStyles: dsl.custom_styles,
    });
    if (changed) log(`[postprocess_abstract] 注入摘要/关键词样式 ${changed} 段`);
  }

  // 第 3 步：多级编号（同时改 numbering / styles / document）
  let numberingRoot: XEl | null = null;
  const multilevel = dsl.multilevel_list;
  if (multilevel?.levels?.length) {
    numberingRoot = parseNumberingRoot(sources.get(NUMBERING_PART) ?? null);
    const patched = applyMultilevel(numberingRoot, stylesRoot, documentRoot, multilevel);
    log(`[postprocess_multilevel] numId=${multilevel.num_id ?? 2} 段落补齐 ${patched} 处`);
  }

  // 第 4 步：列表样式库（DecimalList / BulletList 等）
  const useList = dsl.use_list_styles ?? [];
  if (useList.length) {
    numberingRoot ??= parseNumberingRoot(sources.get(NUMBERING_PART) ?? null);
    const usedIds = applyListStyles(
      numberingRoot,
      stylesRoot,
      dsl.list_style_library ?? [],
      useList,
      { fonts: dsl.fonts ?? {}, warn: log },
    );
    if (usedIds.size) {
      const pairs = [...usedIds].map(([id, numId]) => `${id}=numId:${numId}`).join(', ');
      log(`[postprocess_list_styles] 启用 ${usedIds.size} 个列表样式 → ${pairs}`);
    }

    // 第 4.5 步：把 Pandoc 的散装 numId 重定向到模板默认列表样式，
    // 让 use_list_styles 真正落到文档段落上（每块独立重置计数）。
    const defaultSid = defaultListStyleId(dsl);
    const defaultNumId = defaultSid ? usedIds.get(defaultSid) : undefined;
    if (defaultSid && defaultNumId !== undefined) {
      const preserved = new Set(usedIds.values());
      const mlNumId = multilevel?.levels?.length
        ? Number.parseInt(String(multilevel.num_id ?? 2), 10)
        : Number.NaN;
      if (!Number.isNaN(mlNumId)) preserved.add(mlNumId);
      const redirected = redirectListNumIds(documentRoot, numberingRoot, defaultNumId, preserved, {
        defaultStyleId: defaultSid,
      });
      if (redirected) {
        log(
          `[postprocess_list_styles] 重定向 ${redirected} 处 Pandoc 列表 → ` +
            `${defaultSid}(numId:${defaultNumId}, 每块独立重置)`,
        );
      }
    } else if (defaultSid) {
      log(`  ! default_list_style='${defaultSid}' 未在 use_list_styles 中启用，跳过重定向`);
    }
  }

  const patches: Record<string, PartPatch> = {
    [STYLE_PART]: () => serializeEl(stylesRoot),
    [DOCUMENT_PART]: () => serializeEl(documentRoot),
  };
  // 只有真正生成过编号时才写 numbering.xml（否则会给无列表的模板凭空造一个部件）
  if (numberingRoot) patches[NUMBERING_PART] = () => serializeEl(numberingRoot);

  let removedPageFrames = 0;
  for (const part of headerFooterParts) {
    const source = sources.get(part);
    if (!source) continue;
    patches[part] = () => {
      const stripped = stripPageFrameShapes(source);
      if (!stripped) return null;
      removedPageFrames += stripped.removed;
      return stripped.xml;
    };
  }

  await zip.patch(patches);
  if (removedPageFrames) {
    log(`[postprocess_styles] 已移除页眉/页脚页面黑框 ${removedPageFrames} 处`);
  }
}

/** DSL 的 abstract 块（snake_case）→ applyAbstractStyles 的 styleIds（camelCase）。 */
function abstractStyleIds(
  cfg: Record<string, string> | undefined,
): AbstractStyleIds | undefined {
  if (!cfg) return undefined;
  const map: Record<string, keyof AbstractStyleIds> = {
    abstract_style_id: 'abstract',
    abstract_title_style_id: 'abstractTitle',
    en_abstract_style_id: 'enAbstract',
    en_abstract_title_style_id: 'enAbstractTitle',
    keywords_style_id: 'keywords',
    en_keywords_style_id: 'enKeywords',
  };
  const out: AbstractStyleIds = {};
  for (const [k, v] of Object.entries(cfg)) {
    const key = map[k];
    if (key && v) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function applyStylesStage(ctx: StageRun): Promise<void> {
  const stylesYaml = resolveStylesYaml(ctx);
  if (!stylesYaml) return;

  ctx.step('ooxml', 'process', '注入 styles.yaml…');
  ctx.log('[后处理] 注入 OOXML 样式 …');
  ctx.log(`[postprocess_styles] ${ctx.docxPath}  <- DSL: ${stylesYaml}`);
  await patchDocx(ctx.zip, loadStylesDsl(stylesYaml), (line) => ctx.log(line));
  ctx.log('[postprocess_styles] 完成');
  ctx.step('ooxml', 'finish');
}
