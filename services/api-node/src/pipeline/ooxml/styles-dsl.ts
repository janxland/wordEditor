/**
 * styles.yaml DSL → OOXML styles.xml：等价于 pipeline/postprocess_styles.py 的 DSL 部分。
 *
 * - loadStylesDsl：读取 yaml，支持顶层 extends 链式继承（列表键拼接、其余键后者优先）
 * - applyStylesDsl：overrides 覆盖既有样式 + custom_styles 注入/重写自定义样式
 * - stripPageFrameShapes：清掉页眉/页脚里的整页描边矩形（WPS 兼容形状），避免导出黑框
 */
import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import {
  addEl,
  allDescendants,
  attr,
  child,
  childEls,
  localOf,
  parseXml,
  serializeEl,
  type XEl,
} from './xml.js';
import type { MultilevelSpec } from './multilevel.js';
import {
  ensurePpr,
  ensureRpr,
  findStyleById,
  lineSpacingAttrs,
  removeChildTags,
  replaceChildTag,
  setChildTag,
  styleId,
  styleName,
  type TagAttrs,
} from './util.js';

export interface StyleMatch {
  id?: string;
  name?: string;
  name_regex?: string;
  kind?: 'heading' | 'body';
}

export interface ParagraphDsl {
  word_wrap_break_latin?: boolean;
  clear_indent?: boolean;
  indent_clear?: boolean;
  line_spacing?: string | number | null;
  spacing_before_dxa?: number;
  spacing_after_dxa?: number;
  hanging_indent_chars?: number;
  first_line_chars?: number;
  first_line_dxa?: number;
  align?: string;
  page_break_before?: boolean;
}

export interface RunDsl {
  latin_font?: string;
  cjk_font?: string;
  size_half_pt?: number;
  size_cs_half_pt?: number;
  bold?: boolean;
  color?: string;
}

export interface OverrideRule {
  match?: StyleMatch;
  word_wrap_break_latin?: boolean;
  clear_indent?: boolean;
  latin_font?: string;
  cjk_font?: string;
  paragraph?: ParagraphDsl;
  run?: RunDsl;
}

export interface CustomStyleRule {
  id: string;
  name: string;
  based_on?: string;
  paragraph?: ParagraphDsl;
  run?: RunDsl;
}

export interface FontsDsl {
  latin?: string;
  cjk?: string;
}

/** 列表样式库条目：id/name/based_on 之外，paragraph/run/list 三块参与继承合并。 */
export interface LibraryItem {
  id: string;
  name?: string;
  based_on?: string;
  paragraph?: ParagraphDsl;
  run?: RunDsl;
  list?: {
    start?: number;
    num_fmt?: string;
    suff?: string;
    lvl_text?: string;
    align?: string;
  };
}

/** use_list_styles 的元素：纯 id 字符串，或 { id, overrides } 形式。 */
export type UseListItem =
  | string
  | { id?: string; overrides?: Partial<LibraryItem>; override?: Partial<LibraryItem> };

/** 一份模板 styles.yaml 的完整 DSL（extends 已在 loadStylesDsl 里合并展开）。 */
export interface StylesDsl {
  template?: { id?: string; name?: string };
  fonts?: FontsDsl;
  overrides?: OverrideRule[];
  custom_styles?: CustomStyleRule[];
  headings?: unknown[];
  multilevel_list?: MultilevelSpec;
  list_style_library?: LibraryItem[];
  use_list_styles?: UseListItem[];
  default_list_style?: string;
}

type DslObject = Record<string, unknown>;

const LIST_MERGE_KEYS = new Set([
  'overrides',
  'custom_styles',
  'headings',
  'list_style_library',
  'use_list_styles',
]);

