#!/usr/bin/env python3
"""三线表后处理：把 docx 中所有 w:tbl 的边框改为「顶/表头底/底」三线。

不依赖 Word；通过修改 word/document.xml：
  - w:tblPr/w:tblBorders 设 top=single, bottom=single, insideH/insideV/left/right=nil
  - w:tblPr 补 tblW=100% / jc=center / tblLayout=autofit（三线表工科规范）
  - 首行（表头行）的每个 w:tc/w:tcPr/w:tcBorders/bottom = single
  - 单元格内容居中：w:tcPr/w:vAlign=center + 段落 w:pPr/w:jc=center
    （SourceCode / VerbatimChar 段落保持左对齐）

只写属于三线表的那几个节点，其余属性一概不碰。元素一律经 ooxml_schema_order 就位，
顺序表本身不在这里维护。

须在 ooxml_verbatim_table.py **之前**运行（附录代码块自己会造表，不该被强行居中）。

用法:
  py pipeline/ooxml_three_line_table.py <docx>
"""

from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from ooxml_schema_order import (  # noqa: E402
    PPR_ORDER,
    TBLPR_ORDER,
    TCPR_ORDER,
    ensure_ordered,
    put_ordered,
)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ET.register_namespace("w", W)


def q(t: str) -> str:
    return f"{{{W}}}{t}"


_LINE = {"val": "single", "sz": "6", "space": "0", "color": "auto"}       # 栏目线 0.75pt
_THICK = {"val": "single", "sz": "12", "space": "0", "color": "auto"}      # 顶/底线 1.5pt
_NIL = {"val": "nil"}

# 单元格内的代码段落：不参与居中
_CODE_STYLE_IDS = ("SourceCode", "VerbatimChar")


def _set_border(parent: ET.Element, edge: str, attrs: dict[str, str]) -> None:
    el = parent.find(f"w:{edge}", NS)
    if el is None:
        el = ET.SubElement(parent, q(edge))
    el.attrib.clear()
    for k, v in attrs.items():
        el.set(q(k), v)


def _cell_pr(tc: ET.Element) -> ET.Element:
    """tcPr 必须是 w:tc 的首个子元素。"""
    tc_pr = tc.find("w:tcPr", NS)
    if tc_pr is None:
        tc_pr = ET.Element(q("tcPr"))
        tc.insert(0, tc_pr)
    return tc_pr


def _patch_table(tbl: ET.Element) -> None:
    tbl_pr = tbl.find("w:tblPr", NS)
    if tbl_pr is None:
        tbl_pr = ET.Element(q("tblPr"))
        tbl.insert(0, tbl_pr)

    # 表整体：占满版心（100%）+ 水平居中 —— 三线表工科规范
    put_ordered(tbl_pr, "tblW", TBLPR_ORDER, w="5000", type="pct")
    put_ordered(tbl_pr, "jc", TBLPR_ORDER, val="center")
    put_ordered(tbl_pr, "tblLayout", TBLPR_ORDER, type="autofit")

    borders = ensure_ordered(tbl_pr, "tblBorders", TBLPR_ORDER)
    for child in list(borders):
        borders.remove(child)
    _set_border(borders, "top", _THICK)
    _set_border(borders, "bottom", _THICK)
    _set_border(borders, "left", _NIL)
    _set_border(borders, "right", _NIL)
    _set_border(borders, "insideH", _NIL)
    _set_border(borders, "insideV", _NIL)

    # 单元格：垂直居中 + 段落水平居中（代码段落保持左对齐）
    for tc in tbl.iter(q("tc")):
        put_ordered(_cell_pr(tc), "vAlign", TCPR_ORDER, val="center")
        for p in tc.findall("w:p", NS):
            ppr = p.find("w:pPr", NS)
            ps = ppr.find("w:pStyle", NS) if ppr is not None else None
            if ps is not None and ps.get(q("val")) in _CODE_STYLE_IDS:
                continue
            if ppr is None:
                ppr = ET.Element(q("pPr"))
                p.insert(0, ppr)
            put_ordered(ppr, "jc", PPR_ORDER, val="center")

    # 表头行下沿的栏目线
    rows = tbl.findall("w:tr", NS)
    if not rows:
        return
    for tc in rows[0].findall("w:tc", NS):
        tc_borders = ensure_ordered(_cell_pr(tc), "tcBorders", TCPR_ORDER)
        _set_border(tc_borders, "bottom", _LINE)


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
