/**
 * OOXML 共享工具：等价于 pipeline/ooxml_util.py。
 * 只放跨阶段复用的样式/段落/书签/标题识别原语。
 */
import {
  addEl,
  addElAt,
  attr,
  child,
  childEls,
  cloneEl,
  descendants,
  insertEl,
  localOf,
  setTextPreserve,
  wtText,
  type XDoc,
  type XEl,
} from './xml.js';

export const HUTB_HEADING_NUM_ID = 2;

// ─────────────── 低阶标签操作（DSL 注入各模块共用） ───────────────

export type TagAttrs = Record<string, string | number>;

function setAttrs(el: XEl, attrs: TagAttrs): void {
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(`w:${key}`, String(value));
}

/** 有则改属性、无则追加到末尾。 */
export function setChildTag(parent: XEl, tag: string, attrs: TagAttrs = {}): XEl {
  const el = child(parent, `w:${tag}`) ?? addEl(parent, `w:${tag}`);
  setAttrs(el, attrs);
  return el;
}

/** 删掉同名子元素后新建一个并追加（因此元素顺序变到末尾）。 */
export function replaceChildTag(parent: XEl, tag: string, attrs: TagAttrs = {}): XEl {
  const old = child(parent, `w:${tag}`);
  if (old) parent.removeChild(old);
  const el = addEl(parent, `w:${tag}`);
  setAttrs(el, attrs);
  return el;
}

export function removeChildTags(parent: XEl, ...tags: string[]): void {
  for (const tag of tags) {
    const el = child(parent, `w:${tag}`);
    if (el) parent.removeChild(el);
  }
}

/** pPr 必须是首个子元素（OOXML schema 顺序）。 */
export function ensurePpr(parent: XEl): XEl {
  return child(parent, 'w:pPr') ?? addElAt(parent, 'w:pPr', 0);
}

/** rPr 追加到末尾，与 Python 的 SubElement 行为一致。 */
export function ensureRpr(parent: XEl): XEl {
  return child(parent, 'w:rPr') ?? addEl(parent, 'w:rPr');
}

/**
 * 等价 Python 的 `int(str)`：只接受纯整数串，非法返回 undefined（调用方按 try/except 跳过）。
 * Number.parseInt 会接受 "3abc"/"1e3"，语义不同，故解析属性一律走这里。
 */
export function pythonInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** Python 的 round() 是半偶舍入：round(20.5)=20，与 Math.round 不同。 */
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 行距：single / 1.5 / double / 「22pt」固定磅值 / 数字（twips）。 */
export function lineSpacingAttrs(
  value: string | number | null | undefined,
): TagAttrs {
  if (value === null || value === undefined || value === 'single') {
    return { line: '240', lineRule: 'auto' };
  }
  if (value === 1.5 || value === '1.5') return { line: '360', lineRule: 'auto' };
  if (value === 2 || value === '2' || value === 'double') {
    return { line: '480', lineRule: 'auto' };
  }
  if (typeof value === 'string') {
    const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|磅)\s*$/i.exec(value);
    if (m) return { line: String(pyRound(Number(m[1]) * 20)), lineRule: 'exact' };
  }
  if (typeof value === 'number') return { line: String(Math.trunc(value)), lineRule: 'auto' };
  throw new Error(`unknown line_spacing: ${JSON.stringify(value)}`);
}

// ─────────────── 样式查找 ───────────────

const CHINESE_NUMS = '一二三四五六七八九十百千';

/** 含句末标点或过长的一律视为正文/列表项，不当标题。 */
function looksLikeSentence(title: string): boolean {
  if (title.length > 40) return true;
  return /[，；。,;.]/.test(title);
}

/** 识别带编号前缀的标题行 → { level: 1–4, title }。 */
export function parseHeadingLine(
  text: string,
): { level: number; title: string } | null {
  const t = text.trim();
  if (!t) return null;

  const patterns: Array<[RegExp, number, number]> = [
    [new RegExp(`^([${CHINESE_NUMS}]+)、\\s*(.+)$`), 1, 2],
    [/^(\d+)\.(\d+)\.(\d+)\.(\d+)\s+(.+)$/, 4, 5],
    [/^(\d+)\.(\d+)\.(\d+)\s+(.+)$/, 3, 4],
    [/^(\d+)\.(\d+)\s+(.+)$/, 2, 3],
  ];
  for (const [re, level, group] of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const title = m[group]!.trim();
    return looksLikeSentence(title) ? null : { level, title };
  }

  const m = /^(\d+)(?:[.\s])\s*(.+)$/.exec(t);
  if (m && !m[2]!.slice(0, 3).includes('.')) {
    const title = m[2]!.trim();
    return looksLikeSentence(title) ? null : { level: 1, title };
  }
  return null;
}

export function styleId(style: XEl): string {
  return attr(style, 'w:styleId') ?? '';
}
export function styleName(style: XEl): string {
  return attr(child(style, 'w:name'), 'w:val') ?? '';
}

export function findStyleById(stylesRoot: XEl, sid: string): XEl | undefined {
  return childEls(stylesRoot, 'w:style').find((s) => styleId(s) === sid);
}

/** 学校 reference：编号挂在 heading 2–5，outline heading 1 无编号，故逻辑第 N 级取 styleId N+1。 */
export function styleIdForHeadingLevel(
  level: number,
  headingIds: Map<number, string>,
): string {
  const shifted = headingIds.get(level + 1);
  if (shifted) return shifted;
  const direct = headingIds.get(level);
  if (direct) return direct;
  throw new Error(`未找到标题级别 ${level} 对应样式`);
}