function isPlainObject(value: unknown): value is DslObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** base 在前、over 在后；列表键拼接（子模板规则排在后面，后加载者优先生效）。 */
function deepMerge(base: DslObject, over: DslObject): DslObject {
  const out: DslObject = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (LIST_MERGE_KEYS.has(key) && Array.isArray(value) && Array.isArray(out[key])) {
      out[key] = [...(out[key] as unknown[]), ...value];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as DslObject, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** 读取 styles.yaml，沿 extends 递归合并；循环引用直接报错。 */
export function loadStylesDsl(stylesPath: string, seen: Set<string> = new Set()): StylesDsl {
  const resolved = path.resolve(stylesPath);
  if (seen.has(resolved)) throw new Error(`styles extends 循环: ${resolved}`);
  seen.add(resolved);

  const dsl = (YAML.parse(fs.readFileSync(resolved, 'utf-8')) as DslObject | null) ?? {};
  const parentRel = dsl.extends;
  delete dsl.extends;
  if (typeof parentRel === 'string' && parentRel) {
    const base = loadStylesDsl(path.resolve(path.dirname(resolved), parentRel), seen);
    return deepMerge(base as DslObject, dsl) as StylesDsl;
  }
  return dsl as StylesDsl;
}

const HEADING_IDS = new Set([
  ...[1, 2, 3, 4, 5].flatMap((i) => [`Heading${i}`, `标题 ${i}`]),
]);
const HEADING_NAMES = new Set(
  [1, 2, 3, 4, 5].flatMap((i) => [`heading ${i}`, `标题 ${i}`]),
);
/** ae = 「文章的正文」（reference.docx 里的 styleId）。 */
const BODY_IDS = new Set(['Normal', 'a', 'ae']);
const BODY_NAMES = new Set(['normal', '文章的正文']);

function isHeadingStyle(s: XEl): boolean {
  return HEADING_IDS.has(styleId(s)) || HEADING_NAMES.has(styleName(s).toLowerCase());
}

function isBodyStyle(s: XEl): boolean {
  return BODY_IDS.has(styleId(s)) || BODY_NAMES.has(styleName(s).toLowerCase());
}

function matchStyle(s: XEl, m: StyleMatch): boolean {
  if (m.id !== undefined && styleId(s) === m.id) return true;
  if (m.name !== undefined && styleName(s) === m.name) return true;
  if (m.name_regex !== undefined && new RegExp(m.name_regex).test(styleName(s).toLowerCase())) {
    return true;
  }
  if (m.kind === 'heading' && isHeadingStyle(s)) return true;
  if (m.kind === 'body' && isBodyStyle(s)) return true;
  return false;
}

function findStyleByName(root: XEl, name: string): XEl | undefined {
  return childEls(root, 'w:style').find((s) => styleName(s) === name);
}

/** 是否真的发生了改动（调用方据此决定是否打日志）。 */
function setWordWrapZero(ppr: XEl): boolean {
  const ww = child(ppr, 'w:wordWrap');
  if (ww && attr(ww, 'w:val') === '0') return false;
  setChildTag(ppr, 'wordWrap', { val: '0' });
  return true;
}

function clearIndent(ppr: XEl): boolean {
  let changed = false;
  for (const tag of ['ind', 'tabs']) {
    const el = child(ppr, `w:${tag}`);
    if (el) {
      ppr.removeChild(el);
      changed = true;
    }
  }
  return changed;
}

function ensureRFonts(style: XEl): XEl {
  const rpr = ensureRpr(style);
  return child(rpr, 'w:rFonts') ?? addEl(rpr, 'w:rFonts');
}

/** 只覆盖西文三个槽位，保留 eastAsia 等原有属性。 */
function setLatinFont(style: XEl, font: string): boolean {
  const rfonts = ensureRFonts(style);
  let changed = false;
  for (const key of ['ascii', 'hAnsi', 'cs']) {
    if (attr(rfonts, `w:${key}`) !== font) {
      rfonts.setAttribute(`w:${key}`, font);
      changed = true;
    }
  }
  return changed;
}

function setCjkFont(style: XEl, font: string): boolean {
  const rfonts = ensureRFonts(style);
  if (attr(rfonts, 'w:eastAsia') === font) return false;
  rfonts.setAttribute('w:eastAsia', font);
  return true;
}

/** 段落属性注入：list-styles 复用同一实现（等价 Python 的 _apply_paragraph）。 */
export function applyParagraph(style: XEl, p: ParagraphDsl): void {
  const ppr = ensurePpr(style);
  if (p.word_wrap_break_latin) setWordWrapZero(ppr);
  if (p.clear_indent || p.indent_clear) clearIndent(ppr);

  const spacing: TagAttrs = {};
  if ('line_spacing' in p) Object.assign(spacing, lineSpacingAttrs(p.line_spacing));
  if ('spacing_before_dxa' in p) spacing.before = String(p.spacing_before_dxa);
  if ('spacing_after_dxa' in p) spacing.after = String(p.spacing_after_dxa);
  if (Object.keys(spacing).length) replaceChildTag(ppr, 'spacing', spacing);

  const ind: TagAttrs = {};
  if ('hanging_indent_chars' in p) {
    const chars = Math.trunc(Number(p.hanging_indent_chars));
    Object.assign(ind, {
      leftChars: '0',
      left: '0',
      hangingChars: String(chars * 100),
      hanging: String(chars * 210),
      firstLine: '0',
      firstLineChars: '0',
    });
  }
  if ('first_line_chars' in p) {
    const chars = Math.trunc(Number(p.first_line_chars));
    // 与学校 reference 的 ae 样式一致：2 字符 → firstLineChars/firstLine 均 200
    const firstLine = p.first_line_dxa ?? chars * 100;
    Object.assign(ind, {
      firstLineChars: String(chars * 100),
      firstLine: String(Math.trunc(firstLine)),
    });
  }
  if (Object.keys(ind).length) replaceChildTag(ppr, 'ind', ind);

  if ('align' in p) setChildTag(ppr, 'jc', { val: String(p.align) });
  if ('page_break_before' in p) {
    if (p.page_break_before) replaceChildTag(ppr, 'pageBreakBefore');
    else setChildTag(ppr, 'pageBreakBefore', { val: '0' });
  }
}

/** 字符属性注入：list-styles 复用同一实现（等价 Python 的 _apply_run）。 */
export function applyRun(style: XEl, r: RunDsl, fonts: FontsDsl): void {
  const latin = resolveFont(r.latin_font, fonts.latin);
  if ('latin_font' in r && latin) setLatinFont(style, latin);
  const cjk = resolveFont(r.cjk_font, fonts.cjk);
  if ('cjk_font' in r && cjk) setCjkFont(style, cjk);
  if ('size_half_pt' in r || 'size_cs_half_pt' in r) {
    const rpr = ensureRpr(style);
    const sz = r.size_half_pt;
    const szCs = r.size_cs_half_pt ?? sz;
    if (sz !== undefined) replaceChildTag(rpr, 'sz', { val: sz });
    if (szCs !== undefined) replaceChildTag(rpr, 'szCs', { val: szCs });
  }
  if ('bold' in r) {
    const rpr = ensureRpr(style);
    removeChildTags(rpr, 'b', 'bCs');
    if (r.bold) {
      addEl(rpr, 'w:b');
      addEl(rpr, 'w:bCs');
    }
  }
  // 强制覆盖 reference 的主题色 / Pandoc 高亮残留
  if ('color' in r) replaceChildTag(ensureRpr(style), 'color', { val: String(r.color) });
}

/** inherit 解析到 DSL 顶层 fonts。 */
function resolveFont(font: string | undefined, inherited: string | undefined): string | undefined {
  return font === 'inherit' ? inherited : font;
}

export type StyleLog = (line: string) => void;

/** 就地改写 styles.xml 根节点：先应用 overrides，再注入/覆盖 custom_styles。 */
export function applyStylesDsl(root: XEl, dsl: StylesDsl, log: StyleLog = () => {}): void {
  const fonts = dsl.fonts ?? {};
  const styles = () => childEls(root, 'w:style');

  for (const rule of dsl.overrides ?? []) {
    const m = rule.match ?? {};
    for (const style of styles()) {
      if (!matchStyle(style, m)) continue;
      const label = `'${styleId(style)}'/'${styleName(style)}'`;
      if (rule.word_wrap_break_latin && setWordWrapZero(ensurePpr(style))) {
        log(`  - wordWrap=0: ${label}`);
      }
      if (rule.clear_indent && clearIndent(ensurePpr(style))) log(`  - 清缩进: ${label}`);
      const latin = resolveFont(rule.latin_font, fonts.latin);
      if (latin && setLatinFont(style, latin)) log(`  - 西文字体=${latin}: ${label}`);
      const cjk = resolveFont(rule.cjk_font, fonts.cjk);
      if (cjk && setCjkFont(style, cjk)) log(`  - 中文字体=${cjk}: ${label}`);
      if (rule.paragraph) {
        applyParagraph(style, rule.paragraph);
        log(`  - paragraph 覆盖: ${label}`);
      }
      if (rule.run) {
        applyRun(style, rule.run, fonts);
        log(`  - run 覆盖: ${label}`);
      }
    }
  }

  for (const c of dsl.custom_styles ?? []) {
    const existing = findStyleById(root, c.id) ?? findStyleByName(root, c.name);
    let target: XEl;
    if (existing) {
      removeChildTags(existing, 'pPr', 'rPr');
      if (!child(existing, 'w:qFormat')) addEl(existing, 'w:qFormat');
      target = existing;
      log(`  ~ 覆盖样式: name='${c.name}' (styleId='${styleId(existing)}')`);
    } else {
      target = addEl(root, 'w:style');
      target.setAttribute('w:type', 'paragraph');
      target.setAttribute('w:customStyle', '1');
      target.setAttribute('w:styleId', c.id);
      setName(target, c.name);
      addEl(target, 'w:basedOn').setAttribute('w:val', c.based_on ?? 'a');
      addEl(target, 'w:qFormat');
      log(`  + 新增样式: styleId='${c.id}' name='${c.name}'`);
    }
    if (c.paragraph) applyParagraph(target, c.paragraph);
    if (c.run) applyRun(target, c.run, fonts);
  }
}

function setName(style: XEl, name: string): void {
  const el = addEl(style, 'w:name');
  el.setAttribute('w:val', name);
}

const PAGE_FRAME_STYLE_MARKERS = [
  'mso-position-horizontal-relative:page',
  'mso-position-vertical-relative:page',
];

/** VML 整页描边矩形（WPS 页面边框回退形状）。 */
function looksLikePageFrameRect(el: XEl): boolean {
  if (localOf(el) !== 'rect') return false;
  const style = attr(el, 'style') ?? '';
  return (
    attr(el, 'filled') === 'f' &&
    attr(el, 'stroked') === 't' &&
    PAGE_FRAME_STYLE_MARKERS.every((marker) => style.includes(marker))
  );
}

/**
 * 移除页眉/页脚中的整页描边矩形（WPS/Word 兼容回退形状），避免导出文档出现黑框。
 * 返回 null 表示无需改动，调用方保留原文。
 */
export function stripPageFrameShapes(xml: string): { xml: string; removed: number } | null {
  const root = parseXml(xml).documentElement;
  let removed = 0;

  for (const parent of [root, ...allDescendants(root)]) {
    for (const pict of childEls(parent).filter((el) => localOf(el) === 'pict')) {
      if ([pict, ...allDescendants(pict)].some(looksLikePageFrameRect)) {
        parent.removeChild(pict);
        removed += 1;
      }
    }
  }
  if (!removed) return null;
  return { xml: serializeEl(root), removed };
}
