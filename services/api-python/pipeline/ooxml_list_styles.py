"""DSL 驱动的列表样式注入（list_style_library + use_list_styles）。

设计哲学（松耦合 + 高效）：

  • 库（list_style_library）单独成 yaml，可被任意 styles.yaml 通过 `extends:` 引入
  • 模板用 `use_list_styles:` 声明启用哪些样式，并可单独覆盖 paragraph 字段
  • 元样式 ListBase 自带 0 缩进 / 无制表符 —— 派生样式只需声明编号差异
  • 段落属性 / run 属性的注入复用 postprocess_styles 中已有的 `_apply_paragraph`
    / `_apply_run`，零重复实现
  • numId 从 100 起分配，与 multilevel_list 的低位 numId 完全隔离

入口：apply_list_styles(numbering_xml, styles_xml, library, use_list,
                       fonts=None, base_num_id=100, used_num_ids=None)
返回：(new_numbering_xml, new_styles_xml, used_ids)
        used_ids: dict[id -> num_id]，便于 Lua / 调试输出
"""
from __future__ import annotations

import copy
from typing import Any
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ET.register_namespace("w", W)


def _q(tag: str) -> str:
    return f"{{{W}}}{tag}"


# ─────────────────────────────── 库样式扁平化 ───────────────────────────────

def _merge_dict(base: dict | None, over: dict | None) -> dict:
    out = dict(base or {})
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_dict(out[k], v)
        else:
            out[k] = v
    return out


def flatten_library(library: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """处理 based_on 继承链，返回 id -> 扁平 style 字典。

    继承字段：paragraph / run / list；id / name / based_on 沿用子项。
    """
    idx = {s["id"]: s for s in library if isinstance(s, dict) and s.get("id")}
    cache: dict[str, dict[str, Any]] = {}

    def resolve(sid: str, chain: tuple[str, ...] = ()) -> dict[str, Any]:
        if sid in cache:
            return cache[sid]
        if sid in chain:
            raise ValueError(f"list_style_library based_on 循环: {' -> '.join(chain + (sid,))}")
        s = idx.get(sid)
        if s is None:
            return {}
        based = s.get("based_on")
        parent: dict[str, Any] = {}
        if based and based in idx:  # 仅当父也在库内才向上合并
            parent = resolve(based, chain + (sid,))
        flat: dict[str, Any] = copy.deepcopy(s)
        for key in ("paragraph", "run", "list"):
            flat[key] = _merge_dict(parent.get(key), flat.get(key))
        cache[sid] = flat
        return flat

    return {sid: resolve(sid) for sid in idx}


def resolve_use_list(
    library_flat: dict[str, dict[str, Any]],
    use_list: list[dict[str, Any] | str],
) -> list[dict[str, Any]]:
    """把模板的 use_list_styles 解析为最终样式列表（应用 overrides）。"""
    out: list[dict[str, Any]] = []
    for item in use_list or []:
        if isinstance(item, str):
            sid, overrides = item, None
        elif isinstance(item, dict):
            sid = item.get("id")
            overrides = item.get("overrides") or item.get("override")
        else:
            continue
        if not sid or sid not in library_flat:
            print(f"  ! 列表样式库未找到: {sid!r}")
            continue
        flat = copy.deepcopy(library_flat[sid])
        if overrides:
            for key in ("paragraph", "run", "list", "name", "based_on"):
                if key in overrides:
                    if isinstance(overrides[key], dict):
                        flat[key] = _merge_dict(flat.get(key), overrides[key])
                    else:
                        flat[key] = overrides[key]
        out.append(flat)
    return out


# ─────────────────────────────── numbering.xml ───────────────────────────────

def _max_abstract_id(root: ET.Element) -> int:
    m = -1
    for ab in root.findall("w:abstractNum", NS):
        try:
            m = max(m, int(ab.get(_q("abstractNumId"), "-1")))
        except ValueError:
            pass
    return m


def _used_num_ids(root: ET.Element) -> set[int]:
    out: set[int] = set()
    for n in root.findall("w:num", NS):
        try:
            out.add(int(n.get(_q("numId"), "-1")))
        except ValueError:
            pass
    return out


def _ensure_numbering_root(numbering_xml: bytes) -> ET.Element:
    if not numbering_xml.strip():
        skeleton = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<w:numbering xmlns:w="{W}"/>'
        ).encode()
        return ET.fromstring(skeleton)
    return ET.fromstring(numbering_xml)


