#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模板复刻验收：拿 spec.yaml 的期望值，机械比对产物 docx 是否 100% 复刻源模板。

用法:
    python template_verify.py templates/<id>/spec.yaml <产物.docx>

检查项（任一 FAIL 即退出码 1）:
  1. 页面设置     pgSz / pgMar / docGrid 与源 docx 逐值一致
  2. 封面块       body 切片内每个元素 XML 归一后与源逐字节一致（rId 重映射除外）
  3. 封面表几何   tblGrid / 行高 / 列宽 / gridSpan / vMerge / vAlign / tblPr
  4. 尾表块       同上，外加全部单元格文本
  5. 正文样式     sz / 行距 / 首行缩进 / 对齐 / 字体 与 spec 一致
  6. 标题样式     字体 / 字号 / 行距 / 缩进 + numbering 编号文本
  7. 段落落位     正文走「文章的正文」、题目走 Title、摘要关键词被识别
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

import xml.etree.ElementTree as ET
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from template_factory import load_spec  # noqa: E402

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def q(t):
    return f"{{{W}}}{t}"


FAIL: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        FAIL.append(name)


def parts(p: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(p) as z:
        return {n: z.read(n) for n in z.namelist()}


def body_els(data: bytes) -> list:
    b = ET.fromstring(data).find(q("body"))
    return [el for el in b if el.tag != q("sectPr")]


def txt(el) -> str:
    return "".join(x.text or "" for x in el.iter(q("t"))).strip()


def style_index(styles_xml: bytes) -> dict:
    """styleId → {pPr, rPr, basedOn}，外加 docDefaults 的两份默认值。"""
    root = ET.fromstring(styles_xml)
    styles = {}
    for s in root.findall(q("style")):
        sid = s.get(q("styleId"))
        if not sid:
            continue
        based = s.find(q("basedOn"))
        styles[sid] = {"pPr": s.find(q("pPr")), "rPr": s.find(q("rPr")),
                       "basedOn": based.get(q("val")) if based is not None else None}
    dd = root.find(q("docDefaults"))
    return {
        "styles": styles,
        "rPrDefault": dd.find(q("rPrDefault") + "/" + q("rPr")) if dd is not None else None,
        "pPrDefault": dd.find(q("pPrDefault") + "/" + q("pPr")) if dd is not None else None,
        "defaultPara": next((sid for sid, v in styles.items()
                             if v["pPr"] is not None and sid == "a"), None),
    }


def _merge(dst: dict, src) -> None:
    """按 tag 覆盖合并（后写胜），用于解析样式继承链。"""
    if src is None:
        return
    for child in src:
        dst[child.tag] = child


def resolve_para(p, sm: dict) -> dict:
    """段落的「解析后格式」：docDefaults → pStyle/basedOn 继承链 → 段落自身 → 首个 run。

    比 XML 逐字节更贴近渲染结果：块里那些没写死、靠继承生效的字号/行距/字体，
    只有把它解析出来才能证明源与产物真的同款。
    """
    pPr: dict = {}
    rPr: dict = {}
    _merge(rPr, sm["rPrDefault"])
    _merge(pPr, sm["pPrDefault"])
    ppr = p.find(q("pPr"))
    sid = None
    if ppr is not None:
        st = ppr.find(q("pStyle"))
        sid = st.get(q("val")) if st is not None else None
    chain, cur, seen = [], sid, set()
    while cur and cur in sm["styles"] and cur not in seen:
        seen.add(cur)
        chain.append(cur)
        cur = sm["styles"][cur]["basedOn"]
    for s in reversed(chain):
        _merge(rPr, sm["styles"][s]["rPr"])
        _merge(pPr, sm["styles"][s]["pPr"])
    if ppr is not None:
        _merge(rPr, ppr.find(q("rPr")))
        _merge(pPr, ppr)
    runs = p.findall(q("r"))
    if runs:
        _merge(rPr, runs[0].find(q("rPr")))

    def attrs(d, tag):
        e = d.get(q(tag))
        return {k.split("}")[1]: v for k, v in e.attrib.items()} if e is not None else {}

    fonts = rPr.get(q("rFonts"))
    return {
        "jc": attrs(pPr, "jc").get("val"),
        "spacing": attrs(pPr, "spacing"),
        "ind": attrs(pPr, "ind"),
        "fonts": {k.split("}")[1]: v for k, v in fonts.attrib.items()} if fonts is not None else {},
        "sz": attrs(rPr, "sz").get("val"),
        "szCs": attrs(rPr, "szCs").get("val"),
        "b": q("b") in rPr,
        "i": q("i") in rPr,
        "lang_ea": attrs(rPr, "lang").get("eastAsia"),
    }


def wrap_ns(raw: bytes, seg: bytes) -> bytes:
    """给裸片段套一层带 xmlns 声明的包装元素，好让 ET 能解析。"""
    m = re.search(rb"<w:document\b[^>]*>", raw)
    decls = b" ".join(re.findall(rb'xmlns:[\w]+="[^"]+"', m.group(0))) if m else b""
    return b"<w:wrap " + decls + b">" + seg + b"</w:wrap>"


def main() -> int:
    spec_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    spec = load_spec(spec_path)
    src = Path(spec["source_docx"])
    src_p, out_p = parts(src), parts(out_path)
    src_els, out_els = body_els(src_p["word/document.xml"]), body_els(out_p["word/document.xml"])
    print(f"源模板: {src.name}   产物: {out_path.name}")
    print(f"源 body {len(src_els)} 元素 / 产物 body {len(out_els)} 元素\n")

    # -------- 1. 页面设置 --------
    # 以 spec.page 为准（规范类文档源文件的页边距不代表产物要求，克隆时会按 spec 覆写 pgMar）
    def sect(data):
        sp = ET.fromstring(data).find(".//" + q("sectPr"))
        def g(tag):
            e = sp.find(q(tag))
            return {k.split("}")[1]: v for k, v in e.attrib.items()} if e is not None else None
        return g("pgSz"), g("pgMar"), g("docGrid")

    out_sz, out_mar, out_grid = sect(out_p["word/document.xml"])
    exp = spec.get("page") or {}
    if exp.get("width_twips"):
        check("页面尺寸 pgSz（spec）",
              (out_sz or {}).get("w") == str(exp["width_twips"])
              and (out_sz or {}).get("h") == str(exp["height_twips"]),
              str(out_sz))
    mar = exp.get("margin") or {}
    if mar:
        bad = {k: out_mar.get(k) for k in ("top", "bottom", "left", "right",
                                           "header", "footer")
               if k in mar and out_mar.get(k) != str(mar[k])}
        check("页边距 pgMar（spec）", not bad, f"不符项: {bad}" if bad else str(out_mar))
    dg = exp.get("doc_grid") or {}
    if dg:
        check("文档网格 docGrid（spec）",
              (out_grid or {}).get("type") == str(dg.get("type"))
              and (out_grid or {}).get("linePitch") == str(dg.get("line_pitch")),
              str(out_grid))

    # -------- 2~4. 封面 / 尾页评分表：整页原样搬运，只比原始字节 --------
    # 不解析表格结构（行/列/合并/文本一律不看）——那是"复刻"，不是"搬运"。
    # 判据只有一条：源 docx 的那段原始字节，是否原封不动出现在产物里。
    from template_factory import iter_body_top_level, _RID_ATTR_B

    def rid_norm(b: bytes) -> bytes:
        """rId 会被注入侧重映射（避冲突），归一掉再比。"""
        return re.sub(rb'rId\d+x*', b'RID', b)

    src_raw = src_p["word/document.xml"]
    out_raw = out_p["word/document.xml"]
    out_norm = rid_norm(out_raw)
    spans = list(iter_body_top_level(src_raw))

    for key, at in (("cover", "start"), ("tail", "end")):
        s_slice = spec[key]["slice"]
        if s_slice is None or str(s_slice) == "auto":
            # 与工厂同源：用自动探测解析边界，避免验收与构建各说一套
            from template_factory import detect_blocks
            det = detect_blocks(src, marker=spec.get("marker")).get(key)
            if not det:
                check(f"{key} 块自动探测", False, "探测失败，spec 需写显式 slice")
                continue
            s_slice = det["slice"]
            print(f"[{key}] 自动探测 slice={s_slice} 策略={det['strategy']}（{det['evidence']}）")
        frag = b"".join(src_raw[a:b] for _n, a, b in spans[s_slice[0]:s_slice[1]])
        # 工厂会去掉顶层段落内嵌 sectPr，验收用同一规则
        frag = re.sub(rb'(<w:p\b[^>]*>\s*<w:pPr>)(.*?)(</w:pPr>)',
                      lambda m: m.group(1)
                      + re.sub(rb'<w:sectPr\b.*?</w:sectPr>', b'', m.group(2), flags=re.S)
                      + m.group(3), frag, flags=re.S)
        nfrag = rid_norm(frag)   # 归一后长度会变短（rId6x→RID），切片必须用归一后长度
        hit = out_norm.find(nfrag)
        check(f"{key} 整页原始字节原样出现在产物中",
              hit != -1, f"{len(frag)} 字节 / 命中位置 {hit}")
        if hit != -1:
            # 位置：封面必须在正文之前，评分表必须在正文之后
            body_main = out_norm.find(rid_norm(b"<w:p>"))
            if at == "start":
                # 正文第一段带 <w:pStyle>；封面块整体必须排在它之前
                body_start = out_norm.find(b"<w:pStyle")
                check("封面整体位于正文之前", body_start == -1 or hit < body_start,
                      f"封面@{hit} vs 正文首个 pStyle@{body_start}")
            else:
                # 评分表末尾应紧邻 </w:body>（其后只剩 sectPr）
                gap = out_norm.rfind(b"</w:body>") - (hit + len(nfrag))
                check("评分表紧邻文末（其后仅剩 sectPr）", 0 <= gap < 1000,
                      f"距 </w:body> 还差 {gap} 字节")
            # 只出现一次（没有重复注入）
            check(f"{key} 只注入一次",
                  out_norm.count(nfrag) == 1,
                  f"出现 {out_norm.count(nfrag)} 次")
        # 图片资源
        media = [n for n in out_p if n.startswith("word/media/")]
        rids = {m.group(2).decode() for m in _RID_ATTR_B.finditer(frag)}
        if rids:
            check(f"{key} 引用的图片已随块注入", bool(media), str(media))
        # 解析后格式：块内每个段落（含表内段落）与源逐段比对
        if hit != -1:
            s_sm = style_index(src_p["word/styles.xml"])
            o_sm = style_index(out_p["word/styles.xml"])
            s_ps = [p for _n, a, b in spans[s_slice[0]:s_slice[1]]
                    for p in ET.fromstring(wrap_ns(src_raw, src_raw[a:b])).iter(q("p"))]
            out_seg = out_norm[hit:hit + len(nfrag)]
            o_ps = [p for p in ET.fromstring(wrap_ns(out_raw, out_seg)).iter(q("p"))]
            check(f"{key} 段落数一致", len(s_ps) == len(o_ps), f"源 {len(s_ps)} / 产物 {len(o_ps)}")
            diffs = []
            for i, (a, b2) in enumerate(zip(s_ps, o_ps)):
                fa, fb = resolve_para(a, s_sm), resolve_para(b2, o_sm)
                if fa != fb:
                    diffs.append((i, txt(a)[:14], fa, fb))
            check(f"{key} 解析后格式逐段一致（字号/行距/缩进/字体/加粗，含样式继承）",
                  not diffs,
                  f"{len(diffs)} 段不同" + (f"，首个：{diffs[0]}" if diffs else ""))
        # 东亚语言：默认字体/语言必须落在中文，不能是日文
        ea = re.search(rb'<w:themeFontLang[^>]*w:eastAsia="([^"]+)"',
                       out_p.get("word/settings.xml", b""))
        check("文档东亚语言为 zh-CN（非 ja-JP，否则默认东亚字体变日文字体）",
              ea is not None and ea.group(1) == b"zh-CN",
              ea.group(1).decode() if ea else "未设置")

    # -------- 5~6. 样式 --------
    out_styles = ET.fromstring(out_p["word/styles.xml"])

    def sfmt(sid):
        for s in out_styles.findall(q("style")):
            if s.get(q("styleId")) == sid or (
                    s.find(q("name")) is not None and s.find(q("name")).get(q("val")) == sid):
                d = {}
                rpr, ppr = s.find(q("rPr")), s.find(q("pPr"))
                if rpr is not None:
                    f = rpr.find(q("rFonts"))
                    if f is not None:
                        d["fonts"] = {k.split("}")[1]: v for k, v in f.attrib.items()}
                    for t in ("sz", "szCs"):
                        e = rpr.find(q(t))
                        if e is not None:
                            d[t] = e.get(q("val"))
                    d["b"] = rpr.find(q("b")) is not None
                if ppr is not None:
                    for tag, kk in (("spacing", "spacing"), ("ind", "ind")):
                        e = ppr.find(q(tag))
                        if e is not None:
                            d[kk] = {k.split("}")[1]: v for k, v in e.attrib.items()}
                    jc = ppr.find(q("jc"))
                    if jc is not None:
                        d["jc"] = jc.get(q("val"))
                return d
        return None

    def expect_style(sid, label):
        d = sfmt(sid)
        check(f"{label} 样式存在", d is not None)
        return d or {}

    # 正文：pandoc 先按 lua 的 custom-style 建中文 styleId，DSL 再按 name 覆盖
    b_name = spec["body"].get("style_name", "文章的正文")
    b = expect_style(b_name, "正文")
    br, bp = spec["body"]["run"], spec["body"]["paragraph"]
    check(f"正文字号 sz={br['size_half_pt']}", b.get("sz") == str(br["size_half_pt"]), str(b.get("sz")))
    _m = re.match(r"([\d.]+)", bp["line_spacing"])
    want_line = str(int(round(float(_m.group(1)) * 20))) if _m else None
    check(f"正文行距固定 {bp['line_spacing']}（line={want_line} exact）",
          b.get("spacing", {}).get("line") == want_line
          and b.get("spacing", {}).get("lineRule") == "exact", str(b.get("spacing")))
    check("正文首行缩进 2 字符",
          b.get("ind", {}).get("firstLineChars") == "200"
          and b.get("ind", {}).get("firstLine") == str(bp.get("first_line_dxa", 200)),
          str(b.get("ind")))
    check("正文对齐", b.get("jc") == bp.get("align"), str(b.get("jc")))
    check("正文字体",
          b.get("fonts", {}).get("eastAsia") == br.get("cjk_font")
          and b.get("fonts", {}).get("ascii") == br.get("latin_font"), str(b.get("fonts")))

    # 各级标题逐级核对（L1/L2 规格不同，不能拿 L1 的值去查 L2）
    for h in spec.get("headings") or []:
        lvl = h["level"]
        d = expect_style(str(lvl), f"标题样式 {lvl}")
        hr = h["run"]
        check(f"标题 {lvl} 字体/字号",
              d.get("fonts", {}).get("eastAsia") == hr.get("cjk_font")
              and d.get("sz") == str(hr["size_half_pt"]),
              f"{d.get('fonts', {}).get('eastAsia')} sz={d.get('sz')}")
        _hm = re.match(r"([\d.]+)", h["paragraph"].get("line_spacing", "")) \
            if h.get("paragraph", {}).get("line_spacing") else None
        h_line = str(int(round(float(_hm.group(1)) * 20))) if _hm else None
        if h_line:
            check(f"标题 {lvl} 行距 line={h_line} exact",
                  d.get("spacing", {}).get("line") == h_line
                  and d.get("spacing", {}).get("lineRule") == "exact", str(d.get("spacing")))
        if h.get("paragraph", {}).get("first_line_dxa"):
            check(f"标题 {lvl} 首行缩进 2 字符",
                  d.get("ind", {}).get("firstLine") == str(h["paragraph"]["first_line_dxa"]),
                  str(d.get("ind")))

    if spec.get("title"):
        t = expect_style("Title", "论文题目")
        tr = spec["title"]["run"]
        check("题目字号/加粗/居中",
              t.get("sz") == str(tr["size_half_pt"]) and t.get("b")
              and t.get("jc") == spec["title"]["paragraph"].get("align", "center"),
              f"sz={t.get('sz')} b={t.get('b')} jc={t.get('jc')}")

    # -------- 6b. 映射样式：模板文字描述 → 本体系样式，逐项核对（别漏、别多切） --------
    for st in spec.get("extra_styles") or []:
        d = expect_style(st["name"], f"映射样式 {st['id']}")
        sr, sp = st.get("run", {}), st.get("paragraph", {})
        if sr.get("size_half_pt"):
            check(f"{st['id']} 字号 sz={sr['size_half_pt']}",
                  d.get("sz") == str(sr["size_half_pt"]), str(d.get("sz")))
        if sr.get("cjk_font"):
            check(f"{st['id']} 中文字体",
                  d.get("fonts", {}).get("eastAsia") == sr["cjk_font"],
                  str(d.get("fonts", {}).get("eastAsia")))
        if sp.get("align"):
            check(f"{st['id']} 对齐", d.get("jc") == sp["align"], str(d.get("jc")))
        _sm = re.match(r"([\d.]+)", sp.get("line_spacing", "")) if sp.get("line_spacing") else None
        if _sm:
            want = str(int(round(float(_sm.group(1)) * 20)))
            check(f"{st['id']} 行距 line={want} exact",
                  d.get("spacing", {}).get("line") == want
                  and d.get("spacing", {}).get("lineRule") == "exact", str(d.get("spacing")))
        if sp.get("first_line_chars") == 0 or sp.get("indent_clear"):
            ind = d.get("ind", {})
            # 0 也是"不缩进"（DSL 会显式写 firstLineChars=0/firstLine=0）
            check(f"{st['id']} 首行不缩进",
                  ind.get("firstLineChars", "0") in ("0", None)
                  and ind.get("firstLine", "0") in ("0", None), str(ind))

    # -------- 7. 段落落位 --------
    used: dict[str, list[str]] = {}
    for p in ET.fromstring(out_p["word/document.xml"]).iter(q("p")):
        s = txt(p)
        if not s:
            continue
        ppr = p.find(q("pPr"))
        ps = ppr.find(q("pStyle")) if ppr is not None else None
        used.setdefault(ps.get(q("val")) if ps is not None else "Normal", []).append(s[:24])
    print("\n产物段落所用样式：")
    for k, v in used.items():
        print(f"  {k:14s} ×{len(v):<3} 例: {v[0]!r}")
    check("正文段落走「文章的正文」", b_name in used, f"{len(used.get(b_name, []))} 段")
    check("章节标题走标题样式", any(k in used for k in ("1", "2", "3", "4")),
          f"1={len(used.get('1', []))} 2={len(used.get('2', []))}")
    if spec.get("title"):
        check("题目走 Title", "Title" in used, str(used.get("Title")))

    if "word/numbering.xml" in out_p:
        num = ET.fromstring(out_p["word/numbering.xml"])
        texts = [e.get(q("val")) for e in num.iter(q("lvlText")) if e.get(q("val"))]
        preset = {"guanke": "%1、", "gongke": "%1"}[spec.get("numbering", "guanke")]
        check(f"编号文本含 {preset!r}（{spec.get('numbering', 'guanke')}）", preset in texts,
              str(texts[:6]))
    else:
        check("numbering.xml 存在", False)

    print("\n" + "=" * 60)
    print(f"结论：{len(FAIL)} 项失败" + (f" → {FAIL}" if FAIL else " —— 全部通过"))
    return 1 if FAIL else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main())
