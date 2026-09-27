/**
 * 三线表后处理：把 document.xml 中所有 w:tbl 的边框改为「顶线 / 栏目线 / 底线」三线。
 * 等价于 pipeline/ooxml_three_line_table.py。
 *
 *   • w:tblPr/w:tblBorders：top/bottom = 1.5pt single，left/right/insideH/insideV = nil
 *   • 表整体：占满版心（100%）+ 水平居中 + 自动布局
 *   • 首行（表头行）每个单元格补一条 0.75pt 栏目线
 *   • 单元格内容居中：段落水平居中 + 单元格垂直居中；代码样式段落保持原样
 *
 * 只写属于三线表的那几个节点（tblPr 里的宽/对齐/布局/边框、tcPr 里的栏目线与 vAlign、
 * 段落 pPr 里的 jc），其余属性一概不碰。元素一律经 schema-order 就位，
 * 顺序表本身不在这里维护。
 */
import {
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
import {
  PPR_ORDER,
  TBLPR_ORDER,
  TCPR_ORDER,
  ensureOrdered,
  putOrdered,
} from './schema-order.js';
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

/** 单元格 tcPr：不存在就建在首位（tcPr 必须是 w:tc 的首个子元素）。 */
function cellPr(tc: XEl): XEl {
  return child(tc, 'w:tcPr') ?? addElAt(tc, 'w:tcPr', 0);
}

function patchTable(tbl: XEl): void {
  const tblPr = child(tbl, 'w:tblPr') ?? addElAt(tbl, 'w:tblPr', 0);

  // 表整体：占满版心（100%）+ 水平居中 —— 三线表工科规范
  putOrdered(tblPr, 'tblW', TBLPR_ORDER, { w: '5000', type: 'pct' });
  putOrdered(tblPr, 'jc', TBLPR_ORDER, { val: 'center' });
  putOrdered(tblPr, 'tblLayout', TBLPR_ORDER, { type: 'autofit' });

  const borders = ensureOrdered(tblPr, 'tblBorders', TBLPR_ORDER);
  for (const c of childEls(borders)) borders.removeChild(c);
  setBorder(borders, 'top', THICK);
  setBorder(borders, 'bottom', THICK);
  setBorder(borders, 'left', NIL);
  setBorder(borders, 'right', NIL);
  setBorder(borders, 'insideH', NIL);
  setBorder(borders, 'insideV', NIL);

  // 单元格：垂直居中 + 段落水平居中（代码样式段落保持左对齐）
  for (const el of allDescendants(tbl)) {
    if (qName(el) !== 'w:tc') continue;
    putOrdered(cellPr(el), 'vAlign', TCPR_ORDER, { val: 'center' });
    for (const p of childEls(el, 'w:p')) {
      const existing = child(p, 'w:pPr');
      const styleId = attr(child(existing ?? p, 'w:pStyle'), 'w:val');
      if (styleId && CODE_STYLE_IDS.has(styleId)) continue;
      const ppr = existing ?? addElAt(p, 'w:pPr', 0);
      putOrdered(ppr, 'jc', PPR_ORDER, { val: 'center' });
    }
  }

  // 表头行下沿的栏目线
  const rows = childEls(tbl, 'w:tr');
  if (!rows.length) return;
  for (const tc of childEls(rows[0], 'w:tc')) {
    setBorder(ensureOrdered(cellPr(tc), 'tcBorders', TCPR_ORDER), 'bottom', LINE);
  }
}

/** 改写 document.xml 根节点里的全部表格，返回改写表格数。 */
export function applyThreeLineTables(documentRoot: XEl): number {
  const tables = descendants(documentRoot, 'w:tbl');
  for (const tbl of tables) patchTable(tbl);
  return tables.length;
}
