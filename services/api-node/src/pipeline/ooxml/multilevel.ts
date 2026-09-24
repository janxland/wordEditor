/**
 * DSL 驱动的多级列表注入（标题编号：一、 / 1.1 / 1.1.1 / 1.1.1.1）。
 * 等价于 pipeline/ooxml_multilevel.py。
 *
 * 三件事：按 spec 重写 numbering.xml 的 abstractNum/lvl；给 styles.xml 的
 * heading_style 绑定 numPr；给 document.xml 中命中却缺 numPr 的段落补齐。
 */
import { addEl, attr, child, childEls, descendants, type XEl } from './xml.js';
import {
  ensurePpr,
  ensureRpr,
  HUTB_HEADING_NUM_ID,
  lineSpacingAttrs,
  pythonInt,
  removeChildTags,
  replaceChildTag,
  setChildTag,
  styleId,
  type TagAttrs,
} from './util.js';
import { addAbstractNum, findAbstractNum, findNum, linkNumToAbstract } from './numbering.js';

/** 作用于 `w:lvl` 的段落属性：与样式级不同，jc 用替换语义。 */
interface LevelParagraph {
  line_spacing?: string | number | null;
  spacing_before_dxa?: number;
  spacing_after_dxa?: number;
  hanging_indent_chars?: number;
  first_line_chars?: number;
  first_line_dxa?: number;
  align?: string;
}

interface LevelRun {
  latin_font?: string;
  cjk_font?: string;
  size_half_pt?: number;
  size_cs_half_pt?: number;
  bold?: boolean;
}

export interface MultilevelLevel {
  ilvl: number;
  start?: number;
  num_fmt?: string;
  suff?: string;
  lvl_text?: string;
  align?: string;
  is_lgl?: boolean;
  heading_style?: string;
  restart?: number;
  paragraph?: LevelParagraph;
  run?: LevelRun;
}

export interface MultilevelSpec {
  num_id?: number;
  levels: MultilevelLevel[];
}

const numIdOf = (spec: MultilevelSpec): number => Number(spec.num_id ?? HUTB_HEADING_NUM_ID);
const intOf = (value: unknown): number => Math.trunc(Number(value));

/** heading_style → ilvl（Python 只跳过 null，空串仍参与映射）。 */
function styleToIlvl(spec: MultilevelSpec): Map<string, number> {
  const out = new Map<string, number>();
  for (const level of spec.levels) {
    if (level.heading_style != null) {
      out.set(String(level.heading_style), intOf(level.ilvl));
    }
  }
  return out;
}

function appendNumPr(ppr: XEl, numId: number, ilvl: number): void {
  removeChildTags(ppr, 'numPr');
  const numPr = addEl(ppr, 'w:numPr');
  addEl(numPr, 'w:ilvl').setAttribute('w:val', String(ilvl));
  addEl(numPr, 'w:numId').setAttribute('w:val', String(numId));
}

// ─────────────── w:lvl 的段落 / 字符属性 ───────────────

function applyLevelParagraph(lvl: XEl, p: LevelParagraph): void {
  const ppr = ensurePpr(lvl);

  const spacing: TagAttrs = {};
  if ('line_spacing' in p) Object.assign(spacing, lineSpacingAttrs(p.line_spacing));
  if ('spacing_before_dxa' in p) spacing.before = String(intOf(p.spacing_before_dxa));
  if ('spacing_after_dxa' in p) spacing.after = String(intOf(p.spacing_after_dxa));
  if (Object.keys(spacing).length) replaceChildTag(ppr, 'spacing', spacing);

  const ind: TagAttrs = {};
  if ('hanging_indent_chars' in p) {
    const chars = intOf(p.hanging_indent_chars);
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
    const chars = intOf(p.first_line_chars);
    // 与学校 reference 的 ae 样式一致：2 字符 → firstLineChars/firstLine 均 200
    const firstLine = p.first_line_dxa ?? chars * 100;
    Object.assign(ind, {
      firstLineChars: String(chars * 100),
      firstLine: String(intOf(firstLine)),
    });
  }
  if (Object.keys(ind).length) replaceChildTag(ppr, 'ind', ind);

  if ('align' in p) replaceChildTag(ppr, 'jc', { val: String(p.align) });
}

function applyLevelRun(lvl: XEl, r: LevelRun): void {
  const rpr = ensureRpr(lvl);

  if ('latin_font' in r || 'cjk_font' in r) {
    const rfonts = child(rpr, 'w:rFonts') ?? addEl(rpr, 'w:rFonts');
    const latin = r.latin_font;
    if ('latin_font' in r && latin && latin !== 'inherit') {
      for (const key of ['ascii', 'hAnsi', 'cs']) rfonts.setAttribute(`w:${key}`, String(latin));
    }
    const cjk = r.cjk_font;
    if ('cjk_font' in r && cjk && cjk !== 'inherit') {
      rfonts.setAttribute('w:eastAsia', String(cjk));
    }
  }

  if ('size_half_pt' in r || 'size_cs_half_pt' in r) {
    const sz = r.size_half_pt;
    // Python get(k, sz)：键存在但为 null 时取 null（跳过），不是回落 sz
    const szCs = 'size_cs_half_pt' in r ? r.size_cs_half_pt : sz;
    if (sz != null) replaceChildTag(rpr, 'sz', { val: intOf(sz) });
    if (szCs != null) replaceChildTag(rpr, 'szCs', { val: intOf(szCs) });
  }

  if ('bold' in r && r.bold && !child(rpr, 'w:b')) addEl(rpr, 'w:b');
}

