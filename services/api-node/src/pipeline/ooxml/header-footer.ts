/**
 * 页眉页脚文案与动态页码：等价于 apply_docx_header_footer.py。
 *
 * 只重写**已存在**的 word/header*.xml / word/footer*.xml：清空部件根节点后写入单个
 * 段落，沿用原首段的 pStyle，`{page}` / `{pages}`（以及裸 `N` / `M`）换成
 * PAGE / NUMPAGES 域，Word 打开时自动重算。
 */
import {
  addEl,
  attr,
  child,
  childEls,
  setAttr,
  setText,
  type XDoc,
  type XEl,
} from './xml.js';

/** 与 Python 一致：`\d*` —— header.xml 这类无编号命名也要认。 */
export const HEADER_FOOTER_PART_RE = /^word\/(header|footer)\d*\.xml$/;

const HORIZONTAL_ALIGNS = new Set(['left', 'center', 'right', 'both', 'distribute']);
const VERTICAL_ALIGNS = new Set(['top', 'center', 'baseline', 'bottom', 'auto']);

const PLACEHOLDER_RE = /\{(page|pages)\}|(?<![A-Za-z])([NM])(?![A-Za-z])/g;

export interface Alignments {
  readonly horizontal: string;
  readonly vertical: string;
}

/** 校验对齐取值，等价 Python 改写前的两次集合检查。 */
export function checkAlignments(header: Alignments, footer: Alignments): void {
  if (!HORIZONTAL_ALIGNS.has(header.horizontal) || !HORIZONTAL_ALIGNS.has(footer.horizontal)) {
    throw new Error('header/footer horizontal alignment must be left, center, or right');
  }
  if (!VERTICAL_ALIGNS.has(header.vertical) || !VERTICAL_ALIGNS.has(footer.vertical)) {
    throw new Error('header/footer vertical alignment must be top, center, or bottom');
  }
}

/**
 * 用一个文案段落替换整个页眉/页脚部件的内容。
 *
 * 就地改写根节点，序列化由调用方（阶段）统一负责。
 */
export function applyHeaderFooter(root: XEl, text: string, aligns: Alignments): void {
  const firstParagraph = childEls(root, 'w:p')[0];
  const styleId = firstParagraph
    ? attr(child(firstParagraph, 'w:pPr/w:pStyle'), 'w:val')
    : undefined;

  while (root.firstChild) root.removeChild(root.firstChild);

  const paragraph = addEl(root, 'w:p');
  const ppr = addEl(paragraph, 'w:pPr');
  if (styleId) setAttr(addEl(ppr, 'w:pStyle'), 'w:val', styleId);
  setAttr(addEl(ppr, 'w:jc'), 'w:val', aligns.horizontal);
  setAttr(addEl(ppr, 'w:textAlignment'), 'w:val', aligns.vertical);

  let cursor = 0;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const start = match.index ?? 0;
    appendText(paragraph, text.slice(cursor, start));
    const token = match[1] ?? match[2];
    appendField(paragraph, token === 'page' || token === 'N' ? 'PAGE' : 'NUMPAGES');
    cursor = start + match[0].length;
  }
  appendText(paragraph, text.slice(cursor));
}

// ─────────────────────────────── run 构造 ───────────────────────────────

/** 宋体 rPr：页眉页脚不随正文样式，显式钉死字体。 */
function runProperties(doc: XDoc): XEl {
  const rpr = doc.createElement('w:rPr');
  const rfonts = doc.createElement('w:rFonts');
  for (const [key, value] of [
    ['eastAsia', '宋体'],
    ['ascii', '宋体'],
    ['hAnsi', '宋体'],
    ['hint', 'eastAsia'],
  ]) {
    setAttr(rfonts, `w:${key}`, value);
  }
  rpr.appendChild(rfonts);
  return rpr;
}

function appendText(parent: XEl, text: string): void {
  if (!text) return;
  const run = addEl(parent, 'w:r');
  run.appendChild(runProperties(run.ownerDocument));
  const t = addEl(run, 'w:t');
  setText(t, text);
  if (/^\s|\s$/.test(text)) setAttr(t, 'xml:space', 'preserve');
}

/** begin → instrText → separate → 结果 → end，全放在同一个 run 里（Word 认这种最简写法）。 */
function appendField(parent: XEl, instruction: string): void {
  const run = addEl(parent, 'w:r');
  run.appendChild(runProperties(run.ownerDocument));

  const begin = addEl(run, 'w:fldChar');
  setAttr(begin, 'w:fldCharType', 'begin');
  setAttr(begin, 'w:dirty', 'true');

  const instr = addEl(run, 'w:instrText');
  setAttr(instr, 'xml:space', 'preserve');
  setText(instr, ` ${instruction} `);

  setAttr(addEl(run, 'w:fldChar'), 'w:fldCharType', 'separate');
  setText(addEl(run, 'w:t'), '1');
  setAttr(addEl(run, 'w:fldChar'), 'w:fldCharType', 'end');
}