/**
 * 按级别解析段落 styleId。styleId 数字候选必须再核对样式名确实是 heading/标题，
 * 否则克隆模板里 styleId "1" 可能是 Normal，编号会挂到正文样式上。
 */
export function resolveHeadingStyleIds(stylesRoot: XEl): Map<number, string> {
  const out = new Map<number, string>();
  for (let level = 1; level <= 5; level += 1) {
    const wanted = new Set([`heading ${level}`, `标题 ${level}`, `标题${level}`]);
    const candidates = [String(level), `Heading${level}`, `heading ${level}`, `标题${level}`, `标题 ${level}`];
    for (const sid of candidates) {
      const style = findStyleById(stylesRoot, sid);
      if (style && wanted.has(styleName(style).toLowerCase())) {
        out.set(level, sid);
        break;
      }
    }
    if (!out.has(level)) {
      const byName = childEls(stylesRoot, 'w:style').find((s) =>
        wanted.has(styleName(s).toLowerCase()),
      );
      if (byName) out.set(level, styleId(byName));
    }
  }
  return out;
}

export function paragraphPlainText(p: XEl): string {
  return wtText(p).replace(/[\r\n]/g, '').trim();
}

export function runTextLen(el: XEl): number {
  return wtText(el).length;
}

/** 书签名 → 在段落纯文本中的起始偏移。 */
export function bookmarkStartsInParagraph(p: XEl): Map<string, number> {
  let pos = 0;
  const found = new Map<string, number>();
  for (const node of childEls(p)) {
    const tag = localOf(node);
    if (tag === 'bookmarkStart') {
      const name = attr(node, 'w:name') ?? '';
      if (name) found.set(name, pos);
    } else if (tag === 'bookmarkEnd') {
      // 零宽，不推进偏移
    } else {
      pos += runTextLen(node);
    }
  }
  return found;
}

export function collectBookmarkNames(documentRoot: XEl): Set<string> {
  const names = new Set<string>();
  for (const el of descendants(documentRoot, 'w:bookmarkStart')) {
    const name = attr(el, 'w:name') ?? '';
    if (name) names.add(name);
  }
  return names;
}

export function superscriptRpr(doc: XDoc): XEl {
  const rpr = doc.createElement('w:rPr');
  const vert = doc.createElement('w:vertAlign');
  vert.setAttribute('w:val', 'superscript');
  rpr.appendChild(vert);
  return rpr;
}

export function appendTextRun(p: XEl, text: string, rpr?: XEl): XEl {
  const r = addEl(p, 'w:r');
  if (rpr) r.appendChild(cloneEl(rpr));
  setTextPreserve(addEl(r, 'w:t'), text);
  return r;
}

/** 插入 REF 交叉引用域；wrap=false 时域结果只放编号本体，方括号由调用方补齐。 */
export function appendRefField(
  p: XEl,
  bookmark: string,
  display: string,
  rpr: XEl,
  wrap = true,
): void {
  const doc = p.ownerDocument;
  const addRun = (build: (r: XEl) => void): void => {
    const r = doc.createElement('w:r');
    r.appendChild(cloneEl(rpr));
    build(r);
    p.appendChild(r);
  };

  addRun((r) => {
    addEl(r, 'w:fldChar').setAttribute('w:fldCharType', 'begin');
  });
  addRun((r) => {
    setTextPreserve(addEl(r, 'w:instrText'), ` REF ${bookmark} \\h `);
  });
  addRun((r) => {
    addEl(r, 'w:fldChar').setAttribute('w:fldCharType', 'separate');
  });
  addRun((r) => {
    setTextPreserve(addEl(r, 'w:t'), wrap ? `[${display}]` : display);
  });
  addRun((r) => {
    addEl(r, 'w:fldChar').setAttribute('w:fldCharType', 'end');
  });
}

/** 保留原 pPr，重建段落内容。 */
export function rebuildParagraphContent(
  p: XEl,
  buildRuns: (p: XEl) => void,
): void {
  const ppr = child(p, 'w:pPr');
  const pprCopy = ppr ? cloneEl(ppr) : null;
  for (const node of childEls(p)) p.removeChild(node);
  if (pprCopy) p.appendChild(pprCopy);
  buildRuns(p);
}

/**
 * 套用标题样式 + 多级编号，并把段落文本替换为去掉编号前缀的标题。
 * 等价于 ooxml_util.set_paragraph_heading_style。
 */
export function setParagraphHeadingStyle(
  p: XEl,
  styleIdValue: string,
  titleText: string,
  options: { numId?: number; ilvl?: number } = {},
): void {
  const doc = p.ownerDocument;
  const numId = options.numId ?? HUTB_HEADING_NUM_ID;
  const ilvl =
    options.ilvl ??
    (/^\d+$/.test(styleIdValue) ? Math.max(0, Number(styleIdValue) - 1) : 0);

  for (const node of childEls(p, 'w:pPr')) p.removeChild(node);
  const ppr = doc.createElement('w:pPr');
  insertEl(p, ppr, 0);

  addEl(ppr, 'w:pStyle').setAttribute('w:val', styleIdValue);
  const numPr = addEl(ppr, 'w:numPr');
  addEl(numPr, 'w:ilvl').setAttribute('w:val', String(ilvl));
  addEl(numPr, 'w:numId').setAttribute('w:val', String(numId));

  for (const node of childEls(p)) {
    if (node !== ppr) p.removeChild(node);
  }
  appendTextRun(p, titleText);
}
