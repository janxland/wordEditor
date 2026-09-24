/**
 * 附录代码块 → 三线表：把连续 SourceCode / verbatim 段落包进单列两行三线表。
 * 等价于 pipeline/ooxml_verbatim_table.py。
 *
 *   顶线（1.5pt）
 *   表头行：附录代码　titanic_analysis.py   ← 说明这是什么代码
 *   栏目线（0.75pt）
 *   代码行：完整脚本正文（可能跨页续排）
 *   底线（1.5pt）
 *
 * 表头文字取代码块**紧邻前一段**里的脚本文件名，找不到则用「附录代码」。
 * 必须在 three-line-table 之后运行：否则三线表会把代码单元格段落居中、
 * 并给代码首行加一条栏目线。
 */
import {
  addEl,
  allDescendants,
  attr,
  child,
  childEls,
  newEl,
  qName,
  setAttr,
  setText,
  wtText,
  type XEl,
} from './xml.js';
import type { TagAttrs } from './util.js';

/** 代码段样式；与三线表的排除清单一致。 */
const CODE_STYLE_IDS = new Set(['SourceCode', 'VerbatimChar']);
/** 正文可用宽度：A4(21cm) − 左右各 3.17cm ≈ 14.66cm ≈ 8312 twips，留 12 twips 余量。 */
const TABLE_W = '8300';
/** 1.5pt 顶/底线。 */
const LINE: TagAttrs = { val: 'single', sz: '12', space: '0', color: 'auto' };
/** 0.75pt 栏目线。 */
const RULE: TagAttrs = { val: 'single', sz: '6', space: '0', color: 'auto' };
const NIL: TagAttrs = { val: 'nil' };

/** 脚本名支持任意扩展名（.py/.sh/.csv/.wbt…），且只取「文件名.扩展名」形态。 */
const SCRIPT_NAME_RE = /([A-Za-z_][\p{L}\p{N}_-]*\.(?:py|sh|csv|wbt|proto|yaml|json|md|log))/u;
const DEFAULT_CAPTION = '附录代码';

function isVerbatimParagraph(p: XEl): boolean {
  const ps = child(child(p, 'w:pPr') ?? p, 'w:pStyle');
  const styleId = attr(ps, 'w:val');
  if (styleId && CODE_STYLE_IDS.has(styleId)) return true;
  // Pandoc 的代码块也可能只靠 w:br / w:tab 分行排版
  return allDescendants(p).some((el) => qName(el) === 'w:br' || qName(el) === 'w:tab');
}

function border(parent: XEl, edge: string, attrs: TagAttrs): void {
  const el = addEl(parent, `w:${edge}`);
  for (const [key, value] of Object.entries(attrs)) setAttr(el, `w:${key}`, value);
}

/**
 * 从代码块紧邻的前一段找脚本名，组成表头文字。
 *
 * 只看紧邻的一段：越界回扫会让无文件名的代码块（如日志节选）错误继承更早代码块的文件名。
 */
function detectCaption(preceding: readonly XEl[]): string {
  for (let i = preceding.length - 1; i >= 0; i -= 1) {
    if (qName(preceding[i]) !== 'w:p') continue;
    const m = SCRIPT_NAME_RE.exec(wtText(preceding[i]));
    return m ? `${DEFAULT_CAPTION}\u3000${m[1]}` : DEFAULT_CAPTION; // 只看紧邻一段
  }
  return DEFAULT_CAPTION;
}

/** 表头单元格里的说明段落：居中、宋体五号。 */
function captionPara(root: XEl, text: string): XEl {
  const doc = root.ownerDocument;
  const p = newEl(doc, 'w:p');
  const ppr = addEl(p, 'w:pPr');
  setAttr(addEl(ppr, 'w:jc'), 'w:val', 'center');
  const spacing = addEl(ppr, 'w:spacing');
  setAttr(spacing, 'w:before', 40);
  setAttr(spacing, 'w:after', 40);
  setAttr(spacing, 'w:line', 240);
  setAttr(spacing, 'w:lineRule', 'auto');
  setAttr(addEl(addEl(ppr, 'w:rPr'), 'w:sz'), 'w:val', 21);

  const r = addEl(p, 'w:r');
  const rr = addEl(r, 'w:rPr');
  const rf = addEl(rr, 'w:rFonts');
  setAttr(rf, 'w:ascii', 'Times New Roman');
  setAttr(rf, 'w:hAnsi', 'Times New Roman');
  setAttr(rf, 'w:eastAsia', '宋体');
  setAttr(rf, 'w:hint', 'eastAsia');
  setAttr(addEl(rr, 'w:sz'), 'w:val', 21);
  setAttr(addEl(rr, 'w:szCs'), 'w:val', 21);
  const t = addEl(r, 'w:t');
  setText(t, text);
  setAttr(t, 'xml:space', 'preserve');
  return p;
}

