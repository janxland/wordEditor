/**
 * numbering.xml 公共原语：abstractNum / num 的查找与插入。
 * 被 multilevel（标题多级编号）与 list-styles（列表样式库）共用。
 */
import { addEl, attr, child, childEls, localOf, parseXml, qName, W, type XEl } from './xml.js';
import { pythonInt } from './util.js';

/** 极少数模板没有 numbering.xml 时的最小骨架（与 Python 侧一致）。 */
const NUMBERING_SKELETON = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W}"/>`;

export function parseNumberingRoot(numberingXml: string | null): XEl {
  return parseXml(numberingXml && numberingXml.trim() ? numberingXml : NUMBERING_SKELETON)
    .documentElement;
}

const abstractNumEls = (root: XEl): XEl[] => childEls(root, 'w:abstractNum');
const numEls = (root: XEl): XEl[] => childEls(root, 'w:num');

const intAttr = (el: XEl, name: string, fallback: number): number =>
  pythonInt(attr(el, `w:${name}`)) ?? fallback;

export function maxAbstractNumId(root: XEl): number {
  return abstractNumEls(root).reduce((m, ab) => Math.max(m, intAttr(ab, 'abstractNumId', 0)), -1);
}

export function usedNumIds(root: XEl): Set<number> {
  return new Set(numEls(root).map((n) => intAttr(n, 'numId', -1)));
}

export function findNum(root: XEl, numId: number): XEl | undefined {
  const target = String(numId);
  return numEls(root).find((n) => attr(n, 'w:numId') === target);
}

export function findAbstractNum(root: XEl, abstractId: string): XEl | undefined {
  return abstractNumEls(root).find((ab) => attr(ab, 'w:abstractNumId') === abstractId);
}

/** num → 其 abstractNumId 数值；缺 abstractNumId 或非法时返回 undefined。 */
export function abstractIdOfNum(root: XEl, numId: number): number | undefined {
  const num = findNum(root, numId);
  if (!num) return undefined;
  const el = child(num, 'w:abstractNumId');
  return el ? pythonInt(attr(el, 'w:val')) : undefined;
}

/** abstractNum 必须出现在 num 之前，否则 Word 打不开。 */
export function addAbstractNum(root: XEl): XEl {
  const id = maxAbstractNumId(root) + 1;
  const ab = root.ownerDocument.createElement('w:abstractNum');
  ab.setAttribute('w:abstractNumId', String(id));
  const children = childEls(root);
  const firstNum = children.find((el) => qName(el) === 'w:num' || localOf(el) === 'num');
  if (firstNum) root.insertBefore(ab, firstNum);
  else root.appendChild(ab);
  return ab;
}

export function linkNumToAbstract(root: XEl, numId: number, abstractId: number | string): XEl {
  const num = findNum(root, numId) ?? addEl(root, 'w:num');
  num.setAttribute('w:numId', String(numId));
  for (const node of childEls(num)) num.removeChild(node);
  addEl(num, 'w:abstractNumId').setAttribute('w:val', String(abstractId));
  return num;
}

export function appendNum(root: XEl, numId: number, abstractId: number | string): XEl {
  const num = addEl(root, 'w:num');
  num.setAttribute('w:numId', String(numId));
  addEl(num, 'w:abstractNumId').setAttribute('w:val', String(abstractId));
  return num;
}