def _make_abstract_num(abstract_id: int, style: dict[str, Any]) -> ET.Element:
    """从扁平 style 生成单级 abstractNum。"""
    ab = ET.Element(_q("abstractNum"), {_q("abstractNumId"): str(abstract_id)})
    ET.SubElement(ab, _q("multiLevelType"), {_q("val"): "hybridMultilevel"})

    lst = style.get("list") or {}
    lvl = ET.SubElement(ab, _q("lvl"), {_q("ilvl"): "0"})
    ET.SubElement(lvl, _q("start"), {_q("val"): str(int(lst.get("start", 1)))})
    ET.SubElement(lvl, _q("numFmt"), {_q("val"): str(lst.get("num_fmt", "decimal"))})
    suff = lst.get("suff")
    if suff:
        ET.SubElement(lvl, _q("suff"), {_q("val"): str(suff)})
    ET.SubElement(lvl, _q("lvlText"), {_q("val"): str(lst.get("lvl_text", "%1."))})
    ET.SubElement(lvl, _q("lvlJc"), {_q("val"): str(lst.get("align", "left"))})
    # pStyle 绑定到本列表样式 id，方便 Word 在更改样式时自动套
    ET.SubElement(lvl, _q("pStyle"), {_q("val"): style["id"]})
    return ab


def _insert_before_num(root: ET.Element, node: ET.Element) -> None:
    """abstractNum 必须出现在 num 之前。"""
    for i, child in enumerate(list(root)):
        if child.tag == _q("num"):
            root.insert(i, node)
            return
    root.append(node)


# ─────────────────────────────── styles.xml ───────────────────────────────

def _find_style(root: ET.Element, sid: str) -> ET.Element | None:
    for s in root.findall("w:style", NS):
        if s.get(_q("styleId")) == sid:
            return s
    return None


def _ensure_style(root: ET.Element, sid: str, name: str, based_on: str) -> ET.Element:
    s = _find_style(root, sid)
    if s is not None:
        # 清掉 pPr / rPr 以便重写，但保留 name/basedOn/qFormat
        for tag in ("w:pPr", "w:rPr"):
            el = s.find(tag, NS)
            if el is not None:
                s.remove(el)
        return s
    s = ET.SubElement(
        root,
        _q("style"),
        {_q("type"): "paragraph", _q("customStyle"): "1", _q("styleId"): sid},
    )
    ET.SubElement(s, _q("name"), {_q("val"): name})
    ET.SubElement(s, _q("basedOn"), {_q("val"): based_on or "a"})
    ET.SubElement(s, _q("qFormat"))
    return s


def _attach_num_pr(style: ET.Element, num_id: int, ilvl: int = 0) -> None:
    ppr = style.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.SubElement(style, _q("pPr"))
        # 让 pPr 在 rPr 之前（OOXML 推荐顺序）
        # 不强制重排：现代 Word/WPS 都能容忍。
    # 重写 numPr
    old = ppr.find("w:numPr", NS)
    if old is not None:
        ppr.remove(old)
    np = ET.SubElement(ppr, _q("numPr"))
    ET.SubElement(np, _q("ilvl"), {_q("val"): str(ilvl)})
    ET.SubElement(np, _q("numId"), {_q("val"): str(num_id)})


# ─────────────────────────────── 主入口 ───────────────────────────────

def apply_list_styles(
    numbering_xml: bytes,
    styles_xml: bytes,
    library: list[dict[str, Any]],
    use_list: list[Any],
    *,
    fonts: dict[str, Any] | None = None,
    base_num_id: int = 100,
) -> tuple[bytes, bytes, dict[str, int]]:
    """注入选中的列表样式到 numbering.xml + styles.xml。

    返回 (新 numbering_xml, 新 styles_xml, {sid: num_id})。
    若 use_list 为空 → 原样返回，不修改任何东西。
    """
    if not use_list:
        return numbering_xml, styles_xml, {}

    # 1) 解析库 + 启用项
    lib_flat = flatten_library(library or [])
    resolved = resolve_use_list(lib_flat, use_list)
    if not resolved:
        return numbering_xml, styles_xml, {}

    # 2) numbering.xml: 为每个启用样式创建 abstractNum + num
    num_root = _ensure_numbering_root(numbering_xml)
    used = _used_num_ids(num_root)
    next_abs_id = _max_abstract_id(num_root) + 1

    new_nums: list[tuple[int, int]] = []  # (num_id, abstract_id)
    used_ids: dict[str, int] = {}

    next_id = base_num_id
    for style in resolved:
        while next_id in used:
            next_id += 1
        num_id = next_id
        next_id += 1
        abs_id = next_abs_id
        next_abs_id += 1
        ab = _make_abstract_num(abs_id, style)
        _insert_before_num(num_root, ab)
        new_nums.append((num_id, abs_id))
        used.add(num_id)
        used_ids[style["id"]] = num_id

    for num_id, abs_id in new_nums:
        n = ET.SubElement(num_root, _q("num"), {_q("numId"): str(num_id)})
        ET.SubElement(n, _q("abstractNumId"), {_q("val"): str(abs_id)})

    new_numbering = ET.tostring(num_root, encoding="utf-8", xml_declaration=True)

    # 3) styles.xml: 创建段落样式 + 写 paragraph/run + 挂 numPr
    #    复用 postprocess_styles 中的段落/字体注入；延迟导入避免循环引用
    from postprocess_styles import _apply_paragraph, _apply_run  # type: ignore

    sty_root = ET.fromstring(styles_xml)
    fonts = fonts or {}
    for style in resolved:
        sid = style["id"]
        s = _ensure_style(sty_root, sid, style.get("name", sid), style.get("based_on", "a"))
        if "paragraph" in style:
            _apply_paragraph(s, style["paragraph"])
        if "run" in style:
            _apply_run(s, style["run"], fonts)
        _attach_num_pr(s, used_ids[sid], ilvl=0)

    new_styles = ET.tostring(sty_root, encoding="utf-8", xml_declaration=True)
    return new_numbering, new_styles, used_ids


