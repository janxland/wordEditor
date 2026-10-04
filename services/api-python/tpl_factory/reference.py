"""reference.docx 生成与整包克隆（铁律 1.5：docDefaults/theme/settings 必须同源）。"""
import re
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Twips

NUMBERING_PRESETS = {
    "guanke": {
        "levels": [
            {"ilvl": 0, "fmt": "chineseCounting", "text": "%1、", "suff": "nothing"},
            {"ilvl": 1, "fmt": "chineseCounting", "text": "（%2）", "suff": "nothing"},
            {"ilvl": 2, "fmt": "decimalEnclosedCircle", "text": "%3.", "suff": "space"},
            {"ilvl": 3, "fmt": "decimal", "text": "%3.%4", "suff": "space"},
        ]
    },
    "gongke": {
        "levels": [
            {"ilvl": 0, "fmt": "decimal", "text": "%1", "suff": "space"},
            {"ilvl": 1, "fmt": "decimal", "text": "%1.%2", "suff": "space"},
            {"ilvl": 2, "fmt": "decimal", "text": "%1.%2.%3", "suff": "space"},
            {"ilvl": 3, "fmt": "decimal", "text": "%1.%2.%3.%4", "suff": "space"},
        ]
    },
}

def _patch_doc_defaults(doc: Document, latin: str, cjk: str, size_half_pt: int) -> None:
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
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:cs"), latin)
    rfonts.set(qn("w:eastAsia"), cjk)
    for tag in ("w:sz", "w:szCs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rpr.append(el)
        el.set(qn("w:val"), str(size_half_pt))

def _set_style_run(style, *, cjk: str, latin: str, size_half_pt: int, bold: bool = False,
                   color: tuple[int, int, int] = (0, 0, 0)) -> None:
    style.font.name = latin
    style.font.size = Pt(size_half_pt / 2)
    style.font.bold = bold
    style.font.color.rgb = RGBColor(*color)
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:cs"), latin)
    rfonts.set(qn("w:eastAsia"), cjk)
    for tag in ("w:sz", "w:szCs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rpr.append(el)
        el.set(qn("w:val"), str(size_half_pt))
    rpr.findall(qn("w:b"))
    if bold:
        for tag in ("w:b", "w:bCs"):
            if rpr.find(qn(tag)) is None:
                rpr.insert(0, OxmlElement(tag))

def _set_style_para(style, *, align: str, line: int | None = None, line_rule: str = "exact",
                    first_line_chars: int | None = None, first_line_dxa: int | None = None,
                    before: int = 0, after: int = 0, indent_clear: bool = False) -> None:
    pf = style.paragraph_format
    pf.alignment = {
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "both": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }.get(align, WD_ALIGN_PARAGRAPH.LEFT)
    pf.space_before = Pt(before / 20)
    pf.space_after = Pt(after / 20)

    ppr = style.element.get_or_add_pPr()
    if line is not None:
        spacing = ppr.find(qn("w:spacing"))
        if spacing is None:
            spacing = OxmlElement("w:spacing")
            ppr.insert(0, spacing)
        spacing.set(qn("w:line"), str(line))
        spacing.set(qn("w:lineRule"), line_rule)
        spacing.set(qn("w:before"), str(before))
        spacing.set(qn("w:after"), str(after))
    if indent_clear:
        ind = ppr.find(qn("w:ind"))
        if ind is not None:
            ppr.remove(ind)
    if first_line_chars is not None:
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            ind = OxmlElement("w:ind")
            ppr.append(ind)
        ind.set(qn("w:firstLineChars"), str(first_line_chars * 100))
        ind.set(qn("w:firstLine"), str(first_line_dxa if first_line_dxa is not None
                                        else first_line_chars * 100))
    # 中文版式开关：允许西文在单词内换行、字符网格对齐
    _set_wordwrap_zero_docx(ppr)

def _set_wordwrap_zero_docx(ppr) -> None:
    """关掉「单词中间换行」+ 允许标点溢出，贴近中文论文排版习惯。

    注意：本模块走 python-docx/lxml 栈，ooxml_util.set_wordwrap_zero 走
    ElementTree 栈，两者元素类型不通用 —— 这是同一事实在两套 XML 栈上的
    两个必要投影，不是冗余复制，改名只为消除同名歧义。
    """
    if ppr.find(qn("w:wordWrap")) is None:
        el = OxmlElement("w:wordWrap")
        el.set(qn("w:val"), "0")
        ppr.append(el)

def _line_from_spec(p: dict) -> tuple[int | None, str]:
    """spec 的 line_spacing（DSL 语义）→ (line_dxa, line_rule)。

    支持 "24pt"/"24磅"（固定值）、single / 1.5 / double（倍数）。
    spec 里给了 line_dxa 就优先用它。
    """
    if p.get("line_dxa") is not None:
        return int(p["line_dxa"]), p.get("line_rule", "exact")
    v = p.get("line_spacing")
    if v in (None, "single"):
        return 240, "auto"
    if v in (1.5, "1.5"):
        return 360, "auto"
    if v in (2, "double", "2"):
        return 480, "auto"
    if isinstance(v, str):
        import re
        m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|磅)\s*$", v, re.IGNORECASE)
        if m:
            return int(round(float(m.group(1)) * 20)), "exact"
    if isinstance(v, (int, float)):
        return int(v), "auto"
    raise SystemExit(f"无法解析 line_spacing: {v!r}")

def _style(doc: Document, name: str):
    try:
        return doc.styles[name]
    except KeyError:
        return doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)