function tableCell(root: XEl, width: string, children: readonly XEl[]): XEl {
  const tc = newEl(root.ownerDocument, 'w:tc');
  const tcPr = addEl(tc, 'w:tcPr');
  const tcW = addEl(tcPr, 'w:tcW');
  setAttr(tcW, 'w:w', width);
  setAttr(tcW, 'w:type', 'dxa');
  for (const c of children) tc.appendChild(c);
  return tc;
}

/** 顶线 + 表头行 + 栏目线 + 代码行 + 底线。 */
function makeTable(root: XEl, paras: readonly XEl[], caption: string): XEl {
  const doc = root.ownerDocument;
  const tbl = newEl(doc, 'w:tbl');
  const tblPr = addEl(tbl, 'w:tblPr');

  const tblW = addEl(tblPr, 'w:tblW');
  setAttr(tblW, 'w:type', 'dxa');
  setAttr(tblW, 'w:w', TABLE_W);
  setAttr(addEl(tblPr, 'w:jc'), 'w:val', 'center');
  setAttr(addEl(tblPr, 'w:tblLayout'), 'w:type', 'fixed');

  const borders = addEl(tblPr, 'w:tblBorders');
  border(borders, 'top', LINE);
  border(borders, 'bottom', LINE);
  border(borders, 'left', NIL);
  border(borders, 'right', NIL);
  border(borders, 'insideH', NIL);
  border(borders, 'insideV', NIL);

  const cellMar = addEl(tblPr, 'w:tblCellMar');
  for (const edge of ['top', 'left', 'bottom', 'right']) {
    const e = addEl(cellMar, `w:${edge}`);
    setAttr(e, 'w:w', 0);
    setAttr(e, 'w:type', 'dxa');
  }

  setAttr(addEl(addEl(tbl, 'w:tblGrid'), 'w:gridCol'), 'w:w', TABLE_W);

  // 第一行：表头（顶线与栏目线之间）——说明这段是什么代码。
  // 不设 tblHeader：长代码跨页时表头不重复，与 PDF 链路（.codecap 只出现一次）一致。
  const headTc = tableCell(root, TABLE_W, [captionPara(root, caption)]);
  border(addEl(child(headTc, 'w:tcPr')!, 'w:tcBorders'), 'bottom', RULE);
  const headTr = addEl(tbl, 'w:tr');
  headTr.appendChild(headTc);

  // 第二行：代码本体（栏目线与底线之间）
  const codeTr = addEl(tbl, 'w:tr');
  codeTr.appendChild(tableCell(root, TABLE_W, paras));
  return tbl;
}

/** 表格后的空段落（极小字号，避免多出一行空白）。 */
function spacer(root: XEl): XEl {
  const p = newEl(root.ownerDocument, 'w:p');
  setAttr(addEl(addEl(addEl(p, 'w:pPr'), 'w:rPr'), 'w:sz'), 'w:val', 4);
  return p;
}

export interface VerbatimTableResult {
  /** 包成的表格数。 */
  count: number;
  captions: string[];
}

/** 就地改写 document.xml 根节点：连续代码段 → 单列两行三线表。 */
export function applyVerbatimTables(documentRoot: XEl): VerbatimTableResult {
  const body = child(documentRoot, 'w:body');
  if (!body) return { count: 0, captions: [] };

  const kids = childEls(body);
  const out: XEl[] = [];
  const captions: string[] = [];
  let count = 0;

  let i = 0;
  while (i < kids.length) {
    const el = kids[i];
    if (qName(el) !== 'w:p' || !isVerbatimParagraph(el)) {
      out.push(el);
      i += 1;
      continue;
    }
    // 内层把 i 停在代码块之后的首个元素上，外层不再推进，避免漏掉该元素。
    const block: XEl[] = [];
    while (i < kids.length && qName(kids[i]) === 'w:p' && isVerbatimParagraph(kids[i])) {
      block.push(kids[i]);
      i += 1;
    }
    const caption = detectCaption(out);
    out.push(makeTable(documentRoot, block, caption), spacer(documentRoot));
    captions.push(caption);
    count += 1;
  }

  if (count === 0) return { count: 0, captions: [] };

  // 代码段已被搬进表格，不能再按原列表逐个 removeChild：先清空再按新顺序全部回填。
  while (body.firstChild) body.removeChild(body.firstChild);
  for (const el of out) body.appendChild(el);
  return { count, captions };
}
