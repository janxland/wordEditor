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

    # 第 2 步：DSL 多级列表（同时改 numbering / styles / document）
    if has_ml:
        new_numbering, new_styles, new_doc, patched = apply_multilevel(
            original_numbering, new_styles, original_doc, multilevel
        )
        print(f"[postprocess_multilevel] numId={multilevel.get('num_id', 2)} 段落补齐 {patched} 处")
    else:
        new_numbering, new_doc = original_numbering, original_doc

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
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            if item.filename in overrides_map:
                zout.writestr(item, overrides_map[item.filename])
            else:
                zout.writestr(item, zin.read(item.filename))
            written.add(item.filename)
        # 新增不存在的 part（例如原 docx 无 numbering.xml）
        if has_numbering_output and "word/numbering.xml" not in written:
            zout.writestr("word/numbering.xml", new_numbering)
    shutil.move(str(tmp), str(path))


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
