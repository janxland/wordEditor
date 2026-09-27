/**
 * OOXML 子元素的 schema 顺序表与「按序写入」原语。
 * 等价于 pipeline/ooxml_schema_order.py。
 *
 * 为什么单独一层：ECMA-376 的 w:tblPr / w:tcPr / w:pPr 都是 sequence，子元素顺序写错
 * Word 会弹「文档有问题」并试着修复。append 到末尾在多数情况下碰巧是对的，但一旦父节点
 * 已有一个排在后面的兄弟（例如 tblPr 里已有 tblLook 再补 tblLayout）就会错位，
 * 所以凡是要往这些容器里塞元素的地方都走这里，而不是各自 append。
 *
 * 只负责「就位」，不负责业务取值——调用方传什么属性就写什么属性。
 */
import { ensureEl, localOf, setAttr, type XEl } from './xml.js';
import type { TagAttrs } from './util.js';

/** w:tblPr 子元素顺序（CT_TblPrBase）。 */
export const TBLPR_ORDER = [
  'tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize',
  'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd',
  'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook',
  'tblCaption', 'tblDescription',
];

/** w:tcPr 子元素顺序（CT_TcPr / CT_TcPrInner）。 */
export const TCPR_ORDER = [
  'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcDirection', 'tcBorders',
  'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark',
  'headers',
];

/** w:pPr 子元素顺序（CT_PPr，只列常见项；表外的一律排在末尾，不改变其相对次序）。 */
export const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr',
  'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd',
  'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct',
  'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
  'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents',
  'suppressOverlap', 'jc', 'textDirection', 'textAlignment',
  'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
  'sectPr', 'pPrChange',
];

/** 表外元素给一个比所有已知项都大的秩，从而整体停在末尾。 */
function rank(el: XEl, order: readonly string[]): number {
  const i = order.indexOf(localOf(el));
  return i < 0 ? order.length : i;
}

/** 把 el 移到父节点里 schema 规定的位置（新建元素默认落在末尾，故需要回插）。 */
export function orderIn(parent: XEl, el: XEl, order: readonly string[]): void {
  const pos = rank(el, order);
  const kids = parent.childNodes;
  let idx = kids.length;
  for (let i = 0; i < kids.length; i += 1) {
    const node = kids[i] as XEl;
    if (node.nodeType !== 1) continue;
    if (rank(node, order) > pos) {
      idx = i;
      break;
    }
  }
  if (el !== kids[idx]) parent.insertBefore(el, kids[idx] ?? null);
}

/** 有则复用、无则新建，按 schema 顺序就位后写属性（同名字段覆盖，其余属性不动）。 */
export function putOrdered(
  parent: XEl,
  name: string,
  order: readonly string[],
  attrs: TagAttrs,
): XEl {
  const el = ensureEl(parent, `w:${name}`);
  orderIn(parent, el, order);
  for (const [key, value] of Object.entries(attrs)) setAttr(el, `w:${key}`, String(value));
  return el;
}

/** 只要容器、不写属性（子元素由调用方自己填，如 tblBorders / tcBorders）。 */
export function ensureOrdered(
  parent: XEl,
  name: string,
  order: readonly string[],
): XEl {
  const el = ensureEl(parent, `w:${name}`);
  orderIn(parent, el, order);
  return el;
}