def _rename_style_id(doc: Document, name: str, new_id: str) -> None:
    el = doc.styles[name].element
    el.set(qn("w:styleId"), new_id)

def build_reference(spec: dict, out_path: Path) -> Path:
    """从零生成一个 reference.docx。**不再直接对外使用**，只作为
    build_reference_cloned() 的内部样式生成器（产出本体系需要的样式，再注入克隆包）。
    直接用它当 reference.docx 会破坏封面渲染（铁律 1.5）。
    """
    page = spec["page"]
    fonts = spec["fonts"]
    latin, cjk = fonts["latin"], fonts.get("cjk") or fonts["latin"]
    body = spec["body"]
    b_run, b_par = body["run"], body["paragraph"]

    doc = Document()
    _patch_doc_defaults(doc, latin, cjk, b_run.get("size_half_pt", 28))

    # --- 正文骨架：Normal 与 pandoc 常用的段落样式统一按正文规格 -------------
    b_line, b_rule = _line_from_spec(b_par)
    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        st = _style(doc, name)
        _set_style_run(st, cjk=b_run.get("cjk_font", cjk), latin=b_run.get("latin_font", latin),
                       size_half_pt=b_run.get("size_half_pt", 28))
        _set_style_para(st, align=b_par.get("align", "both"),
                        line=b_line, line_rule=b_rule,
                        first_line_chars=b_par.get("first_line_chars"),
                        first_line_dxa=b_par.get("first_line_dxa"),
                        before=b_par.get("spacing_before_dxa", 0),
                        after=b_par.get("spacing_after_dxa", 0))
    # Normal 本身不缩进（标题、表格内文派生自它）
    _set_style_para(doc.styles["Normal"], align="left", indent_clear=False)
    ppr = doc.styles["Normal"].element.get_or_add_pPr()
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        ppr.append(ind)
    ind.set(qn("w:firstLineChars"), "0")
    ind.set(qn("w:firstLine"), "0")

    # --- 标题：styleId 改成 1..9，与 hutb-shared 生态的 styles.yaml 对齐 ------
    for lvl, h in enumerate(spec.get("headings", []), start=1):
        st = _style(doc, f"Heading {lvl}")
        hr, hp = h.get("run", {}), h.get("paragraph", {})
        h_line, h_rule = _line_from_spec(hp)
        _set_style_run(st, cjk=hr.get("cjk_font", cjk), latin=hr.get("latin_font", latin),
                       size_half_pt=hr.get("size_half_pt", b_run.get("size_half_pt", 28)),
                       bold=hr.get("bold", True))
        _set_style_para(st, align=hp.get("align", "left"),
                        line=h_line, line_rule=h_rule,
                        first_line_chars=hp.get("first_line_chars"),
                        first_line_dxa=hp.get("first_line_dxa"),
                        before=hp.get("spacing_before_dxa", 0),
                        after=hp.get("spacing_after_dxa", 0),
                        indent_clear=hp.get("indent_clear", True))
        ppr = st.element.get_or_add_pPr()
        for numpr in ppr.findall(qn("w:numPr")):   # 关掉 Word 内置自动编号
            ppr.remove(numpr)
        _rename_style_id(doc, f"Heading {lvl}", str(lvl))

    # --- 论文题目（Title）---------------------------------------------------
    t = spec.get("title", {})
    if t:
        st = _style(doc, "Title")
        tr, tp = t.get("run", {}), t.get("paragraph", {})
        t_line, t_rule = _line_from_spec(tp)
        _set_style_run(st, cjk=tr.get("cjk_font", cjk), latin=tr.get("latin_font", latin),
                       size_half_pt=tr.get("size_half_pt", 36), bold=tr.get("bold", True))
        _set_style_para(st, align=tp.get("align", "center"),
                        line=t_line, line_rule=t_rule,
                        before=tp.get("spacing_before_dxa", 0),
                        after=tp.get("spacing_after_dxa", 0), indent_clear=True)
        ppr = st.element.get_or_add_pPr()
        for numpr in ppr.findall(qn("w:numPr")):
            ppr.remove(numpr)

    # --- 页面设置 -----------------------------------------------------------
    m = page["margin"]
    for section in doc.sections:
        section.page_width = Twips(page["width_twips"])
        section.page_height = Twips(page["height_twips"])
        section.top_margin = Twips(m["top"])
        section.bottom_margin = Twips(m["bottom"])
        section.left_margin = Twips(m["left"])
        section.right_margin = Twips(m["right"])
        section.header_distance = Twips(page.get("header_twips", 851))
        section.footer_distance = Twips(page.get("footer_twips", 992))
        sect_pr = section._sectPr
        for tag in ("w:pgSz", "w:pgMar", "w:cols", "w:docGrid"):
            for old in sect_pr.findall(qn(tag)):
                sect_pr.remove(old)
        pg_sz = OxmlElement("w:pgSz")
        pg_sz.set(qn("w:w"), str(page["width_twips"]))
        pg_sz.set(qn("w:h"), str(page["height_twips"]))
        sect_pr.append(pg_sz)
        pg_mar = OxmlElement("w:pgMar")
        for k, v in (("top", m["top"]), ("right", m["right"]), ("bottom", m["bottom"]),
                     ("left", m["left"]), ("header", page.get("header_twips", 851)),
                     ("footer", page.get("footer_twips", 992)), ("gutter", 0)):
            pg_mar.set(qn(f"w:{k}"), str(v))
        sect_pr.append(pg_mar)
        cols = OxmlElement("w:cols")
        cols.set(qn("w:space"), str(page.get("cols_space", 425)))
        sect_pr.append(cols)
        grid = page.get("doc_grid")
        if grid:
            dg = OxmlElement("w:docGrid")
            dg.set(qn("w:type"), grid.get("type", "lines"))
            if "line_pitch" in grid:
                dg.set(qn("w:linePitch"), str(grid["line_pitch"]))
            sect_pr.append(dg)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    return out_path

