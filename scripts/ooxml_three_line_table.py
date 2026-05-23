#!/usr/bin/env python3
"""三线表后处理：把 docx 中所有 w:tbl 的边框改为「顶/表头底/底」三线。

不依赖 Word；通过修改 word/document.xml：
  - w:tblPr/w:tblBorders 设 top=single, bottom=single, insideH/insideV/left/right=nil
  - 首行（表头行）的每个 w:tc/w:tcPr/w:tcBorders/bottom = single

用法:
  py scripts/ooxml_three_line_table.py <docx>
"""

from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ET.register_namespace("w", W)


def q(t: str) -> str:
    return f"{{{W}}}{t}"


_LINE = {"val": "single", "sz": "6", "space": "0", "color": "auto"}
_NIL = {"val": "nil"}


def _set_border(parent: ET.Element, edge: str, attrs: dict[str, str]) -> None:
    el = parent.find(f"w:{edge}", NS)
    if el is None:
        el = ET.SubElement(parent, q(edge))
    el.attrib.clear()
    for k, v in attrs.items():
        el.set(q(k), v)


def _ensure_borders(parent: ET.Element, tag: str) -> ET.Element:
    el = parent.find(f"w:{tag}", NS)
    if el is None:
        el = ET.SubElement(parent, q(tag))
    return el


def _patch_table(tbl: ET.Element) -> None:
    tbl_pr = tbl.find("w:tblPr", NS)
    if tbl_pr is None:
        tbl_pr = ET.Element(q("tblPr"))
        tbl.insert(0, tbl_pr)

    # 表整体水平居中
    jc = tbl_pr.find("w:jc", NS)
    if jc is None:
        jc = ET.SubElement(tbl_pr, q("jc"))
    jc.set(q("val"), "center")

    borders = _ensure_borders(tbl_pr, "tblBorders")
    for child in list(borders):
        borders.remove(child)
    _set_border(borders, "top", _LINE)
    _set_border(borders, "bottom", _LINE)
    _set_border(borders, "left", _NIL)
    _set_border(borders, "right", _NIL)
    _set_border(borders, "insideH", _NIL)
    _set_border(borders, "insideV", _NIL)

    rows = tbl.findall("w:tr", NS)
    if not rows:
        return
    first_row = rows[0]
    for tc in first_row.findall("w:tc", NS):
        tc_pr = tc.find("w:tcPr", NS)
        if tc_pr is None:
            tc_pr = ET.Element(q("tcPr"))
            tc.insert(0, tc_pr)
        tc_borders = _ensure_borders(tc_pr, "tcBorders")
        _set_border(tc_borders, "bottom", _LINE)

    # 所有单元格段落水平居中（覆盖 pandoc 默认左对齐）
    for tc in tbl.iter(q("tc")):
        for p in tc.findall("w:p", NS):
            ppr = p.find("w:pPr", NS)
            if ppr is None:
                ppr = ET.Element(q("pPr"))
                p.insert(0, ppr)
            pjc = ppr.find("w:jc", NS)
            if pjc is None:
                pjc = ET.SubElement(ppr, q("jc"))
            pjc.set(q("val"), "center")


def patch_document(xml_bytes: bytes) -> tuple[bytes, int]:
    root = ET.fromstring(xml_bytes)
    n = 0
    for tbl in root.iter(q("tbl")):
        _patch_table(tbl)
        n += 1
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), n


def patch_docx(path: Path) -> int:
    tmp = path.with_suffix(path.suffix + ".tmp")
    count = 0
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data, count = patch_document(data)
            zout.writestr(item, data)
    shutil.move(str(tmp), str(path))
    return count


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="三线表 OOXML 后处理")
    ap.add_argument("docx", type=Path)
    args = ap.parse_args(argv[1:])
    if not args.docx.is_file():
        print(f"找不到文件: {args.docx}", file=sys.stderr)
        return 1
    n = patch_docx(args.docx)
    print(f"[three-line-table] 已改写 {n} 个表格 → 三线表")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