function applyLvl(lvl: XEl, spec: MultilevelLevel): void {
  const ilvl = intOf(spec.ilvl);
  lvl.setAttribute('w:ilvl', String(ilvl));

  setChildTag(lvl, 'start', { val: intOf(spec.start ?? 1) });
  setChildTag(lvl, 'numFmt', { val: String(spec.num_fmt ?? 'decimal') });

  if (spec.suff == null) removeChildTags(lvl, 'suff');
  else setChildTag(lvl, 'suff', { val: String(spec.suff) });

  setChildTag(lvl, 'lvlText', { val: String(spec.lvl_text ?? `%${ilvl + 1}.`) });
  setChildTag(lvl, 'lvlJc', { val: String(spec.align ?? 'left') });

  // isLgl：把上级中文/罗马/字母编号强制按 1,2,3 显示
  if (spec.is_lgl) {
    if (!child(lvl, 'w:isLgl')) addEl(lvl, 'w:isLgl');
  } else {
    removeChildTags(lvl, 'isLgl');
  }

  if (spec.heading_style) setChildTag(lvl, 'pStyle', { val: String(spec.heading_style) });

  if (spec.restart == null) removeChildTags(lvl, 'lvlRestart');
  else setChildTag(lvl, 'lvlRestart', { val: intOf(spec.restart) });

  if (spec.paragraph) applyLevelParagraph(lvl, spec.paragraph);
  if (spec.run) applyLevelRun(lvl, spec.run);
}

/** 按 spec 写入 abstractNum 的各 lvl；缺失的 ilvl 追加到末尾。 */
function patchAbstractNum(ab: XEl, levels: MultilevelLevel[]): void {
  const have = new Map<number, XEl>();
  for (const lvl of childEls(ab, 'w:lvl')) {
    const raw = attr(lvl, 'w:ilvl');
    if (raw === undefined) continue;
    const parsed = pythonInt(raw);
    if (parsed === undefined) continue;
    have.set(parsed, lvl);
  }
  for (const spec of levels) {
    const ilvl = intOf(spec.ilvl);
    let lvl = have.get(ilvl);
    if (!lvl) {
      lvl = addEl(ab, 'w:lvl');
      lvl.setAttribute('w:ilvl', String(ilvl));
    }
    applyLvl(lvl, spec);
  }
}

function applyToNumbering(numberingRoot: XEl, spec: MultilevelSpec): void {
  const numId = numIdOf(spec);
  const num = findNum(numberingRoot, numId);
  const linkedId = num ? attr(child(num, 'w:abstractNumId'), 'w:val') : undefined;
  let abstractId = linkedId;
  let ab = linkedId ? findAbstractNum(numberingRoot, linkedId) : undefined;
  if (!ab) {
    ab = addAbstractNum(numberingRoot);
    abstractId = attr(ab, 'w:abstractNumId');
  }
  // multiLevelType = hybridMultilevel 以兼容旧版 Word 渲染
  setChildTag(ab, 'multiLevelType', { val: 'hybridMultilevel' });
  patchAbstractNum(ab, spec.levels);
  linkNumToAbstract(numberingRoot, numId, abstractId ?? '');
}

function applyToStyles(stylesRoot: XEl, spec: MultilevelSpec): void {
  const numId = numIdOf(spec);
  const mapping = styleToIlvl(spec);
  for (const style of childEls(stylesRoot, 'w:style')) {
    const ilvl = mapping.get(styleId(style));
    if (ilvl === undefined) continue;
    appendNumPr(ensurePpr(style), numId, ilvl);
  }
}

/** 补齐命中 heading_style 但自身没有 numPr 的段落（含表格内段落）；返回修补段数。 */
function applyToDocument(documentRoot: XEl, spec: MultilevelSpec): number {
  const numId = numIdOf(spec);
  const mapping = styleToIlvl(spec);
  const body = child(documentRoot, 'w:body') ?? documentRoot;

  let patched = 0;
  for (const p of descendants(body, 'w:p')) {
    const ppr = child(p, 'w:pPr');
    if (!ppr) continue;
    const pstyle = child(ppr, 'w:pStyle');
    if (!pstyle) continue;
    const ilvl = mapping.get(attr(pstyle, 'w:val') ?? '');
    if (ilvl === undefined) continue;
    if (child(ppr, 'w:numPr')) continue;
    appendNumPr(ppr, numId, ilvl);
    patched += 1;
  }
  return patched;
}

/** 一次性套用多级编号；返回 document.xml 的修补段数。 */
export function applyMultilevel(
  numberingRoot: XEl,
  stylesRoot: XEl,
  documentRoot: XEl,
  spec: MultilevelSpec,
): number {
  if (!spec?.levels?.length) return 0;
  applyToNumbering(numberingRoot, spec);
  applyToStyles(stylesRoot, spec);
  return applyToDocument(documentRoot, spec);
}
