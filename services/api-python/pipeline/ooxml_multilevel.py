"""DSL 驱动的多级列表注入（用于学校论文标题：一、 / 1.1 / 1.1.1 / 1.1.1.1）。

由 styles.yaml 顶层 `multilevel_list:` 块描述每一级 (ilvl, num_fmt, lvl_text, suff,
is_lgl, start, heading_style)。本模块负责三件事：

  1. 在 `word/numbering.xml` 中找到指定 numId 对应的 abstractNum，按 spec
     重写各 lvl 的 numFmt / lvlText / suff / start / isLgl / pStyle。若 numId
     不存在则在末尾新建一份 abstractNum + num。
  2. 在 `word/styles.xml` 中给每个 spec.levels[i].heading_style 绑定
     numPr(numId, ilvl)，使该标题样式天然挂上多级编号。
  3. 在 `word/document.xml` 中扫描所有段落，对 pStyle 命中且自身缺少 numPr
     的段落补齐 numPr，确保渲染端一定看得到编号。

不依赖 Word，只用 zipfile + xml.etree。
"""
from __future__ import annotations

from typing import Any
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ET.register_namespace("w", W)


def _q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def _find_lvl(ab: ET.Element, ilvl: int) -> ET.Element | None:
    for lvl in ab.findall("w:lvl", NS):
        if lvl.get(_q("ilvl")) == str(ilvl):
            return lvl
    return None


def _set_child(parent: ET.Element, tag: str, attrs: dict[str, str]) -> ET.Element:
    el = parent.find(f"w:{tag}", NS)
    if el is None:
        el = ET.SubElement(parent, _q(tag))
    for k, v in attrs.items():
        el.set(_q(k), v)
    return el


def _remove_child(parent: ET.Element, tag: str) -> None:
    el = parent.find(f"w:{tag}", NS)
    if el is not None:
        parent.remove(el)


def _new_lvl(ilvl: int) -> ET.Element:
    return ET.Element(_q("lvl"), {_q("ilvl"): str(ilvl)})


def _max_abstract_id(root: ET.Element) -> int:
    m = -1
    for ab in root.findall("w:abstractNum", NS):
        try:
            m = max(m, int(ab.get(_q("abstractNumId"), "0")))
        except ValueError:
            pass
    return m


def _max_num_id(root: ET.Element) -> int:
    m = 0
    for n in root.findall("w:num", NS):
        try:
            m = max(m, int(n.get(_q("numId"), "0")))
        except ValueError:
            pass
    return m


def _find_num(root: ET.Element, num_id: int) -> ET.Element | None:
    for n in root.findall("w:num", NS):
        if n.get(_q("numId")) == str(num_id):
            return n
    return None


def _find_abstract_num(root: ET.Element, abstract_id: str) -> ET.Element | None:
    for ab in root.findall("w:abstractNum", NS):
        if ab.get(_q("abstractNumId")) == abstract_id:
            return ab
    return None


# ----- 默认 lvl 视觉属性（缩进，正反与 reference.docx 风格保持一致） -----
_DEFAULT_PPR_IND = {
    # ilvl: (left, hanging) twips
    0: ("0", "0"),
    1: ("0", "0"),
    2: ("0", "0"),
    3: ("0", "0"),
    4: ("0", "0"),
    5: ("0", "0"),
}


def _apply_lvl(lvl: ET.Element, spec_lvl: dict[str, Any]) -> None:
    ilvl = int(spec_lvl["ilvl"])
    lvl.set(_q("ilvl"), str(ilvl))

    # start
    start = int(spec_lvl.get("start", 1))
    _set_child(lvl, "start", {"val": str(start)})

    # numFmt
    fmt = str(spec_lvl.get("num_fmt", "decimal"))
    _set_child(lvl, "numFmt", {"val": fmt})

    # suff
    suff = spec_lvl.get("suff")
    if suff is None:
        _remove_child(lvl, "suff")
    else:
        _set_child(lvl, "suff", {"val": str(suff)})

    # lvlText
    text = str(spec_lvl.get("lvl_text", f"%{ilvl + 1}."))
    _set_child(lvl, "lvlText", {"val": text})

    # lvlJc
    jc = str(spec_lvl.get("align", "left"))
    _set_child(lvl, "lvlJc", {"val": jc})

    # isLgl（把上级中文/罗马/字母等强制按 1,2,3 显示，关键！）
    if spec_lvl.get("is_lgl"):
        if lvl.find("w:isLgl", NS) is None:
            ET.SubElement(lvl, _q("isLgl"))
    else:
        _remove_child(lvl, "isLgl")

    # pStyle 绑定（让该 ilvl 与某 styleId 关联，方便 Word 在更改样式时自动套）
    hstyle = spec_lvl.get("heading_style")
    if hstyle:
        _set_child(lvl, "pStyle", {"val": str(hstyle)})

    # lvlRestart：默认自动按上一级重启；若指定为 0 表示不重启
    restart = spec_lvl.get("restart")
    if restart is None:
        _remove_child(lvl, "lvlRestart")
    else:
        _set_child(lvl, "lvlRestart", {"val": str(int(restart))})


def _patch_abstract_num(ab: ET.Element, spec_levels: list[dict[str, Any]]) -> None:
    # 按 ilvl 排序写入；缺失则新建
    have: dict[int, ET.Element] = {}
    for l in ab.findall("w:lvl", NS):
        v = l.get(_q("ilvl"))
        if v is None:
            continue
        try:
            have[int(v)] = l
        except ValueError:
            continue
    for spec_lvl in spec_levels:
        ilvl = int(spec_lvl["ilvl"])
        lvl = have.get(ilvl)
        if lvl is None:
            lvl = _new_lvl(ilvl)
            ab.append(lvl)
        _apply_lvl(lvl, spec_lvl)


