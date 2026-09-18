# -*- coding: utf-8 -*-
"""按湖.doc（湖南工商大学学年论文规范化要求）式样重建 hutb-guanke-xuenian 的封面块与评审表块。

用途：模板的 cover_block.xml / tail_block.xml 需要重新生成时运行本脚本。
可重复运行（幂等）：始终保留 cover 的前 6 个元素（校徽图、空行、"学 年 论 文"、空行、两个空格段）
与末尾分页段，其余按式样重画。

式样来源（湖.doc）：
  · 封面 = "学 年 论 文" 大标题 + 7 行两列表格（左列居中标签、右列填空白框，仅右列画上下横线）
           + 1 行四格表（[空] 年 [空] 月，四边带框）
  · 评审表 = 标题段 + 6 行表格；网格列宽比来自式样实测几何
             c1 姓名/题目/评审意见/评审成绩/指导教师 | c2 大空 | c3 学院/职称 | c4 空 | c5 学号/专业班级/时间 | c6 空
             姓名/学院 纵向合并 2 行，专业班级落在 c5；题目/评审意见/评审成绩 的填写格横跨 c2..c6
"""
import copy, sys
from pathlib import Path
from lxml import etree

TPL = Path("/Users/Admin1/Desktop/project/janxland/wordEditor/templates/hutb-guanke-xuenian")
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
def w(t): return f"{{{W}}}{t}"

cover_old = etree.parse(str(TPL / "cover_block.xml")).getroot()
tail_old  = etree.parse(str(TPL / "tail_block.xml")).getroot()
NSMAP = {k: v for k, v in cover_old.nsmap.items() if k and v}

def para(text="", *, size=21, bold=False, align="center", font="宋体",
         spacing=None, indent=None, runs=None):
    p = etree.Element(w("p"))
    ppr = etree.SubElement(p, w("pPr"))
    if spacing:
        sp = etree.SubElement(ppr, w("spacing"))
        for k, v in spacing.items(): sp.set(w(k), str(v))
    if indent is not None:
        ind = etree.SubElement(ppr, w("ind"))
        ind.set(w("firstLineChars"), str(indent))
    jc = etree.SubElement(ppr, w("jc")); jc.set(w("val"), align)
    rpr = etree.SubElement(ppr, w("rPr"))
    rf = etree.SubElement(rpr, w("rFonts"))
    rf.set(w("hint"), "eastAsia"); rf.set(w("ascii"), font)
    rf.set(w("hAnsi"), font); rf.set(w("eastAsia"), font)
    if bold: etree.SubElement(rpr, w("b"))
    sz = etree.SubElement(rpr, w("sz")); sz.set(w("val"), str(size))
    szcs = etree.SubElement(rpr, w("szCs")); szcs.set(w("val"), str(size))
    if runs is None:
        runs = [(text, bold)] if text else []
    for t, b in runs:
        r = etree.SubElement(p, w("r"))
        rp = etree.SubElement(r, w("rPr"))
        rfo = etree.SubElement(rp, w("rFonts"))
        rfo.set(w("hint"), "eastAsia"); rfo.set(w("ascii"), font)
        rfo.set(w("hAnsi"), font); rfo.set(w("eastAsia"), font)
        if b: etree.SubElement(rp, w("b"))
        s = etree.SubElement(rp, w("sz")); s.set(w("val"), str(size))
        scs = etree.SubElement(rp, w("szCs")); scs.set(w("val"), str(size))
        tEl = etree.SubElement(r, w("t"))
        tEl.text = t
        if t != t.strip(): tEl.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return p

def borders(**kw):
    """kw: top/left/bottom/right/insideH/insideV → val"""
    b = etree.Element(w("tblBorders"))
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = etree.SubElement(b, w(side))
        v = kw.get(side, "nil")
        e.set(w("val"), v)
        if v != "nil":
            e.set(w("color"), "auto"); e.set(w("sz"), "4"); e.set(w("space"), "0")
    return b