# ─────────────────────────────── document.xml 列表重定向 ───────────────────────────────

def _abstract_id_of(num_root: ET.Element, num_id: int) -> int | None:
    target = str(num_id)
    for n in num_root.findall("w:num", NS):
        if n.get(_q("numId")) == target:
            ab = n.find("w:abstractNumId", NS)
            try:
                return int(ab.get(_q("val"), "-1")) if ab is not None else None
            except ValueError:
                return None
    return None


def redirect_list_num_ids(
    document_xml: bytes,
    numbering_xml: bytes,
    default_num_id: int,
    preserved_num_ids: set[int],
    *,
    default_ilvl: int = 0,
    default_style_id: str | None = None,
) -> tuple[bytes, bytes, int]:
    """把 document.xml 中 Pandoc 散装 numId 重定向到模板默认列表样式。

    为每个原 numId 分配一个**独立的新 numId**，都指向 `default_num_id` 对应的
    abstractNumId 并强制 9 级 startOverride=1 → 每个列表块从 1 重新计数。
    若提供 `default_style_id`，同时为这些段落注入 `w:pStyle`，让列表段套用
    DSL 中定义的列表样式（如「数字列表」），从而继承基样式（如「文章的正文」）
    的字体/字号/行距。找不到 abstract 时退化为共享 `default_num_id`。

    返回 (新 document_xml, 新 numbering_xml, 重写次数)。
    """
    if not document_xml.strip():
        return document_xml, numbering_xml, 0
    doc_root = ET.fromstring(document_xml)
    num_root = _ensure_numbering_root(numbering_xml)

    target_abs = _abstract_id_of(num_root, default_num_id)
    used = _used_num_ids(num_root)
    next_id = max(used | {default_num_id, 199}) + 1
    mapping: dict[int, int] = {}

    def remap(orig: int) -> int:
        if target_abs is None:
            return default_num_id  # 退化：无可继承的 abstract → 共享 numId
        if orig not in mapping:
            nonlocal next_id
            while next_id in used:
                next_id += 1
            mapping[orig] = next_id
            used.add(next_id)
            next_id += 1
        return mapping[orig]

    count = 0
    for p in doc_root.iter(_q("p")):
        ppr = p.find("w:pPr", NS)
        if ppr is None:
            continue
        numpr = ppr.find("w:numPr", NS)
        if numpr is None:
            continue
        nid_el = numpr.find("w:numId", NS)
        if nid_el is None:
            continue
        try:
            cur = int(nid_el.get(_q("val"), "-1"))
        except ValueError:
            continue
        if cur <= 0 or cur in preserved_num_ids:
            continue
        nid_el.set(_q("val"), str(remap(cur)))
        if numpr.find("w:ilvl", NS) is None:
            numpr.insert(0, ET.Element(_q("ilvl"), {_q("val"): str(default_ilvl)}))
        if default_style_id:
            ps = ppr.find("w:pStyle", NS)
            if ps is None:
                ppr.insert(0, ET.Element(_q("pStyle"), {_q("val"): default_style_id}))
            else:
                ps.set(_q("val"), default_style_id)
        count += 1

    if count == 0:
        return document_xml, numbering_xml, 0

    for new_id in mapping.values():  # 仅当 target_abs 存在时 mapping 才非空
        n = ET.SubElement(num_root, _q("num"), {_q("numId"): str(new_id)})
        ET.SubElement(n, _q("abstractNumId"), {_q("val"): str(target_abs)})
        for ilvl in range(9):
            lo = ET.SubElement(n, _q("lvlOverride"), {_q("ilvl"): str(ilvl)})
            ET.SubElement(lo, _q("startOverride"), {_q("val"): "1"})

    return (
        ET.tostring(doc_root, encoding="utf-8", xml_declaration=True),
        ET.tostring(num_root, encoding="utf-8", xml_declaration=True),
        count,
    )