def _ensure_num_pointing_to(root: ET.Element, num_id: int, abstract_id: str) -> ET.Element:
    n = _find_num(root, num_id)
    if n is None:
        # 末尾追加
        n = ET.SubElement(root, _q("num"), {_q("numId"): str(num_id)})
    # 清空 ind/lvlOverride 等
    for child in list(n):
        n.remove(child)
    ET.SubElement(n, _q("abstractNumId"), {_q("val"): abstract_id})
    return n


def apply_to_numbering(numbering_xml: bytes, spec: dict[str, Any]) -> bytes:
    """按 spec 写入/修改 numbering.xml，返回新字节串。"""
    if not numbering_xml.strip():
        # 极少数模板没有 numbering.xml；这里给一个最小骨架
        numbering_xml = (
            b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            b'<w:numbering xmlns:w="' + W.encode() + b'"/>'
        )

    root = ET.fromstring(numbering_xml)
    num_id = int(spec.get("num_id", 2))

    num = _find_num(root, num_id)
    if num is not None:
        abs_el = num.find("w:abstractNumId", NS)
        abstract_id = abs_el.get(_q("val")) if abs_el is not None else None
        ab = _find_abstract_num(root, abstract_id) if abstract_id else None
    else:
        ab = None

    if ab is None:
        new_id = str(_max_abstract_id(root) + 1)
        ab = ET.Element(_q("abstractNum"), {_q("abstractNumId"): new_id})
        # abstractNum 必须出现在 num 之前
        insert_pos = 0
        for i, child in enumerate(list(root)):
            if child.tag == _q("num"):
                insert_pos = i
                break
            insert_pos = i + 1
        root.insert(insert_pos, ab)
        abstract_id = new_id

    # multiLevelType = hybridMultilevel 以兼容旧版 Word 渲染
    _set_child(ab, "multiLevelType", {"val": "hybridMultilevel"})

    # 写入各 lvl
    _patch_abstract_num(ab, spec["levels"])

    # 关联 num → abstractNum
    _ensure_num_pointing_to(root, num_id, abstract_id)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def apply_to_styles(styles_xml: bytes, spec: dict[str, Any]) -> bytes:
    """给每个 heading_style 在 styles.xml 中绑定 numPr。"""
    root = ET.fromstring(styles_xml)
    num_id = int(spec.get("num_id", 2))
    style_to_ilvl: dict[str, int] = {}
    for lvl_spec in spec["levels"]:
        hs = lvl_spec.get("heading_style")
        if hs is not None:
            style_to_ilvl[str(hs)] = int(lvl_spec["ilvl"])

    for s in root.findall("w:style", NS):
        sid = s.get(_q("styleId"), "")
        if sid not in style_to_ilvl:
            continue
        ilvl = style_to_ilvl[sid]
        ppr = s.find("w:pPr", NS)
        if ppr is None:
            ppr = ET.Element(_q("pPr"))
            s.insert(0, ppr)
        # 重写 numPr
        old = ppr.find("w:numPr", NS)
        if old is not None:
            ppr.remove(old)
        np = ET.SubElement(ppr, _q("numPr"))
        ET.SubElement(np, _q("ilvl"), {_q("val"): str(ilvl)})
        ET.SubElement(np, _q("numId"), {_q("val"): str(num_id)})

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def apply_to_document(doc_xml: bytes, spec: dict[str, Any]) -> tuple[bytes, int]:
    """补齐所有命中 heading_style 但段落本身无 numPr 的段落。返回 (新 xml, 修补段数)。"""
    root = ET.fromstring(doc_xml)
    num_id = int(spec.get("num_id", 2))
    style_to_ilvl: dict[str, int] = {}
    for lvl_spec in spec["levels"]:
        hs = lvl_spec.get("heading_style")
        if hs is not None:
            style_to_ilvl[str(hs)] = int(lvl_spec["ilvl"])

    body = root.find("w:body", NS)
    if body is None:
        body = root

    patched = 0
    for p in body.iter(_q("p")):
        ppr = p.find("w:pPr", NS)
        if ppr is None:
            continue
        pstyle = ppr.find("w:pStyle", NS)
        if pstyle is None:
            continue
        sid = pstyle.get(_q("val"), "")
        if sid not in style_to_ilvl:
            continue
        if ppr.find("w:numPr", NS) is not None:
            continue  # 已经有了，不动
        ilvl = style_to_ilvl[sid]
        np = ET.SubElement(ppr, _q("numPr"))
        ET.SubElement(np, _q("ilvl"), {_q("val"): str(ilvl)})
        ET.SubElement(np, _q("numId"), {_q("val"): str(num_id)})
        patched += 1

    return ET.tostring(root, encoding="utf-8", xml_declaration=True), patched


def apply_multilevel(
    numbering_xml: bytes,
    styles_xml: bytes,
    doc_xml: bytes,
    spec: dict[str, Any],
) -> tuple[bytes, bytes, bytes, int]:
    """一次性返回 (numbering, styles, document, 修补段数)。"""
    if not spec or not spec.get("levels"):
        return numbering_xml, styles_xml, doc_xml, 0
    numbering_xml = apply_to_numbering(numbering_xml, spec)
    styles_xml = apply_to_styles(styles_xml, spec)
    doc_xml, patched = apply_to_document(doc_xml, spec)
    return numbering_xml, styles_xml, doc_xml, patched
