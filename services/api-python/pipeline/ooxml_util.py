"""docx OOXML 读写工具（zip + ElementTree，不依赖 Word）。"""

from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET

import sys
# 命名空间常量在 api-python 根的 ooxml_ns.py（全仓唯一定义），本目录是 pipeline/，
# 需要把上一级塞进 sys.path 才 import 得到。
_API_DIR = str(Path(__file__).resolve().parents[1])
if _API_DIR not in sys.path:
    sys.path.insert(0, _API_DIR)

from ooxml_ns import NS, W, XML  # noqa: E402

# 「等宽代码段」段落样式集合：三线表对齐 / 代码块转表都靠它识别。
# 全仓唯一定义，不要在调用侧再写一份。
CODE_STYLE_IDS = frozenset({"SourceCode", "VerbatimChar"})

ET.register_namespace("w", W)


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def local_tag(el: ET.Element) -> str:
    return el.tag.split("}", 1)[-1] if "}" in el.tag else el.tag


# ─────────────── 属性容器辅助（styles.xml / numbering.xml 共用） ───────────────
# 这一组是 styles DSL（postprocess_styles / ooxml_multilevel / ooxml_list_styles）
# 的唯一实现。任何新需求改这里，不要在调用侧再写一份。


def ensure_ppr(el: ET.Element) -> ET.Element:
    """取 w:pPr；缺失则新建并插到最前（ECMA-376 要求 pPr 是 style/lvl 的首子元素）。"""
    ppr = el.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.Element(q("pPr"))
        el.insert(0, ppr)
    return ppr


def ensure_rpr(el: ET.Element) -> ET.Element:
    """取 w:rPr；缺失则新建并追加到末尾。"""
    rpr = el.find("w:rPr", NS)
    if rpr is None:
        rpr = ET.SubElement(el, q("rPr"))
    return rpr


def replace_child(parent: ET.Element, tag: str, attrs: dict[str, Any] | None = None) -> ET.Element:
    """删除同名子元素后新建一个；attrs 的值 str() 化后设为 w: 命名空间属性。"""
    old = parent.find(f"w:{tag}", NS)
    if old is not None:
        parent.remove(old)
    el = ET.SubElement(parent, q(tag))
    for k, v in (attrs or {}).items():
        el.set(q(k), str(v))
    return el


def line_spacing_attrs(value: Any) -> dict[str, str]:
    """DSL 的 line_spacing（"single" / 1.5 / "double" / "22pt"）→ w:spacing 属性。"""
    if value in (None, "single"):
        return {"line": "240", "lineRule": "auto"}
    if value in (1.5, "1.5"):
        return {"line": "360", "lineRule": "auto"}
    if value in (2, "double", "2"):
        return {"line": "480", "lineRule": "auto"}
    if isinstance(value, str):
        m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|磅)\s*$", value, re.IGNORECASE)
        if m:
            return {"line": str(int(round(float(m.group(1)) * 20))), "lineRule": "exact"}
    if isinstance(value, (int, float)):
        return {"line": str(int(value)), "lineRule": "auto"}
    raise ValueError(f"unknown line_spacing: {value!r}")


def set_wordwrap_zero(ppr: ET.Element) -> bool:
    """关掉「单词中间换行」+ 允许标点溢出（中文论文排版习惯）。

    返回 True 表示本次真的改了。这是 ElementTree 栈的唯一实现；
    tpl_factory/reference.py 另有一份 python-docx/lxml 栈的孪生
    `_set_wordwrap_zero_docx`，两栈不可互换，别误删另一份。
    """
    ww = ppr.find("w:wordWrap", NS)
    if ww is None:
        replace_child(ppr, "wordWrap", {"val": "0"})
        return True
    if ww.get(q("val")) == "0":
        return False
    ww.set(q("val"), "0")  # 就地改，不重建：pPr 有 schema 顺序，换位置会让 Word 报错
    return True


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
    """按级别解析段落 styleId。

    优先按 styleId 数字候选（兼容 hutb reference：1..5 = heading 1..5），
    但必须核对样式名确实是 heading/标题，否则任意 docx 克隆模板里
    styleId "1" 可能是 Normal，会导致编号挂到正文样式上。"""
    out: dict[int, str] = {}
    for level in range(1, 6):
        want = (f"heading {level}", f"\u6807\u9898 {level}", f"\u6807\u9898{level}")
        candidates = [
            str(level),
            f"Heading{level}",
            f"heading {level}",
            f"\u6807\u9898{level}",
            f"\u6807\u9898 {level}",
        ]
        for sid in candidates:
            s = find_style_by_id(styles_root, sid)
            if s is not None and style_name(s).lower() in want:
                out[level] = sid
                break
        if level not in out:
            for s in styles_root.findall("w:style", NS):
                nm = style_name(s).lower()
                if nm in want:
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


def append_ref_field(
    p: ET.Element,
    bookmark: str,
    display: str,
    rpr: ET.Element,
    wrap: bool = True,
) -> None:
    """插入 REF 交叉引用域。wrap=False 时域结果只显示编号本体，方括号由调用方自行补齐。"""
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
        t.text = f"[{display}]" if wrap else display

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