def tc_borders(spec):
    b = etree.Element(w("tcBorders"))
    for side in ("top", "left", "bottom", "right"):
        e = etree.SubElement(b, w(side))
        v = spec.get(side, "nil")
        e.set(w("val"), v)
        if v != "nil":
            e.set(w("color"), "auto"); e.set(w("sz"), "4"); e.set(w("space"), "0")
    return b

def cell(width, paras, *, span=0, vmerge=None, valign="center", tb=None):
    c = etree.Element(w("tc"))
    pr = etree.SubElement(c, w("tcPr"))
    tw = etree.SubElement(pr, w("tcW")); tw.set(w("w"), str(width)); tw.set(w("type"), "dxa")
    if span: gs = etree.SubElement(pr, w("gridSpan")); gs.set(w("val"), str(span))
    if vmerge == "restart":
        etree.SubElement(pr, w("vMerge")).set(w("val"), "restart")
    elif vmerge == "cont":
        etree.SubElement(pr, w("vMerge"))
    if tb is not None:
        pr.append(tc_borders(tb))
    etree.SubElement(pr, w("noWrap")).set(w("val"), "0")
    va = etree.SubElement(pr, w("vAlign")); va.set(w("val"), valign)
    if not paras:
        paras = [para("", size=21, align="center")]
    for pp in paras: c.append(pp)
    return c

def row(cells, height=None, hrule="atLeast"):
    tr = etree.Element(w("tr"))
    if height:
        pr = etree.SubElement(tr, w("trPr"))
        h = etree.SubElement(pr, w("trHeight"))
        h.set(w("val"), str(height)); h.set(w("hRule"), hrule)
    for c in cells: tr.append(c)
    return tr

def table(grid, rows, *, width, indent=None, tbl_borders=None, layout="fixed"):
    t = etree.Element(w("tbl"))
    pr = etree.SubElement(t, w("tblPr"))
    etree.SubElement(pr, w("tblStyle")).set(w("val"), "24")
    tw = etree.SubElement(pr, w("tblW")); tw.set(w("w"), str(width)); tw.set(w("type"), "dxa")
    jc = etree.SubElement(pr, w("jc")); jc.set(w("val"), "left")
    ind = etree.SubElement(pr, w("tblInd"))
    ind.set(w("w"), str(indent if indent is not None else 0)); ind.set(w("type"), "dxa")
    pr.append(borders(**(tbl_borders or {})))
    etree.SubElement(pr, w("tblLayout")).set(w("type"), layout)
    cm = etree.SubElement(pr, w("tblCellMar"))
    for side, v in (("top", 0), ("left", 80), ("bottom", 0), ("right", 80)):
        m = etree.SubElement(cm, w(side)); m.set(w("w"), str(v)); m.set(w("type"), "dxa")
    g = etree.SubElement(t, w("tblGrid"))
    for gw in grid:
        etree.SubElement(g, w("gridCol")).set(w("w"), str(gw))
    for r in rows: t.append(r)
    return t

# ============================================================ 封面
COVER_GRID = [1600, 3000]          # 81mm
LABELS = ["题    目", "学生姓名", "学    号", "学    院", "专业班级", "指导教师", "职    称"]
cover_rows = []
for i, lab in enumerate(LABELS):
    tb = {"top": "single", "bottom": "single"} if i == 0 else {"bottom": "single"}
    cover_rows.append(row([
        cell(COVER_GRID[0], [para(lab, size=28, bold=True, align="center")]),
        cell(COVER_GRID[1], [], tb=tb),
    ], height=425))

