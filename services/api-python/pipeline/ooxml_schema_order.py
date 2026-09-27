#!/usr/bin/env python3
"""OOXML 子元素的 schema 顺序表与「按序写入」原语。

等价于 src/pipeline/ooxml/schema-order.ts。

为什么单独一层：ECMA-376 的 w:tblPr / w:tcPr / w:pPr 都是 sequence，子元素顺序写错
Word 会弹「文档有问题」并试着修复。ET.SubElement 一律追加到末尾，多数时候碰巧是对的，
但一旦父节点已有一个排在后面的兄弟（例如 tblPr 里已有 tblLook 再补 tblLayout）就会错位，
所以凡是要往这些容器里塞元素的地方都走这里，而不是各自 append。

只负责「就位」，不负责业务取值——调用方传什么属性就写什么属性。
"""

from __future__ import annotations

from typing import Iterable
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def q(t: str) -> str:
    return f"{{{W}}}{t}"


def local(tag: str) -> str:
    return tag.split("}")[-1]


# w:tblPr 子元素顺序（CT_TblPrBase）
TBLPR_ORDER = [
    "tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize",
    "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders",
    "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription",
]

# w:tcPr 子元素顺序（CT_TcPr / CT_TcPrInner）
TCPR_ORDER = [
    "cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcDirection", "tcBorders",
    "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark",
    "headers",
]

# w:pPr 子元素顺序（CT_PPr，只列常见项；表外的一律排在末尾，不改变其相对次序）
PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl",
    "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens",
    "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
    "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
    "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr",
    "sectPr", "pPrChange",
]


def _rank(tag: str, order: Iterable[str]) -> int:
    order = list(order)
    return order.index(tag) if tag in order else len(order)


def insert_ordered(parent: ET.Element, el: ET.Element, order: Iterable[str]) -> None:
    """把 el 插到父节点里 schema 规定的位置。"""
    order = list(order)
    pos = _rank(local(el.tag), order)
    idx = len(parent)
    for i, child in enumerate(parent):
        if _rank(local(child.tag), order) > pos:
            idx = i
            break
    parent.insert(idx, el)


def put_ordered(parent: ET.Element, tag: str, order: Iterable[str], **attrs: str) -> ET.Element:
    """有则复用、无则新建，按 schema 顺序就位后写属性（同名字段覆盖，其余属性不动）。"""
    el = parent.find(f"w:{tag}", NS)
    if el is None:
        el = ET.Element(q(tag))
        insert_ordered(parent, el, order)
    for k, v in attrs.items():
        el.set(q(k), str(v))
    return el


def ensure_ordered(parent: ET.Element, tag: str, order: Iterable[str]) -> ET.Element:
    """只要容器、不写属性（子元素由调用方自己填，如 tblBorders / tcBorders）。"""
    el = parent.find(f"w:{tag}", NS)
    if el is None:
        el = ET.Element(q(tag))
        insert_ordered(parent, el, order)
    return el
