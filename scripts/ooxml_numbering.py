"""与 reference.docx 一致的多级标题编号（abstractNum 7 / numId 2 + isLgl）。"""

from __future__ import annotations

from xml.etree import ElementTree as ET

from ooxml_util import NS, W, q

# 学校 reference.docx 内标题多级列表（勿改 numId，与 styles 中 heading 2–5 一致）
HUTB_HEADING_NUM_ID = 2


def _find_lvl(ab: ET.Element, ilvl: int) -> ET.Element | None:
    for lvl in ab.findall("w:lvl", NS):
        if lvl.get(q("ilvl")) == str(ilvl):
            return lvl
    return None


def _find_heading_abstract_num(root: ET.Element) -> ET.Element | None:
    for ab in root.findall("w:abstractNum", NS):
        blob = ET.tostring(ab, encoding="unicode")
        if "%1.%2" in blob and ab.find(".//w:pStyle", NS) is not None:
            return ab
    return None


def _set_lvl_text_fmt(lvl: ET.Element, *, num_fmt: str, lvl_text: str, suff: str | None) -> None:
    nf = lvl.find("w:numFmt", NS)
    if nf is None:
        nf = ET.Element(q("numFmt"))
        lvl.insert(0, nf)
    nf.set(q("val"), num_fmt)
    lt = lvl.find("w:lvlText", NS)
    if lt is None:
        lt = ET.SubElement(lvl, q("lvlText"))
    lt.set(q("val"), lvl_text)
    suff_el = lvl.find("w:suff", NS)
    if suff is None:
        if suff_el is not None:
            lvl.remove(suff_el)
    else:
        if suff_el is None:
            suff_el = ET.SubElement(lvl, q("suff"))
        suff_el.set(q("val"), suff)


def _ensure_is_lgl(lvl: ET.Element) -> None:
    if lvl.find("w:isLgl", NS) is None:
        nf = lvl.find("w:numFmt", NS)
        pos = list(lvl).index(nf) + 1 if nf is not None else len(lvl)
        lvl.insert(pos, ET.Element(q("isLgl")))


def _remove_legacy_injected(root: ET.Element) -> None:
    for aid in ("9001", "9002"):
        for ab in list(root.findall("w:abstractNum", NS)):
            if ab.get(q("abstractNumId")) == aid:
                root.remove(ab)
    for nid in ("9001", "9002"):
        for num in list(root.findall("w:num", NS)):
            if num.get(q("numId")) == nid:
                root.remove(num)


def patch_heading_abstract_num(ab: ET.Element, scheme: str) -> None:
    """按工科/管科只改 ilvl0 章号样式；ilvl1+ 保持 reference 的 %1.%2 + isLgl。"""
    lvl0 = _find_lvl(ab, 0)
    if lvl0 is not None:
        if scheme == "gongke":
            _set_lvl_text_fmt(lvl0, num_fmt="decimal", lvl_text="%1", suff="space")
        else:
            _set_lvl_text_fmt(lvl0, num_fmt="chineseCounting", lvl_text="%1、", suff="nothing")
    for ilvl in (1, 2):
        lvl = _find_lvl(ab, ilvl)
        if lvl is not None:
            _ensure_is_lgl(lvl)
            lr = lvl.find("w:lvlRestart", NS)
            if lr is not None:
                lvl.remove(lr)


def inject_heading_numbering(numbering_xml: bytes, scheme: str) -> bytes:
    if not numbering_xml.strip():
        return numbering_xml

    root = ET.fromstring(numbering_xml)
    _remove_legacy_injected(root)

    ab = _find_heading_abstract_num(root)
    if ab is None:
        return numbering_xml

    patch_heading_abstract_num(ab, scheme)

    ET.register_namespace("w", W)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
