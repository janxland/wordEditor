/**
 * 三线表后处理：把 document.xml 中所有 w:tbl 的边框改为「顶线 / 栏目线 / 底线」三线。
 * 等价于 pipeline/ooxml_three_line_table.py。
 *
 *   • w:tblPr/w:tblBorders：top/bottom = 1.5pt single，left/right/insideH/insideV = nil
 *   • 表格整体水平居中；首行（表头行）每个单元格补一条 0.75pt 栏目线
 *   • 单元格内段落居中（覆盖 Pandoc 默认左对齐），代码样式段落保持原样
 */
import {
  addEl,
  addElAt,
  allDescendants,
  attr,
  child,
  childEls,
  descendants,
  ensureEl,
  qName,
  setAttr,
  type XEl,
} from './xml.js';
import type { TagAttrs } from './util.js';

/** 栏目线 0.75pt。 */
const LINE: TagAttrs = { val: 'single', sz: '6', space: '0', color: 'auto' };
/** 顶线 / 底线 1.5pt。 */
const THICK: TagAttrs = { val: 'single', sz: '12', space: '0', color: 'auto' };
const NIL: TagAttrs = { val: 'nil' };
/** 代码类段落：不参与居中。 */
const CODE_STYLE_IDS = new Set(['SourceCode', 'VerbatimChar']);

/** 有则复用、无则新建，并清掉残留属性后整组重写（Python 的 attrib.clear()）。 */
function setBorder(parent: XEl, edge: string, attrs: TagAttrs): void {
  const el = ensureEl(parent, `w:${edge}`);
  for (const name of Array.from(el.attributes, (a) => a.name)) el.removeAttribute(name);
  for (const [key, value] of Object.entries(attrs)) setAttr(el, `w:${key}`, value);
}

function patchTable(tbl: XEl): void {
  const tblPr = child(tbl, 'w:tblPr') ?? addElAt(tbl, 'w:tblPr', 0);

  // 表整体水平居中
  setAttr(ensureEl(tblPr, 'w:jc'), 'w:val', 'center');

  const borders = ensureEl(tblPr, 'w:tblBorders');
  for (const c of childEls(borders)) borders.removeChild(c);
  setBorder(borders, 'top', THICK);
  setBorder(borders, 'bottom', THICK);
  setBorder(borders, 'left', NIL);
  setBorder(borders, 'right', NIL);
  setBorder(borders, 'insideH', NIL);
  setBorder(borders, 'insideV', NIL);

  const rows = childEls(tbl, 'w:tr');
  if (rows.length) {
    // 表头行下沿的栏目线
    for (const tc of childEls(rows[0], 'w:tc')) {
      const tcPr = child(tc, 'w:tcPr') ?? addElAt(tc, 'w:tcPr', 0);
      setBorder(ensureEl(tcPr, 'w:tcBorders'), 'bottom', LINE);
    }
  }

  // 所有单元格段落水平居中；代码样式段落保持左对齐
  for (const tc of allDescendants(tbl)) {
    if (qName(tc) !== 'w:tc') continue;
    for (const p of childEls(tc, 'w:p')) {
      const existing = child(p, 'w:pPr');
      const styleId = attr(child(existing ?? p, 'w:pStyle'), 'w:val');
      if (styleId && CODE_STYLE_IDS.has(styleId)) continue;
      const ppr = existing ?? addElAt(p, 'w:pPr', 0);
      setAttr(ensureEl(ppr, 'w:jc'), 'w:val', 'center');
    }
  }
}

/** 改写 document.xml 根节点里的全部表格，返回改写表格数。 */
export function applyThreeLineTables(documentRoot: XEl): number {
  const tables = descendants(documentRoot, 'w:tbl');
  for (const tbl of tables) patchTable(tbl);
  return tables.length;
}
