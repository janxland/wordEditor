#!/usr/bin/env python3
"""附录代码块 → 三线表（表头行 + 代码行）：把 docx 中连续 SourceCode（verbatim）段落包进单列两行三线表。

不依赖 Word；通过修改 word/document.xml，把一整块代码做成标准三线表：

    顶线（1.5pt）
    表头行：附录代码　titanic_analysis.py      ← 说明这是什么代码
    栏目线（0.75pt）
    代码行：完整脚本正文（可能跨页续排）
    底线（1.5pt）

表头文字默认从该代码块**之前**的正文里自动提取脚本文件名（形如 xxx.py），
找不到时退回「附录代码」；也可用 --caption 显式指定。

须在 ooxml_three_line_table.py **之后**运行——否则三线表后处理会把
代码单元格的段落居中、并给首行（代码首行）加一条栏目线。

用法:
  py pipeline/ooxml_verbatim_table.py <docx> [--caption "附录代码　xxx.py"]
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML = "http://www.w3.org/XML/1998/namespace"
NS = {"w": W}
ET.register_namespace("w", W)

CODE_STYLE_IDS = {"SourceCode", "VerbatimChar"}
# 正文可用宽度：A4(21cm) − 左右各 3.17cm ≈ 14.66cm ≈ 8312 twips，留 12 twips 余量
TABLE_W = "8300"
_LINE = {"val": "single", "sz": "12", "space": "0", "color": "auto"}   # 1.5pt 顶/底线
_RULE = {"val": "single", "sz": "6", "space": "0", "color": "auto"}    # 0.75pt 栏目线
_NIL = {"val": "nil"}

# 脚本名支持任意扩展名（.py/.sh/.csv/.wbt…），且只取"文件名.扩展名"形态
SCRIPT_NAME = re.compile(r"([A-Za-z_][\w\-]*\.(?:py|sh|csv|wbt|proto|yaml|json|md|log))")
PY_NAME = SCRIPT_NAME  # 兼容旧名
DEFAULT_CAPTION = "附录代码"


def q(t: str) -> str:
    return f"{{{W}}}{t}"


def is_verbatim(p: ET.Element) -> bool:
    ppr = p.find("w:pPr", NS)
    if ppr is not None:
        ps = ppr.find("w:pStyle", NS)
        if ps is not None and ps.get(q("val")) in CODE_STYLE_IDS:
            return True
    return any(el.tag in (q("br"), q("tab")) for el in p.iter())


def _border(parent: ET.Element, edge: str, attrs: dict[str, str]) -> None:
    el = ET.SubElement(parent, q(edge))
    for k, v in attrs.items():
        el.set(q(k), v)


def _text_of(el: ET.Element) -> str:
    return "".join(t.text or "" for t in el.iter(q("t")))


def detect_caption(preceding: list[ET.Element], override: str | None) -> str:
    """从代码块紧邻的前一段找脚本名，组成表头文字。

    只看紧邻的一段：越界回扫会让无文件名的代码块（如日志节选）
    错误继承更早代码块的文件名。
    """
    if override:
        return override
    for el in reversed(preceding):
        if el.tag != q("p"):
            continue
        m = PY_NAME.search(_text_of(el))
        if m:
            return f"{DEFAULT_CAPTION}\u3000{m.group(1)}"
        break  # 只看紧邻一段
    return DEFAULT_CAPTION


def _caption_para(text: str) -> ET.Element:
    """表头单元格里的说明段落：居中、宋体五号。"""
    p = ET.Element(q("p"))
    ppr = ET.SubElement(p, q("pPr"))
    jc = ET.SubElement(ppr, q("jc"))
    jc.set(q("val"), "center")
    sp = ET.SubElement(ppr, q("spacing"))
    sp.set(q("before"), "40")
    sp.set(q("after"), "40")
    sp.set(q("line"), "240")
    sp.set(q("lineRule"), "auto")
    rpr = ET.SubElement(ppr, q("rPr"))
    sz = ET.SubElement(rpr, q("sz"))
    sz.set(q("val"), "21")
    r = ET.SubElement(p, q("r"))
    rr = ET.SubElement(r, q("rPr"))
    rf = ET.SubElement(rr, q("rFonts"))
    rf.set(q("ascii"), "Times New Roman")
    rf.set(q("hAnsi"), "Times New Roman")
    rf.set(q("eastAsia"), "宋体")
    rf.set(q("hint"), "eastAsia")
    sz2 = ET.SubElement(rr, q("sz"))
    sz2.set(q("val"), "21")
    szc = ET.SubElement(rr, q("szCs"))
    szc.set(q("val"), "21")
    t = ET.SubElement(r, q("t"))
    t.set(f"{{{XML}}}space", "preserve")
    t.text = text
    return p


def _table_cell(width: str, children: list[ET.Element]) -> ET.Element:
    tc = ET.Element(q("tc"))
    tc_pr = ET.SubElement(tc, q("tcPr"))
    tcw = ET.SubElement(tc_pr, q("tcW"))
    tcw.set(q("w"), width)
    tcw.set(q("type"), "dxa")
    for child in children:
        tc.append(child)
    return tc


def _make_table(paras: list[ET.Element], caption: str) -> ET.Element:
    tbl = ET.Element(q("tbl"))
    tbl_pr = ET.SubElement(tbl, q("tblPr"))

    tw = ET.SubElement(tbl_pr, q("tblW"))
    tw.set(q("type"), "dxa")
    tw.set(q("w"), TABLE_W)
    jc = ET.SubElement(tbl_pr, q("jc"))
    jc.set(q("val"), "center")
    layout = ET.SubElement(tbl_pr, q("tblLayout"))
    layout.set(q("type"), "fixed")

    borders = ET.SubElement(tbl_pr, q("tblBorders"))
    _border(borders, "top", _LINE)
    _border(borders, "bottom", _LINE)
    _border(borders, "left", _NIL)
    _border(borders, "right", _NIL)
    _border(borders, "insideH", _NIL)
    _border(borders, "insideV", _NIL)

    cell_mar = ET.SubElement(tbl_pr, q("tblCellMar"))
    for edge in ("top", "left", "bottom", "right"):
        e = ET.SubElement(cell_mar, q(edge))
        e.set(q("w"), "0")
        e.set(q("type"), "dxa")

    grid = ET.SubElement(tbl, q("tblGrid"))
    gc = ET.SubElement(grid, q("gridCol"))
    gc.set(q("w"), TABLE_W)

    # 第一行：表头（顶线与栏目线之间）——说明这段是什么代码
    head_tc = _table_cell(TABLE_W, [_caption_para(caption)])
    tc_borders = ET.SubElement(head_tc.find(q("tcPr")), q("tcBorders"))
    _border(tc_borders, "bottom", _RULE)
    head_tr = ET.Element(q("tr"))
    # 说明行由 _caption_para 承担，整张表只有两行；不设 tblHeader，
    # 长代码跨页时表头不重复，与 PDF 链路（.codecap 只出现一次）保持一致。
    head_tr.append(head_tc)
    tbl.append(head_tr)

    # 第二行：代码本体（栏目线与底线之间）
    code_tr = ET.Element(q("tr"))
    code_tr.append(_table_cell(TABLE_W, paras))
    tbl.append(code_tr)
    return tbl


def _spacer() -> ET.Element:
    """表格后的空段落（极小字号，避免多出一行空白）。"""
    p = ET.Element(q("p"))
    ppr = ET.SubElement(p, q("pPr"))
    rpr = ET.SubElement(ppr, q("rPr"))
    sz = ET.SubElement(rpr, q("sz"))
    sz.set(q("val"), "4")
    return p


def patch_document(xml_bytes: bytes, override: str | None = None) -> tuple[bytes, int, list[str]]:
    root = ET.fromstring(xml_bytes)
    body = root.find("w:body", NS)
    if body is None:
        return xml_bytes, 0, []

    kids = list(body)
    out: list[ET.Element] = []
    captions: list[str] = []
    n = 0
    i = 0
    while i < len(kids):
        el = kids[i]
        if el.tag == q("p") and is_verbatim(el):
            block = []
            while i < len(kids) and kids[i].tag == q("p") and is_verbatim(kids[i]):
                block.append(kids[i])
                i += 1
            caption = detect_caption(out, override)
            out.append(_make_table(block, caption))
            out.append(_spacer())
            captions.append(caption)
            n += 1
            continue
        out.append(el)
        i += 1

    if n == 0:
        return xml_bytes, 0, []
    body[:] = out
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), n, captions


def patch_docx(path: Path, override: str | None = None) -> tuple[int, list[str]]:
    tmp = path.with_suffix(path.suffix + ".tmp")
    count = 0
    captions: list[str] = []
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data, count, captions = patch_document(data, override)
            zout.writestr(item, data)
    shutil.move(str(tmp), str(path))
    return count, captions


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="附录代码块 → 表头行 + 代码行的三线表")
    ap.add_argument("docx", type=Path)
    ap.add_argument("--caption", default=None, help="表头文字，默认从正文自动提取脚本名")
    args = ap.parse_args(argv[1:])
    if not args.docx.is_file():
        print(f"找不到文件: {args.docx}", file=sys.stderr)
        return 1
    n, captions = patch_docx(args.docx, args.caption)
    if n:
        print(f"[verbatim-table] 已把 {n} 处代码块改为三线表，表头：{captions}")
    else:
        print("[verbatim-table] 未发现代码块，跳过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
