#!/usr/bin/env python3
"""Write custom text and PAGE/NUMPAGES fields into DOCX headers and footers."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", W)

NS = {"w": W}
PART_RE = re.compile(r"^word/(header|footer)\d*\.xml$")
PLACEHOLDER_RE = re.compile(r"\{(page|pages)\}|(?<![A-Za-z])([NM])(?![A-Za-z])")


def _q(name: str) -> str:
    return f"{{{W}}}{name}"


def _w_attr(name: str) -> str:
    return _q(name)


def _make_run_properties() -> ET.Element:
    rpr = ET.Element(_q("rPr"))
    rfonts = ET.SubElement(rpr, _q("rFonts"))
    rfonts.set(_w_attr("eastAsia"), "宋体")
    rfonts.set(_w_attr("ascii"), "宋体")
    rfonts.set(_w_attr("hAnsi"), "宋体")
    rfonts.set(_w_attr("hint"), "eastAsia")
    return rpr


def _append_text(parent: ET.Element, text: str) -> None:
    if not text:
        return
    run = ET.SubElement(parent, _q("r"))
    run.append(_make_run_properties())
    t = ET.SubElement(run, _q("t"))
    if text[:1].isspace() or text[-1:].isspace():
        t.set(f"{{{XML}}}space", "preserve")
    t.text = text


def _append_field(parent: ET.Element, instruction: str) -> None:
    run = ET.SubElement(parent, _q("r"))
    run.append(_make_run_properties())

    begin = ET.SubElement(run, _q("fldChar"))
    begin.set(_w_attr("fldCharType"), "begin")
    begin.set(_w_attr("dirty"), "true")

    instr = ET.SubElement(run, _q("instrText"))
    instr.set(f"{{{XML}}}space", "preserve")
    instr.text = f" {instruction} "

    separate = ET.SubElement(run, _q("fldChar"))
    separate.set(_w_attr("fldCharType"), "separate")
    result = ET.SubElement(run, _q("t"))
    result.text = "1"

    end = ET.SubElement(run, _q("fldChar"))
    end.set(_w_attr("fldCharType"), "end")


def _append_template(parent: ET.Element, text: str) -> None:
    cursor = 0
    for match in PLACEHOLDER_RE.finditer(text):
        _append_text(parent, text[cursor : match.start()])
        token = match.group(1) or match.group(2)
        _append_field(parent, "PAGE" if token == "page" or token == "N" else "NUMPAGES")
        cursor = match.end()
    _append_text(parent, text[cursor:])


def _set_alignment(ppr: ET.Element, horizontal: str, vertical: str) -> None:
    jc = ppr.find("w:jc", NS)
    if jc is None:
        jc = ET.SubElement(ppr, _q("jc"))
    jc.set(_w_attr("val"), horizontal)
    text_alignment = ppr.find("w:textAlignment", NS)
    if text_alignment is None:
        text_alignment = ET.SubElement(ppr, _q("textAlignment"))
    text_alignment.set(_w_attr("val"), vertical)


def _replace_part(xml_bytes: bytes, text: str, horizontal: str, vertical: str) -> bytes:
    root = ET.fromstring(xml_bytes)
    first_paragraph = root.find("w:p", NS)
    style_id = None
    if first_paragraph is not None:
        style = first_paragraph.find("w:pPr/w:pStyle", NS)
        if style is not None:
            style_id = style.get(_w_attr("val"))

    for child in list(root):
        root.remove(child)

    paragraph = ET.SubElement(root, _q("p"))
    ppr = ET.SubElement(paragraph, _q("pPr"))
    if style_id:
        style = ET.SubElement(ppr, _q("pStyle"))
        style.set(_w_attr("val"), style_id)
    _set_alignment(ppr, horizontal, vertical)
    _append_template(paragraph, text)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def apply_header_footer(
    docx_path: Path,
    *,
    header_text: str | None = None,
    footer_text: str | None = None,
    header_align: str = "center",
    header_vertical_align: str = "center",
    footer_align: str = "center",
    footer_vertical_align: str = "center",
) -> int:
    """Update existing header/footer parts; return the number of changed parts."""
    if header_text is None and footer_text is None:
        return 0

    valid_horizontal = {"left", "center", "right", "both", "distribute"}
    valid_vertical = {"top", "center", "baseline", "bottom", "auto"}
    if header_align not in valid_horizontal or footer_align not in valid_horizontal:
        raise ValueError("header/footer horizontal alignment must be left, center, or right")
    if header_vertical_align not in valid_vertical or footer_vertical_align not in valid_vertical:
        raise ValueError("header/footer vertical alignment must be top, center, or bottom")

    changed = 0
    temp_fd, temp_name = tempfile.mkstemp(suffix=".docx", dir=str(docx_path.parent))
    os.close(temp_fd)
    try:
        with zipfile.ZipFile(docx_path, "r") as source, zipfile.ZipFile(temp_name, "w") as target:
            for item in source.infolist():
                data = source.read(item.filename)
                match = PART_RE.match(item.filename)
                if match:
                    kind = match.group(1)
                    replacement = header_text if kind == "header" else footer_text
                    if replacement is not None:
                        data = _replace_part(
                            data,
                            replacement,
                            header_align if kind == "header" else footer_align,
                            header_vertical_align if kind == "header" else footer_vertical_align,
                        )
                        changed += 1
                target.writestr(item, data)
        shutil.copymode(docx_path, temp_name)
        os.replace(temp_name, docx_path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="写入 DOCX 页眉页脚文案与动态页码")
    parser.add_argument("docx", type=Path)
    parser.add_argument("--header-text")
    parser.add_argument("--footer-text")
    parser.add_argument("--header-align", default="center")
    parser.add_argument("--header-vertical-align", default="center")
    parser.add_argument("--footer-align", default="center")
    parser.add_argument("--footer-vertical-align", default="center")
    args = parser.parse_args()
    count = apply_header_footer(
        args.docx,
        header_text=args.header_text,
        footer_text=args.footer_text,
        header_align=args.header_align,
        header_vertical_align=args.header_vertical_align,
        footer_align=args.footer_align,
        footer_vertical_align=args.footer_vertical_align,
    )
    print(f"[apply_docx_header_footer] 完成，更新 {count} 个部件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