DATE_GRID = [760, 420, 440, 470]   # 37mm： [空] 年 [空] 月
date_row = row([
    cell(DATE_GRID[0], [], tb={"top": "single", "left": "single", "bottom": "single", "right": "single"}),
    cell(DATE_GRID[1], [para("年", size=28, bold=True, align="center")],
         tb={"top": "single", "left": "single", "bottom": "single", "right": "single"}),
    cell(DATE_GRID[2], [], tb={"top": "single", "left": "single", "bottom": "single", "right": "single"}),
    cell(DATE_GRID[3], [para("月", size=28, bold=True, align="center")],
         tb={"top": "single", "left": "single", "bottom": "single", "right": "single"}),
], height=380)

new_cover = etree.Element("cover", nsmap=NSMAP)
for i in range(0, 6):                    # logo / 空 / 学年论文 / 空 / 空格段 ×2
    new_cover.append(copy.deepcopy(cover_old[i]))
new_cover.append(table(COVER_GRID, cover_rows, width=sum(COVER_GRID)))
new_cover.append(para("", size=28, align="left"))
new_cover.append(table(DATE_GRID, [date_row], width=sum(DATE_GRID)))
new_cover.append(copy.deepcopy(cover_old[-1]))   # 末尾分页段（可重复运行）

(TPL / "cover_block.xml").write_bytes(etree.tostring(new_cover, xml_declaration=True, encoding="UTF-8"))

# ============================================================ 评审表
EV_GRID = [886, 4005, 558, 1492, 626, 1503]      # = 9070 twips (A4 版心 160mm)
ALL4 = {"top": "single", "left": "single", "bottom": "single", "right": "single"}
L = lambda t: [para(t, size=21, align="center")]

ev_rows = [
    row([
        cell(EV_GRID[0], L("姓 名"), vmerge="restart"),
        cell(EV_GRID[1], [], vmerge="restart"),
        cell(EV_GRID[2], L("学院"), vmerge="restart"),
        cell(EV_GRID[3], [], vmerge="restart"),
        cell(EV_GRID[4], L("学 号")),
        cell(EV_GRID[5], []),
    ], height=450),
    row([
        cell(EV_GRID[0], [], vmerge="cont"),
        cell(EV_GRID[1], [], vmerge="cont"),
        cell(EV_GRID[2], [], vmerge="cont"),
        cell(EV_GRID[3], [], vmerge="cont"),
        cell(EV_GRID[4], L("专业班级")),
        cell(EV_GRID[5], []),
    ], height=450),
    row([
        cell(EV_GRID[0], L("题    目")),
        cell(sum(EV_GRID[1:]), [], span=5),
    ], height=760),
    row([
        cell(EV_GRID[0], [para("评", size=21), para("审", size=21), para("意", size=21), para("见", size=21)]),
        cell(sum(EV_GRID[1:]), [], span=5, valign="top"),
    ], height=3400),
    row([
        cell(EV_GRID[0], L("评审成绩")),
        cell(sum(EV_GRID[1:]), [], span=5),
    ], height=450),
    row([
        cell(EV_GRID[0], L("指导教师")),
        cell(EV_GRID[1], []),
        cell(EV_GRID[2], L("职称")),
        cell(EV_GRID[3], []),
        cell(EV_GRID[4], L("时间")),
        cell(EV_GRID[5], L("年 月 日")),
    ], height=450),
]

new_tail = etree.Element("tail", nsmap=NSMAP)
new_tail.append(copy.deepcopy(tail_old[0]))            # 评审表标题段
new_tail.append(table(EV_GRID, ev_rows, width=sum(EV_GRID), tbl_borders=ALL4))
new_tail.append(copy.deepcopy(tail_old[2]))
for i in (3, 4): new_tail.append(copy.deepcopy(tail_old[i]))

(TPL / "tail_block.xml").write_bytes(etree.tostring(new_tail, xml_declaration=True, encoding="UTF-8"))
print("封面块 / 评审表块 已重建")
print("封面表格宽:", sum(COVER_GRID), "twips  日期表:", sum(DATE_GRID), "twips")
print("评审表宽:", sum(EV_GRID), "twips")
