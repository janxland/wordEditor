#!/usr/bin/env python3
"""生成 APA 7th edition 版式的 reference.docx，供 wordEditor 的 apa7 模板使用。

用法:
    python templates/apa7/build_reference.py

产物:
    templates/apa7/reference.docx

版式要点（APA 7 学生论文）:
  - 页边距 1 英寸（Letter 8.5 x 11）
  - 正文 Calibri 11pt、双倍行距、段前段后 0、首行缩进 0.5 英寸
  - 各级标题同为 Calibri 11pt、加粗、黑色、双倍行距、无自动编号
  - 页脚居中页码（PAGE 域）
  - 参考文献条目悬挂缩进 0.5 英寸

本脚本只依赖 python-docx，不写临时文件到工作区之外。
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

OUT = Path(__file__).resolve().parent / "reference.docx"

FONT = "Calibri"
SIZE = Pt(11)
BLACK = RGBColor(0x00, 0x00, 0x00)


def _patch_doc_defaults(doc: Document) -> None:
    """把 docDefaults 拉到 Calibri 11pt，避免未定义样式回落到 Cambria/宋体。"""
    styles_el = doc.styles.element
    dd = styles_el.find(qn("w:docDefaults"))
    if dd is None:
        dd = OxmlElement("w:docDefaults")
        styles_el.insert(0, dd)

    rpr_default = dd.find(qn("w:rPrDefault"))
    if rpr_default is None:
        rpr_default = OxmlElement("w:rPrDefault")
        dd.insert(0, rpr_default)
    rpr = rpr_default.find(qn("w:rPr"))
    if rpr is None:
        rpr = OxmlElement("w:rPr")
        rpr_default.append(rpr)

    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), FONT)

    for tag, val in (("w:sz", "22"), ("w:szCs", "22")):
        el = rpr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rpr.append(el)
        el.set(qn("w:val"), val)

    ppr_default = dd.find(qn("w:pPrDefault"))
    if ppr_default is None:
        ppr_default = OxmlElement("w:pPrDefault")
        dd.append(ppr_default)
    ppr = ppr_default.find(qn("w:pPr"))
    if ppr is None:
        ppr = OxmlElement("w:pPr")
        ppr_default.append(ppr)
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:after"), "0")
    spacing.set(qn("w:before"), "0")
    spacing.set(qn("w:line"), "480")
    spacing.set(qn("w:lineRule"), "auto")
    ppr.append(spacing)


def _style(doc: Document, name: str):
    """取已有样式或新建段落样式。"""
    try:
        st = doc.styles[name]
    except KeyError:
        st = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    return st


def _apply(st, *, bold=None, italic=None, align=None, first_line=None,
           left_indent=None, keep_next=None, base_font=True) -> None:
    if base_font:
        st.font.name = FONT
        st.font.size = SIZE
        st.font.color.rgb = BLACK
    if bold is not None:
        st.font.bold = bold
    if italic is not None:
        st.font.italic = italic

    pf = st.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.alignment = align if align is not None else WD_ALIGN_PARAGRAPH.LEFT
    pf.first_line_indent = Inches(0.5) if first_line is None else first_line
    if left_indent is not None:
        pf.left_indent = left_indent
    if keep_next is not None:
        pf.keep_with_next = keep_next


def _add_page_field(footer_paragraph) -> None:
    footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer_paragraph.add_run()
    run.font.name = FONT
    run.font.size = SIZE

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def build() -> Path:
    doc = Document()
    _patch_doc_defaults(doc)

    # --- 基础样式 -------------------------------------------------------
    normal = _style(doc, "Normal")
    # Normal 不缩进：标题页/页脚等非正文段落在其上派生
    _apply(normal, first_line=Inches(0))

    # 正文段落（pandoc 对普通段落使用 Body Text / First Paragraph / Compact）
    for name in ("Body Text", "First Paragraph", "Compact"):
        _apply(_style(doc, name), first_line=Inches(0.5))

    # --- 标题（APA：同级同样式字体，仅靠粗细/对齐区分层级） ---------------
    _apply(_style(doc, "Title"), bold=True,
           align=WD_ALIGN_PARAGRAPH.CENTER, first_line=Inches(0), keep_next=True)
    _apply(_style(doc, "Heading 1"), bold=True,
           align=WD_ALIGN_PARAGRAPH.CENTER, first_line=Inches(0), keep_next=True)
    _apply(_style(doc, "Heading 2"), bold=True,
           align=WD_ALIGN_PARAGRAPH.LEFT, first_line=Inches(0), keep_next=True)
    _apply(_style(doc, "Heading 3"), bold=True, italic=True,
           align=WD_ALIGN_PARAGRAPH.LEFT, first_line=Inches(0), keep_next=True)
    # 关掉 Word 内置标题样式的自动编号（若存在 numPr）
    for name in ("Heading 1", "Heading 2", "Heading 3", "Title"):
        ppr = doc.styles[name].element.get_or_add_pPr()
        for numpr in ppr.findall(qn("w:numPr")):
            ppr.remove(numpr)

    # --- 本文档专用自定义样式（由 apa7-style.lua 通过 custom-style 指定）---
    # 标题页题目
    _apply(_style(doc, "APATitle"), bold=True,
           align=WD_ALIGN_PARAGRAPH.CENTER, first_line=Inches(0), keep_next=True)
    # 标题页其余行（学生姓名/院系/课程/教师/日期）
    _apply(_style(doc, "APACenter"),
           align=WD_ALIGN_PARAGRAPH.CENTER, first_line=Inches(0))
    # 参考文献条目：悬挂缩进 0.5 英寸
    _apply(_style(doc, "References"), first_line=Inches(-0.5),
           left_indent=Inches(0.5))

    # --- 页面设置 -------------------------------------------------------
    for section in doc.sections:
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.header_distance = Inches(0.5)
        section.footer_distance = Inches(0.5)
        _add_page_field(section.footer.paragraphs[0])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    return OUT


if __name__ == "__main__":
    print(build())
