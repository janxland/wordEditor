/**
 * ElementTree 等价的 OOXML DOM 层。
 *
 * 元素一律用带前缀的普通名字（createElement('w:pPr')）创建，序列化时不会追加多余的
 * xmlns 声明；命名空间前缀已在各部件根节点声明。
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export type XEl = Element;
export type XDoc = Document;

export function parseXml(text: string): XDoc {
  return new DOMParser().parseFromString(text, 'application/xml');
}

export function serializeEl(el: XEl): string {
  return XML_DECL + new XMLSerializer().serializeToString(el);
}

/** 'w:pPr' | 'pPr' → 'pPr' */
function bare(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * 限定名（含前缀）。解析得到的节点用 prefix:localName；
 * `createElement('w:t')` 创建的节点 localName 就是 'w:t'，nodeName 相同。
 */
export function qName(el: XEl): string {
  if (el.prefix) return `${el.prefix}:${el.localName}`;
  return el.localName || el.nodeName;
}

/** 去前缀的本地名，如 'w:t' → 't'。 */
export function localOf(el: XEl): string {
  return bare(qName(el));
}

/**
 * 前缀必须一致：`w:t` 不能匹配数学公式的 `m:t`（等价于 ElementTree 的 `{ns}t`）。
 * 无前缀的 name 才按本地名匹配。
 */
function sameName(el: XEl, name: string): boolean {
  const q = qName(el);
  return name.includes(':') ? q === name : localOf(el) === name;
}

/** 直接子元素；name 省略时等价于 Python 的 `list(el)`。 */
export function childEls(el: XEl, name?: string): XEl[] {
  const out: XEl[] = [];
  for (const node of elementChildren(el)) {
    if (!name || sameName(node, name)) out.push(node);
  }
  return out;
}

/** 首层匹配（支持 'w:pPr/w:pStyle' 两段路径）。 */
export function child(el: XEl, path: string): XEl | undefined {
  const steps = path.split('/');
  let current: XEl | undefined = el;
  for (const step of steps) {
    if (!current) return undefined;
    current = childEls(current, step)[0];
  }
  return current;
}

/** 等价于 `el.iter(tag)` / `.//tag`：含自身的后代。 */
export function descendants(el: XEl, name: string): XEl[] {
  const out: XEl[] = [];
  if (sameName(el, name)) out.push(el);
  for (const node of elementChildren(el)) {
    out.push(...descendants(node, name));
  }
  return out;
}

/** 等价于 `el.iter()`：全部后代元素。 */
export function allDescendants(el: XEl): XEl[] {
  const out: XEl[] = [];
  for (const node of elementChildren(el)) {
    out.push(node, ...allDescendants(node));
  }
  return out;
}

export function attr(el: XEl | undefined, name: string): string | undefined {
  if (!el || !el.hasAttribute(name)) return undefined;
  return el.getAttribute(name) ?? undefined;
}

export function setAttr(el: XEl, name: string, value: string | number): void {
  el.setAttribute(name, String(value));
}

/** 元素内全部文本（覆盖 ElementTree 的 text 与 tail）。 */
export function textOf(el: XEl): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes.item(i);
    if (node.nodeType === 3 || node.nodeType === 4) out += node.nodeValue ?? '';
  }
  return out;
}

/**
 * 等价于 Python 的 `for t in el.iter(q('t')): t.text + t.tail`
 * —— 只统计 w:t 的正文与其后紧邻文本节点，不含 w:instrText。
 */
export function wtText(el: XEl): string {
  let out = '';
  for (const t of descendants(el, 'w:t')) {
    out += textOf(t);
    let sibling = t.nextSibling;
    while (sibling && sibling.nodeType === 3) {
      out += sibling.nodeValue ?? '';
      sibling = sibling.nextSibling;
    }
  }
  return out;
}

export function setText(el: XEl, value: string): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  el.appendChild(el.ownerDocument.createTextNode(value));
}

/** 尾随空格需 xml:space="preserve"，否则 Word 会吞掉。 */
export function setTextPreserve(el: XEl, value: string): void {
  setText(el, value);
  if (value.startsWith(' ') || value.endsWith(' ')) el.setAttribute('xml:space', 'preserve');
}

export function newEl(doc: XDoc, name: string): XEl {
  return doc.createElement(name);
}

export function addEl(parent: XEl, name: string): XEl {
  const el = parent.ownerDocument.createElement(name);
  parent.appendChild(el);
  return el;
}

export function addElAt(parent: XEl, name: string, index: number): XEl {
  const el = parent.ownerDocument.createElement(name);
  const ref = elementChildren(parent)[index];
  if (ref) parent.insertBefore(el, ref);
  else parent.appendChild(el);
  return el;
}

/** 不存在则创建；等价于 OOXML 里反复出现的 `get_or_add_*`。 */
export function ensureEl(parent: XEl, name: string): XEl {
  return child(parent, name) ?? addEl(parent, name);
}

export function removeEl(parent: XEl, el: XEl): void {
  parent.removeChild(el);
}

export function cloneEl(el: XEl): XEl {
  return el.cloneNode(true) as XEl;
}

export function insertEl(parent: XEl, el: XEl, index: number): XEl {
  const ref = elementChildren(parent)[index];
  if (ref) parent.insertBefore(el, ref);
  else parent.appendChild(el);
  return el;
}

export function elementChildren(el: XEl | XDoc): XEl[] {
  const out: XEl[] = [];
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes.item(i);
    if (node.nodeType === 1) out.push(node as XEl);
  }
  return out;
}
