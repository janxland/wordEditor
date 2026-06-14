"""docx OOXML 读写工具（zip + ElementTree，不依赖 Word）。"""

from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", W)
NS = {"w": W}


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def local_tag(el: ET.Element) -> str:
    return el.tag.split("}", 1)[-1] if "}" in el.tag else el.tag


def patch_docx_parts(path: Path, patches: dict[str, Callable[[bytes], bytes]]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            fn = patches.get(item.filename)
            if fn is not None:
                data = fn(data)
            zout.writestr(item, data)
    shutil.move(str(tmp), str(path))


def style_id(el: ET.Element) -> str:
    return el.get(q("styleId"), "")


def style_name(el: ET.Element) -> str:
    n = el.find("w:name", NS)
    return n.get(q("val"), "") if n is not None else ""


def find_style_by_id(root: ET.Element, sid: str) -> ET.Element | None:
    for s in root.findall("w:style", NS):
        if style_id(s) == sid:
            return s
    return None


def style_id_for_heading_level(level: int, heading_ids: dict[int, str]) -> str:
    """
    学校 reference：编号挂在 heading 2–5（styleId 2–5），outline heading 1 无编号。
    逻辑第 1 级（一、/1）→ styleId level+1。
    """
    shifted = level + 1
    if shifted in heading_ids:
        return heading_ids[shifted]
    if level in heading_ids:
        return heading_ids[level]
    raise KeyError(f"未找到标题级别 {level} 对应样式")


def resolve_heading_style_ids(styles_root: ET.Element) -> dict[int, str]:
    """按级别解析段落 styleId（兼容 hutb reference：1..5 = heading 1..5）。"""
    out: dict[int, str] = {}
    for level in range(1, 6):
        candidates = [
            str(level),
            f"Heading{level}",
            f"heading {level}",
            f"\u6807\u9898{level}",
            f"\u6807\u9898 {level}",
        ]
        for sid in candidates:
            if find_style_by_id(styles_root, sid) is not None:
                out[level] = sid
                break
        if level not in out:
            for s in styles_root.findall("w:style", NS):
                nm = style_name(s).lower()
                if nm in (f"heading {level}", f"\u6807\u9898 {level}", f"\u6807\u9898{level}"):
                    out[level] = style_id(s)
                    break
    return out


def paragraph_plain_text(p: ET.Element) -> str:
    parts: list[str] = []
    for t in p.iter(q("t")):
        if t.text:
            parts.append(t.text)
        if t.tail:
            parts.append(t.tail)
    text = "".join(parts).replace("\r", "").replace("\n", "")
    return text.strip()


def run_text_len(el: ET.Element) -> int:
    n = 0
    for t in el.iter(q("t")):
        n += len(t.text or "") + len(t.tail or "")
    return n


def bookmark_starts_in_paragraph(p: ET.Element) -> dict[str, int]:
    """书签名 → 在段落纯文本中的起始偏移。"""
    pos = 0
    found: dict[str, int] = {}
    for child in list(p):
        tag = local_tag(child)
        if tag == "bookmarkStart":
            name = child.get(q("name"), "")
            if name:
                found[name] = pos
        elif tag in ("r", "hyperlink", "ins", "smartTag"):
            pos += run_text_len(child)
        elif tag == "bookmarkEnd":
            pass
        else:
            pos += run_text_len(child)
    return found


def collect_bookmark_names(document_root: ET.Element) -> set[str]:
    names: set[str] = set()
    for el in document_root.iter(q("bookmarkStart")):
        name = el.get(q("name"), "")
        if name:
            names.add(name)
    return names


CHINESE_NUMS = "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343"

_RE_CN_CHAPTER = re.compile(rf"^([{CHINESE_NUMS}]+)、\s*(.+)$")
_RE_L4 = re.compile(r"^(\d+)\.(\d+)\.(\d+)\.(\d+)\s+(.+)$")
_RE_L3 = re.compile(r"^(\d+)\.(\d+)\.(\d+)\s+(.+)$")
_RE_L2 = re.compile(r"^(\d+)\.(\d+)\s+(.+)$")
_RE_L1_NUM = re.compile(r"^(\d+)(?:[.\s])\s*(.+)$")


def parse_heading_line(text: str) -> tuple[int, str] | None:
    """
    识别带编号前缀的标题行，返回 (级别 1–4, 去掉前缀后的标题正文)。
    支持：一、xxx / 1 xxx / 1.1 xxx / 1.1.1 xxx / 1.1.1.1 xxx
    含句末标点（，；。,;.）或长度 > 40 的视为正文/列表项，拒绝识别。
    """
    t = text.strip()
    if not t:
        return None

    def _looks_like_sentence(title: str) -> bool:
        if len(title) > 40:
            return True
        for ch in title:
            if ch in "\uff0c\uff1b\u3002,;.":
                return True
        return False

    m = _RE_CN_CHAPTER.match(t)
    if m:
        title = m.group(2).strip()
        if _looks_like_sentence(title):
            return None
        return 1, title

    m = _RE_L4.match(t)
    if m:
        title = m.group(5).strip()
        if _looks_like_sentence(title):
            return None
        return 4, title

    m = _RE_L3.match(t)
    if m:
        title = m.group(4).strip()
        if _looks_like_sentence(title):
            return None
        return 3, title

    m = _RE_L2.match(t)
    if m:
        title = m.group(3).strip()
        if _looks_like_sentence(title):
            return None
        return 2, title

    m = _RE_L1_NUM.match(t)
    if m and "." not in m.group(2)[:3]:
        title = m.group(2).strip()
        if _looks_like_sentence(title):
            return None
        return 1, title

    return None


def set_paragraph_heading_style(
    p: ET.Element,
    style_id_val: str,
    title_text: str,
    *,
    num_id: int | None = None,
    ilvl: int | None = None,
) -> None:
    """套用标题样式、多级编号，并将段落文本替换为无编号前缀的标题。"""
    from ooxml_numbering import HUTB_HEADING_NUM_ID  # 避免循环 import 在模块顶

    nid = num_id if num_id is not None else HUTB_HEADING_NUM_ID
    level_ilvl = ilvl if ilvl is not None else max(0, int(style_id_val) - 1) if style_id_val.isdigit() else 0

    ppr = p.find("w:pPr", NS)
    if ppr is not None:
        p.remove(ppr)
    ppr = ET.Element(q("pPr"))
    p.insert(0, ppr)

    ps = ET.SubElement(ppr, q("pStyle"))
    ps.set(q("val"), style_id_val)

    num_pr = ET.SubElement(ppr, q("numPr"))
    ET.SubElement(num_pr, q("ilvl"), {q("val"): str(level_ilvl)})
    ET.SubElement(num_pr, q("numId"), {q("val"): str(nid)})

    for child in list(p):
        if local_tag(child) != "pPr":
            p.remove(child)

    append_text_run(p, title_text)


def copy_rpr_superscript() -> ET.Element:
    rpr = ET.Element(q("rPr"))
    ET.SubElement(rpr, q("vertAlign"), {q("val"): "superscript"})
    return rpr


def append_text_run(p: ET.Element, text: str, rpr: ET.Element | None = None) -> None:
    r = ET.SubElement(p, q("r"))
    if rpr is not None:
        r.append(ET.fromstring(ET.tostring(rpr)))
    t = ET.SubElement(r, q("t"))
    if text.startswith(" ") or text.endswith(" "):
        t.set(f"{{{XML}}}space", "preserve")
    t.text = text


def append_ref_field(p: ET.Element, bookmark: str, display: str, rpr: ET.Element) -> None:
    def add_run(build: Callable[[ET.Element], None]) -> None:
        r = ET.SubElement(p, q("r"))
        r.append(ET.fromstring(ET.tostring(rpr)))
        build(r)

    add_run(lambda r: ET.SubElement(r, q("fldChar"), {q("fldCharType"): "begin"}))

    def _instr(r: ET.Element) -> None:
        instr = ET.SubElement(r, q("instrText"), {f"{{{XML}}}space": "preserve"})
        instr.text = f" REF {bookmark} \\h "

    add_run(_instr)
    add_run(lambda r: ET.SubElement(r, q("fldChar"), {q("fldCharType"): "separate"}))

    def _result(r: ET.Element) -> None:
        t = ET.SubElement(r, q("t"))
        t.text = f"[{display}]"

    add_run(_result)
    add_run(lambda r: ET.SubElement(r, q("fldChar"), {q("fldCharType"): "end"}))


def rebuild_paragraph_content(p: ET.Element, build_runs: Callable[[ET.Element], None]) -> None:
    ppr = p.find("w:pPr", NS)
    ppr_copy = ET.fromstring(ET.tostring(ppr)) if ppr is not None else None
    for child in list(p):
        p.remove(child)
    if ppr_copy is not None:
        p.append(ppr_copy)
    build_runs(p)