def build_reference_cloned(spec: dict, src_docx: Path, out_path: Path) -> dict:
    """以源 docx 为底生成 reference.docx，返回所做改动的摘要。"""
    scratch = out_path.with_name(out_path.stem + ".fromscratch.docx")
    build_reference(spec, scratch)          # 复用现有逻辑产出「本体系需要的样式」
    with zipfile.ZipFile(scratch) as z:
        gen_styles = z.read("word/styles.xml").decode("utf-8")
        gen_numbering = (z.read("word/numbering.xml")
                         if "word/numbering.xml" in z.namelist() else None)
    scratch.unlink(missing_ok=True)

    # 生成的样式按 name 建索引（pandoc 与本体系 DSL 都是按 name 匹配的）
    gen_map: dict[str, str] = {}
    for m in re.finditer(r"<w:style [^>]*>.*?</w:style>", gen_styles, re.S):
        nm = re.search(r'<w:name w:val="([^"]+)"', m.group(0))
        if nm:
            gen_map[nm.group(1)] = m.group(0)

    with zipfile.ZipFile(src_docx) as z:
        names = z.namelist()
        entries: dict[str, bytes] = {n: z.read(n) for n in names}

    doc_xml = entries["word/document.xml"].decode("utf-8")

    # 1) body 清空，只留 sectPr（页面设置默认沿用源文档）
    m_open = re.search(r"<w:body[^>]*>", doc_xml)
    m_close = doc_xml.rfind("</w:body>")
    if not m_open or m_close == -1:
        raise SystemExit(f"{src_docx}: document.xml 缺少 <w:body>")
    sect = re.search(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc_xml, re.S)
    sect_xml = sect.group(0) if sect else ""

    # 1.5) 页面设置按 spec 覆写：规范类文档（源=格式规范文件）的页边距不代表
    #      产物要求，spec.page 才是（铁律二：文字描述 > 源 OOXML）。
    pg = spec.get("page") or {}
    if pg.get("width_twips") and sect_xml:
        sect_xml = re.sub(r'(<w:pgSz\b[^>]*?w:w=")\d+(")', rf"\g<1>{int(pg['width_twips'])}\g<2>", sect_xml)
        sect_xml = re.sub(r'(<w:pgSz\b[^>]*?w:h=")\d+(")', rf"\g<1>{int(pg['height_twips'])}\g<2>", sect_xml)
    _mar = pg.get("margin") or {}
    if _mar and sect_xml:
        m_pgmar = re.search(r"<w:pgMar\b[^>]*/>", sect_xml)
        if m_pgmar:
            attrs = dict(re.findall(r'w:(\w+)="([^"]+)"', m_pgmar.group(0)))
            attrs.update({k: str(int(v)) for k, v in _mar.items()})
            if pg.get("header_twips"):
                attrs["header"] = str(int(pg["header_twips"]))
            if pg.get("footer_twips"):
                attrs["footer"] = str(int(pg["footer_twips"]))
            new_pgmar = "<w:pgMar " + " ".join(f'w:{k}="{v}"' for k, v in sorted(attrs.items())) + "/>"
            sect_xml = sect_xml.replace(m_pgmar.group(0), new_pgmar)

    entries["word/document.xml"] = (
        doc_xml[:m_open.end()] + sect_xml + doc_xml[m_close:]
    ).encode("utf-8")

    # 2) 补进源文档没有的样式（本体系/pandoc 需要的 Title、heading 1..9 等）
    st_xml = entries["word/styles.xml"].decode("utf-8")
    # 2a) 清掉与追加样式冲突的源样式：LibreOffice/Word 转换的源常自带小写
    #     "heading 1"（styleId=Heading1，pandoc 按 "Heading 1" 大写查不到）和
    #     占用 styleId "1".."9" 的杂项样式（与 DSL 的 match id 冲突）。body 已清空，
    #     这些样式无人引用，删除安全。
    drop_ids: set[str] = set()
    for m in re.finditer(r"<w:style [^>]*>.*?</w:style>", st_xml, re.S):
        blk = m.group(0)
        sid = re.search(r'w:styleId="([^"]+)"', blk)
        nm = re.search(r'<w:name w:val="([^"]+)"', blk)
        if nm and re.fullmatch(r"(?i)heading \d", nm.group(1)):
            drop_ids.add(sid.group(1) if sid else "")
        elif sid and re.fullmatch(r"[1-9]", sid.group(1)):
            drop_ids.add(sid.group(1))
    for sid in filter(None, drop_ids):
        st_xml = re.sub(
            rf'<w:style [^>]*w:styleId="{re.escape(sid)}"[^>]*>.*?</w:style>', "", st_xml, flags=re.S)
    have = set(re.findall(r'<w:name w:val="([^"]+)"', st_xml))
    # 源文档的默认段落样式 styleId 往往不是 "Normal"（本例是 "a"），
    # 追加样式里的 basedOn/next="Normal" 会断链，必须重指到真实 id。
    default_para_id = "Normal"
    for m in re.finditer(r'<w:style [^>]*w:type="paragraph"[^>]*>', st_xml):
        sid = re.search(r'w:styleId="([^"]+)"', m.group(0))
        if sid and 'w:default="1"' in m.group(0):
            default_para_id = sid.group(1)
            break
    added = []
    for name, xml in gen_map.items():
        if name in have:
            continue
        x = xml
        if default_para_id != "Normal":
            x = re.sub(r'(<w:(?:basedOn|next) w:val=")Normal(")', rf"\1{default_para_id}\2", x)
        # pandoc 按 "Heading 1"（首字母大写）查样式名；python-docx 写的是小写
        # "heading 1"，匹配不上时 pandoc 会自建一个不存在的 Heading1 样式。
        x = re.sub(r'(<w:name w:val=")heading (\d)(")', r"\1Heading \2\3", x)
        added.append(x)
    if added:
        st_xml = st_xml.replace("</w:styles>", "".join(added) + "</w:styles>")
        entries["word/styles.xml"] = st_xml.encode("utf-8")

    # 3) 东亚语言兜底：python-docx 默认模板会写 ja-JP，导致默认东亚字体被解析
    #    成日文字体（多级列表编号「一、（一）、①」正是走默认字体）。
    if "word/settings.xml" in entries:
        s = entries["word/settings.xml"].decode("utf-8")
        s2 = re.sub(r'(<w:themeFontLang[^>]*w:eastAsia=")[^"]*(")', r"\1zh-CN\2", s)
        if "<w:themeFontLang" not in s2:
            s2 = s2.replace("</w:settings>",
                            '<w:themeFontLang w:val="en-US" w:eastAsia="zh-CN"/>'
                            "</w:settings>")
        if s2 != s:
            entries["word/settings.xml"] = s2.encode("utf-8")

    # 4) numbering：spec 指定了 numbering（guanke/gongke）时一律用生成的版本 ——
    #    LibreOffice/Word 转换的源自带 numbering.xml，但 numId/abstract 定义与
    #    DSL 的 multilevel_list 不匹配，会出现编号空白。body 已清空，直接替换安全。
    if gen_numbering and (spec.get("numbering") or "word/numbering.xml" not in entries):
        replaced = "word/numbering.xml" in entries
        entries["word/numbering.xml"] = gen_numbering
        rels = entries.get("word/_rels/document.xml.rels", b"").decode("utf-8")
        if "numbering.xml" not in rels:
            new_id = _next_rid(rels)
            rels = rels.replace(
                "</Relationships>",
                f'<Relationship Id="{new_id}" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/numbering" Target="numbering.xml"/></Relationships>')
            entries["word/_rels/document.xml.rels"] = rels.encode("utf-8")
        ct = entries["[Content_Types].xml"].decode("utf-8")
        if "numbering.xml" not in ct:
            ct = ct.replace("</Types>",
                            '<Override PartName="/word/numbering.xml" '
                            'ContentType="application/vnd.openxmlformats-'
                            'officedocument.wordprocessingml.numbering+xml"/></Types>')
            entries["[Content_Types].xml"] = ct.encode("utf-8")

    # 5) 清掉孤儿 media：body 已空，源文档的图片关系全部失效；
    #    封面/评分表的图由块自己带（cover_media/），注入时再写回。
    dropped_media: list[str] = []
    rels_path = "word/_rels/document.xml.rels"
    if rels_path in entries:
        rels = entries[rels_path].decode("utf-8")
        keep_media: set[str] = set()
        for m in re.finditer(r"<Relationship\b[^>]*>", rels):
            tag = m.group(0)
            tgt = re.search(r'Target="([^"]+)"', tag)
            ext = re.search(r'TargetMode="External"', tag)
            if tgt and not ext and tgt.group(1).startswith("media/"):
                rels = rels.replace(tag + "</Relationship>", "").replace(tag, "")
                continue
        entries[rels_path] = rels.encode("utf-8")
        for n in list(entries):
            if n.startswith("word/media/"):
                dropped_media.append(n)
                del entries[n]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    order = [n for n in names if n in entries] + [n for n in entries if n not in names]
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for n in order:
            z.writestr(n, entries[n])
    return {
        "mode": "clone_source",
        "styles_added": sorted(set(re.findall(r'<w:name w:val="([^"]+)"', "".join(added)))),
        "styles_kept_from_source": sorted(have),
        "media_dropped": dropped_media,
    }

def _next_rid(rels_xml: str) -> str:
    ids = [int(x) for x in re.findall(r'Id="rId(\d+)"', rels_xml)]
    return f"rId{max(ids) + 1 if ids else 1}"

