#!/usr/bin/env python3
"""
OOXML 样式后处理（DSL 驱动）。

读取一个模板 styles.yaml，按声明式规则：
  1. 覆盖已有样式的 pPr / rPr（按 styleId 或 name 匹配）
  2. 注入 / 重写自定义样式（按 name 匹配，缺失则新建）
  3. 注入西文字体（rFonts ascii/hAnsi/cs），保留 eastAsia 等原有属性

用法:
  py scripts/postprocess_styles.py <docx> --styles <yaml>     # DSL 驱动（须显式指定）

DSL 字段见 docs/styles-dsl.md。
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None  # 仅在 --styles 模式下需要

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W)
NS = {"w": W}


def _q(t: str) -> str:
    return f"{{{W}}}{t}"


_HEADER_FOOTER_PART_RE = re.compile(r"^word/(header|footer)\d+\.xml$")


def _local_name(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _looks_like_page_frame_rect(el: ET.Element) -> bool:
    if _local_name(el.tag) != "rect":
        return False
    style = el.get("style", "")
    return (
        el.get("filled") == "f"
        and el.get("stroked") == "t"
        and "mso-position-horizontal-relative:page" in style
        and "mso-position-vertical-relative:page" in style
    )


def _strip_page_frame_shapes(xml_bytes: bytes) -> tuple[bytes, int]:
    """移除页眉/页脚中的整页描边矩形（WPS/Word 兼容回退形状），避免导出文档出现黑框。"""
    root = ET.fromstring(xml_bytes)
    removed = 0

    for parent in root.iter():
        for child in list(parent):
            if _local_name(child.tag) != "pict":
                continue
            has_frame_rect = any(_looks_like_page_frame_rect(desc) for desc in child.iter())
            if has_frame_rect:
                parent.remove(child)
                removed += 1

    if removed == 0:
        return xml_bytes, 0
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), removed


HEADING_IDS = {f"Heading{i}" for i in range(1, 6)} | {f"\u6807\u9898 {i}" for i in range(1, 6)}
HEADING_NAMES = {f"heading {i}" for i in range(1, 6)} | {f"\u6807\u9898 {i}" for i in range(1, 6)}
BODY_IDS = {"Normal", "a", "ae"}  # ae = 文章的正文（reference.docx styleId）
BODY_NAMES = {"normal", "\u6587\u7ae0\u7684\u6b63\u6587"}


# ============================================================
# 低阶 OOXML 操作
# ============================================================
def _style_id(s: ET.Element) -> str:
    return s.get(_q("styleId"), "")


def _style_name(s: ET.Element) -> str:
    n = s.find("w:name", NS)
    return n.get(_q("val"), "") if n is not None else ""


def _ensure_ppr(style: ET.Element) -> ET.Element:
    ppr = style.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.Element(_q("pPr"))
        style.insert(0, ppr)
    return ppr


def _ensure_rpr(style: ET.Element) -> ET.Element:
    rpr = style.find("w:rPr", NS)
    if rpr is None:
        rpr = ET.SubElement(style, _q("rPr"))
    return rpr


def _set_or_replace(parent: ET.Element, tag: str, attrs: dict[str, str]) -> None:
    el = parent.find(f"w:{tag}", NS)
    if el is None:
        el = ET.SubElement(parent, _q(tag))
    for k, v in attrs.items():
        el.set(_q(k), v)


def _replace_child(parent: ET.Element, tag: str, attrs: dict[str, Any] | None = None) -> ET.Element:
    """删除同名子元素并新建一个；attrs 中的值会被 str() 化后设为 w: 命名空间属性。"""
    old = parent.find(f"w:{tag}", NS)
    if old is not None:
        parent.remove(old)
    el = ET.SubElement(parent, _q(tag))
    if attrs:
        for k, v in attrs.items():
            el.set(_q(k), str(v))
    return el


def _remove_children(parent: ET.Element, *tags: str) -> None:
    for tag in tags:
        el = parent.find(f"w:{tag}", NS)
        if el is not None:
            parent.remove(el)


def _set_wordwrap_zero(ppr: ET.Element) -> bool:
    ww = ppr.find("w:wordWrap", NS)
    if ww is not None and ww.get(_q("val")) == "0":
        return False
    _set_or_replace(ppr, "wordWrap", {"val": "0"})
    return True


def _clear_indent(ppr: ET.Element) -> bool:
    changed = False
    for tag in ("w:ind", "w:tabs"):
        el = ppr.find(tag, NS)
        if el is not None:
            ppr.remove(el)
            changed = True
    return changed


def _set_latin_font(style: ET.Element, font: str) -> bool:
    rpr = _ensure_rpr(style)
    rfonts = rpr.find("w:rFonts", NS)
    if rfonts is None:
        rfonts = ET.SubElement(rpr, _q("rFonts"))
    changed = False
    for attr in ("ascii", "hAnsi", "cs"):
        if rfonts.get(_q(attr)) != font:
            rfonts.set(_q(attr), font)
            changed = True
    return changed


def _set_cjk_font(style: ET.Element, font: str) -> bool:
    rpr = _ensure_rpr(style)
    rfonts = rpr.find("w:rFonts", NS)
    if rfonts is None:
        rfonts = ET.SubElement(rpr, _q("rFonts"))
    if rfonts.get(_q("eastAsia")) == font:
        return False
    rfonts.set(_q("eastAsia"), font)
    return True


def _line_spacing_attrs(value: Any) -> dict[str, str]:
    if value in (None, "single"):
        return {"line": "240", "lineRule": "auto"}
    if value in (1.5, "1.5"):
        return {"line": "360", "lineRule": "auto"}
    if value in (2, "double", "2"):
        return {"line": "480", "lineRule": "auto"}
    # 固定磅值，例如 "22pt" → line=440(twips), lineRule=exact
    if isinstance(value, str):
        m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|磅)\s*$", value, re.IGNORECASE)
        if m:
            twips = int(round(float(m.group(1)) * 20))
            return {"line": str(twips), "lineRule": "exact"}
    if isinstance(value, (int, float)):
        return {"line": str(int(value)), "lineRule": "auto"}
    raise ValueError(f"unknown line_spacing: {value!r}")


def _apply_paragraph(style: ET.Element, p: dict[str, Any]) -> None:
    ppr = _ensure_ppr(style)
    if p.get("word_wrap_break_latin"):
        _set_wordwrap_zero(ppr)
    if p.get("clear_indent") or p.get("indent_clear"):
        _clear_indent(ppr)
    sp_attrs: dict[str, str] = {}
    if "line_spacing" in p:
        sp_attrs.update(_line_spacing_attrs(p["line_spacing"]))
    if "spacing_before_dxa" in p:
        sp_attrs["before"] = str(p["spacing_before_dxa"])
    if "spacing_after_dxa" in p:
        sp_attrs["after"] = str(p["spacing_after_dxa"])
    if sp_attrs:
        _replace_child(ppr, "spacing", sp_attrs)
    ind_attrs: dict[str, str] = {}
    if "hanging_indent_chars" in p:
        chars = int(p["hanging_indent_chars"])
        ind_attrs.update({
            "leftChars": "0", "left": "0",
            "hangingChars": str(chars * 100),
            "hanging": str(chars * 210),
            "firstLine": "0", "firstLineChars": "0",
        })
    if "first_line_chars" in p:
        chars = int(p["first_line_chars"])
        first_line = p.get("first_line_dxa")
        if first_line is None:
            # 与学校 reference.docx 常见 ae 样式一致：2 字符 → firstLineChars/firstLine 均为 200
            first_line = chars * 100
        ind_attrs.update({
            "firstLineChars": str(chars * 100),
            "firstLine": str(int(first_line)),
        })
    if ind_attrs:
        _replace_child(ppr, "ind", ind_attrs)
    if "align" in p:
        _set_or_replace(ppr, "jc", {"val": str(p["align"])})
    if "page_break_before" in p:
        if p["page_break_before"]:
            _replace_child(ppr, "pageBreakBefore", {})
        else:
            _set_or_replace(ppr, "pageBreakBefore", {"val": "0"})


def _apply_run(style: ET.Element, r: dict[str, Any], fonts: dict[str, Any]) -> None:
    if "latin_font" in r:
        font = r["latin_font"]
        if font == "inherit":
            font = fonts.get("latin")
        if font:
            _set_latin_font(style, font)
    if "cjk_font" in r:
        font = r["cjk_font"]
        if font == "inherit":
            font = fonts.get("cjk")
        if font:
            _set_cjk_font(style, font)
    if "size_half_pt" in r or "size_cs_half_pt" in r:
        rpr = _ensure_rpr(style)
        sz = r.get("size_half_pt")
        sz_cs = r.get("size_cs_half_pt", sz)
        if sz is not None:
            _replace_child(rpr, "sz", {"val": sz})
        if sz_cs is not None:
            _replace_child(rpr, "szCs", {"val": sz_cs})
    if "bold" in r:
        rpr = _ensure_rpr(style)
        _remove_children(rpr, "b", "bCs")
        if r["bold"]:
            ET.SubElement(rpr, _q("b"))
            ET.SubElement(rpr, _q("bCs"))
    if "color" in r:
        # 形如 "000000" / "auto"；用于强制覆盖 reference.docx 主题色或 Pandoc 高亮残留
        _replace_child(_ensure_rpr(style), "color", {"val": r["color"]})


# ============================================================
# 匹配
# ============================================================
def _is_heading(s: ET.Element) -> bool:
    return _style_id(s) in HEADING_IDS or _style_name(s).lower() in HEADING_NAMES


def _is_body(s: ET.Element) -> bool:
    return _style_id(s) in BODY_IDS or _style_name(s).lower() in BODY_NAMES


def _match_style(s: ET.Element, m: dict[str, Any]) -> bool:
    if "id" in m and _style_id(s) == m["id"]:
        return True
    if "name" in m and _style_name(s) == m["name"]:
        return True
    if "name_regex" in m and re.search(m["name_regex"], _style_name(s).lower()):
        return True
    if "kind" in m:
        k = m["kind"]
        if k == "heading" and _is_heading(s):
            return True
        if k == "body" and _is_body(s):
            return True
    return False


def _find_style_by_name(root: ET.Element, name_val: str) -> ET.Element | None:
    for s in root.findall("w:style", NS):
        if _style_name(s) == name_val:
            return s
    return None


def _find_style_by_id(root: ET.Element, style_id: str) -> ET.Element | None:
    for s in root.findall("w:style", NS):
        if _style_id(s) == style_id:
            return s
    return None


# ============================================================
# DSL apply
# ============================================================
def apply_dsl(xml_bytes: bytes, dsl: dict[str, Any]) -> bytes:
    root = ET.fromstring(xml_bytes)
    fonts = dsl.get("fonts") or {}

    for rule in dsl.get("overrides") or []:
        m = rule.get("match") or {}
        for style in root.findall("w:style", NS):
            if not _match_style(style, m):
                continue
            label = f"{_style_id(style)!r}/{_style_name(style)!r}"
            if rule.get("word_wrap_break_latin") and _set_wordwrap_zero(_ensure_ppr(style)):
                print(f"  - wordWrap=0: {label}")
            if rule.get("clear_indent") and _clear_indent(_ensure_ppr(style)):
                print(f"  - 清缩进: {label}")
            if rule.get("latin_font"):
                font = rule["latin_font"]
                if font == "inherit":
                    font = fonts.get("latin")
                if font and _set_latin_font(style, font):
                    print(f"  - 西文字体={font}: {label}")
            if rule.get("cjk_font"):
                font = rule["cjk_font"]
                if font == "inherit":
                    font = fonts.get("cjk")
                if font and _set_cjk_font(style, font):
                    print(f"  - 中文字体={font}: {label}")
            if "paragraph" in rule:
                _apply_paragraph(style, rule["paragraph"])
                print(f"  - paragraph 覆盖: {label}")
            if "run" in rule:
                _apply_run(style, rule["run"], fonts)
                print(f"  - run 覆盖: {label}")

    for c in dsl.get("custom_styles") or []:
        sid = c["id"]
        name = c["name"]
        based_on = c.get("based_on", "a")
        existing = _find_style_by_id(root, sid)
        if existing is None:
            existing = _find_style_by_name(root, name)
        if existing is not None:
            _remove_children(existing, "pPr", "rPr")
            if existing.find("w:qFormat", NS) is None:
                ET.SubElement(existing, _q("qFormat"))
            target = existing
            print(f"  ~ 覆盖样式: name={name!r} (styleId={_style_id(existing)!r})")
        else:
            target = ET.SubElement(
                root, _q("style"),
                {_q("type"): "paragraph", _q("customStyle"): "1", _q("styleId"): sid},
            )
            ET.SubElement(target, _q("name"), {_q("val"): name})
            ET.SubElement(target, _q("basedOn"), {_q("val"): based_on})
            ET.SubElement(target, _q("qFormat"))
            print(f"  + 新增样式: styleId={sid!r} name={name!r}")
        if "paragraph" in c:
            _apply_paragraph(target, c["paragraph"])
        if "run" in c:
            _apply_run(target, c["run"], fonts)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


# ============================================================
# 摘要 / Abstract / 关键词段落注入
# ============================================================
import re as _re

# 正则：中文摘要/关键词匹配（支持裸文字和方括号变体）
_CN_ABSTRACT_TITLE_RE = _re.compile(
    r"^\s*\[?内容摘要\]?\s*$|^\s*\[?摘\s+要\]?\s*$"
)
_EN_ABSTRACT_TITLE_RE = _re.compile(
    r"^\s*\[?Abstract\]?\s*$", _re.IGNORECASE
)
_CN_KEYWORDS_RE = _re.compile(r"^\s*\[?关键词\]?\s*[:：]?\s*$")
_EN_KEYWORDS_RE = _re.compile(
    r"^\s*\[?Keywords?\]?\s*[:：]?\s*$", _re.IGNORECASE
)
# 章节标题（用于终止摘要状态）
_SECTION_RE = _re.compile(r"^\s*[\u4e00-\u9fff]{1,3}、\s|\A\s*\d+\.\d+\s|\A\s*\d+\s+(?!\d)")
# 参考文献条目
_REF_RE = _re.compile(r"\[[\dA-Za-z]+\]")


def _paragraph_text(p: ET.Element) -> str:
    """提取段落纯文本（忽略域代码）。"""
    parts: list[str] = []
    for r in p.iter(_q("t")):
        if r.text:
            parts.append(r.text)
    return "".join(parts)


def _set_paragraph_style_by_id(p: ET.Element, style_id: str) -> None:
    """给段落设置段落样式（pPr/pStyle）。"""
    ppr = p.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.Element(_q("pPr"))
        p.insert(0, ppr)
    ps = ppr.find("w:pStyle", NS)
    if ps is None:
        ps = ET.SubElement(ppr, _q("pStyle"))
    ps.set(_q("val"), style_id)


def _is_english_only(text: str) -> bool:
    """判断是否全英文（不含 CJK 字符）。"""
    return bool(text) and not _re.search(r"[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]", text)


def apply_abstract_styles(
    doc_xml: bytes,
    styles_xml: bytes,
    *,
    abstract_style_id: str = "ZhaiYao",
    abstract_title_style_id: str = "ZhaiYaoTitle",
    # 英文摘要/关键词使用"文章的正文"样式（ae），而非独立样式
    en_abstract_style_id: str = "ae",
    en_abstract_title_style_id: str = "ae",
    keywords_style_id: str = "KeyWordsZh",
    en_keywords_style_id: str = "ae",
) -> tuple[bytes, int]:
    """识别中文摘要 / Abstract / 关键词段落并注入对应样式。

    匹配逻辑（与 Lua 过滤器对齐）：
      - 裸文字 `[内容摘要]` / `内容摘要` → 摘要标题
      - 裸文字 `[Abstract]` / `Abstract` → 英文摘要标题（使用"文章的正文"样式）
      - 关键词/Keywords 行（可选冒号） → 中文关键词使用独立样式；英文关键词使用"文章的正文"样式
      - 摘要状态中、英文纯段落 → "文章的正文"样式；中文段落 → 摘要
      - 遇到章节标题（一、/ 1. / 1.1 等）终止摘要状态
    """
    root = ET.fromstring(doc_xml)
    body = root.find("w:body", NS)
    if body is None:
        body = root

    in_cn_abstract = False
    in_en_abstract = False
    changed = 0

    for child in list(body):
        if child.tag != _q("p"):
            continue
        text = _paragraph_text(child).strip()

        # 参考文献条目 → 退出所有摘要状态
        if _REF_RE.search(text):
            in_cn_abstract = False
            in_en_abstract = False
            continue

        # 章节标题 → 退出摘要状态
        if _SECTION_RE.search(text):
            in_cn_abstract = False
            in_en_abstract = False
            continue

        # 空段落保留状态
        if not text:
            continue

        # 中文摘要标题
        if _CN_ABSTRACT_TITLE_RE.match(text):
            in_cn_abstract = True
            in_en_abstract = False
            _set_paragraph_style_by_id(child, abstract_title_style_id)
            changed += 1
            continue

        # 英文摘要标题
        if _EN_ABSTRACT_TITLE_RE.match(text):
            in_en_abstract = True
            in_cn_abstract = False
            _set_paragraph_style_by_id(child, en_abstract_title_style_id)
            changed += 1
            continue

        # 中文关键词
        if _CN_KEYWORDS_RE.match(text):
            in_cn_abstract = False
            in_en_abstract = False
            _set_paragraph_style_by_id(child, keywords_style_id)
            changed += 1
            continue

        # 英文关键词
        if _EN_KEYWORDS_RE.match(text):
            in_cn_abstract = False
            in_en_abstract = False
            _set_paragraph_style_by_id(child, en_keywords_style_id)
            changed += 1
            continue

        # 中文摘要正文
        if in_cn_abstract:
            _set_paragraph_style_by_id(child, abstract_style_id)
            changed += 1
            continue

        # 英文摘要正文（仅英文段落；含中文则退出状态避免误标后续正文）
        if in_en_abstract:
            if _is_english_only(text):
                _set_paragraph_style_by_id(child, en_abstract_style_id)
                changed += 1
            else:
                in_en_abstract = False
            continue

    return ET.tostring(root, encoding="utf-8", xml_declaration=True), changed


def patch_docx(path: Path, dsl: dict[str, Any]) -> None:
    multilevel = dsl.get("multilevel_list") or {}
    has_ml = bool(multilevel.get("levels"))
    if has_ml:
        from ooxml_multilevel import apply_multilevel  # 延迟引入

    library = dsl.get("list_style_library") or []
    use_list = dsl.get("use_list_styles") or []
    has_list_styles = bool(use_list)
    if has_list_styles:
        from ooxml_list_styles import apply_list_styles  # 延迟引入

    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path, "r") as zin:
        names = set(zin.namelist())
        original_styles = zin.read("word/styles.xml")
        original_numbering = zin.read("word/numbering.xml") if "word/numbering.xml" in names else b""
        original_doc = zin.read("word/document.xml") if "word/document.xml" in names else b""

    # 第 1 步：DSL 样式覆盖（仅作用于 styles.xml）
    new_styles = apply_dsl(original_styles, dsl)

    # 第 1.5 步：摘要 / Abstract / 关键词段落注入（doc_xml 初态）
    doc_xml = original_doc
    abstract_changed = 0
    if dsl.get("custom_styles"):
        doc_xml, abstract_changed = apply_abstract_styles(original_doc, new_styles)
        if abstract_changed:
            print(f"[postprocess_abstract] 注入摘要/关键词样式 {abstract_changed} 段")

    # 第 2 步：DSL 多级列表（同时改 numbering / styles / document）
    if has_ml:
        new_numbering, new_styles, doc_xml, patched = apply_multilevel(
            original_numbering, new_styles, doc_xml, multilevel
        )
        print(f"[postprocess_multilevel] numId={multilevel.get('num_id', 2)} 段落补齐 {patched} 处")
    else:
        new_numbering = original_numbering

    # 统一 doc_xml → new_doc 传递给后续步骤
    new_doc = doc_xml

    # 第 3 步：列表样式库（DecimalList / BulletList 等）
    if has_list_styles:
        new_numbering, new_styles, used_ids = apply_list_styles(
            new_numbering,
            new_styles,
            library,
            use_list,
            fonts=dsl.get("fonts") or {},
        )
        if used_ids:
            pairs = ", ".join(f"{k}=numId:{v}" for k, v in used_ids.items())
            print(f"[postprocess_list_styles] 启用 {len(used_ids)} 个列表样式 → {pairs}")

        # 第 3.5 步：把 Pandoc 自动生成的散装 numId（每个 -/1. 列表一个新 id）
        # 全部重定向到模板默认列表样式 → 让 use_list_styles 真正落到文档段落上。
        # 默认 = `default_list_style` 显式指定，否则取 use_list_styles 的第一项。
        default_sid = dsl.get("default_list_style")
        if not default_sid and use_list:
            first = use_list[0]
            default_sid = first.get("id") if isinstance(first, dict) else str(first)
        if default_sid and default_sid in used_ids:
            from ooxml_list_styles import redirect_list_num_ids  # type: ignore
            preserved = set(used_ids.values())
            if has_ml:
                try:
                    preserved.add(int(multilevel.get("num_id", 2)))
                except (TypeError, ValueError):
                    pass
            new_doc, new_numbering, redirected = redirect_list_num_ids(
                new_doc, new_numbering, used_ids[default_sid], preserved,
                default_style_id=default_sid,
            )
            if redirected:
                print(
                    f"[postprocess_list_styles] 重定向 {redirected} 处 Pandoc 列表 → "
                    f"{default_sid}(numId:{used_ids[default_sid]}, 每块独立重置)"
                )
        elif default_sid:
            print(f"  ! default_list_style={default_sid!r} 未在 use_list_styles 中启用，跳过重定向")

    has_numbering_output = has_ml or has_list_styles
    overrides_map = {"word/styles.xml": new_styles}
    if (has_ml or has_list_styles) and "word/document.xml" in names:
        overrides_map["word/document.xml"] = new_doc
    if has_numbering_output:
        if "word/numbering.xml" in names:
            overrides_map["word/numbering.xml"] = new_numbering

    written = set()
    removed_page_frames = 0
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            if item.filename in overrides_map:
                zout.writestr(item, overrides_map[item.filename])
            else:
                data = zin.read(item.filename)
                if _HEADER_FOOTER_PART_RE.match(item.filename):
                    data, removed = _strip_page_frame_shapes(data)
                    removed_page_frames += removed
                zout.writestr(item, data)
            written.add(item.filename)
        # 新增不存在的 part（例如原 docx 无 numbering.xml）
        if has_numbering_output and "word/numbering.xml" not in written:
            zout.writestr("word/numbering.xml", new_numbering)
    shutil.move(str(tmp), str(path))
    if removed_page_frames:
        print(f"[postprocess_styles] 已移除页眉/页脚页面黑框 {removed_page_frames} 处")


_LIST_MERGE_KEYS = {"overrides", "custom_styles", "headings", "list_style_library", "use_list_styles"}


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """深合并：base 在前；列表（overrides/custom_styles/headings）做拼接，base 在前，子模板在后（后者覆盖）。其它键 over 胜出。"""
    out: dict[str, Any] = dict(base) if isinstance(base, dict) else {}
    for k, v in (over or {}).items():
        if k in _LIST_MERGE_KEYS and isinstance(v, list) and isinstance(out.get(k), list):
            out[k] = list(out[k]) + list(v)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_dsl(path: Path, _seen: set[Path] | None = None) -> dict[str, Any]:
    """加载 styles.yaml，支持顶层 `extends: 相对路径` 形成链式继承。"""
    if yaml is None:
        raise RuntimeError("需要 pyyaml: py -m pip install pyyaml")
    path = path.resolve()
    _seen = _seen or set()
    if path in _seen:
        raise RuntimeError(f"styles extends 循环: {path}")
    _seen.add(path)
    with path.open(encoding="utf-8") as f:
        dsl = yaml.safe_load(f) or {}
    parent_rel = dsl.pop("extends", None)
    if parent_rel:
        parent_path = (path.parent / parent_rel).resolve()
        base = load_dsl(parent_path, _seen)
        dsl = _deep_merge(base, dsl)
    return dsl


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="OOXML 样式后处理（DSL 驱动）")
    ap.add_argument("docx", type=Path)
    ap.add_argument("--styles", type=Path, required=True, help="模板 styles.yaml（各模板自有 DSL）")
    args = ap.parse_args(argv[1:])

    if not args.docx.is_file():
        print(f"\u627e\u4e0d\u5230\u6587\u4ef6: {args.docx}", file=sys.stderr)
        return 1

    if yaml is None:
        print("\u9700\u8981 pyyaml: py -m pip install pyyaml", file=sys.stderr)
        return 1
    dsl = load_dsl(args.styles)
    print(f"[postprocess_styles] {args.docx}  <- DSL: {args.styles}")

    patch_docx(args.docx, dsl)
    print("[postprocess_styles] \u5b8c\u6210")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
