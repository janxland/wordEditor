"""docx → Markdown 提取器（面向 hutb-math-modeling 模板）

特性：
- 标题：按 styleId / outlineLvl 还原 `#`/`##`/`###`，自动剥离原文 "1./5.1.1/一、" 前缀
- 摘要 / Abstract / 关键词 / Keywords：按内容识别并写成模板约定形式
- 列表段（List Paragraph 或 "(1)/①/数字)" 前缀）→ `- xxx`
- 普通正文：直接段落
- 数学公式：合并 w:t 与 m:t 文本（保留 LaTeX 原文 / OMML 文本占位）
- 图片：从 word/media/ 提取到 images/<slug>/，按出现顺序插入；其后若为 "图N" 段则当 caption
- 表格：转 markdown 表；若前一段为 "表N" 则作为 caption（写成 `Table:`，由 Lua 抽到表前）

依赖：标准库 zipfile + xml.etree。
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"

W = f"{{{W_NS}}}"
A = f"{{{A_NS}}}"
M = f"{{{M_NS}}}"
R = f"{{{R_NS}}}"
WP = f"{{{WP_NS}}}"
PIC = f"{{{PIC_NS}}}"


_HEAD_PREFIX_RE = re.compile(
    r"^\s*(?:"
    r"\d+(?:[.\uFF0E．]\d+)+[.\uFF0E．\s、　]*"     # 1.1 / 1.1.1（多段）
    r"|\d+[.\uFF0E．、　\s]+"                       # 1． / 1、 / 1 
    r"|[一二三四五六七八九十百零]+[、\.\uFF0E．\s　]+"  # 一、 二．
    r"|[（(]\d+[）)][\s\.]*"                       # (1)
    r"|\d+[）)][\s\.]*"                            # 1)
    r")"
)

_LIST_PREFIX_RE = re.compile(
    r"^\s*(?:"
    r"[（(]\d+[）)]"  # (1) （1）
    r"|\d+[）)]"      # 1)
    r"|[①②③④⑤⑥⑦⑧⑨⑩]"
    r")\s*"
)


def parse_styles(doc_zip: zipfile.ZipFile) -> dict[str, tuple[str, str]]:
    """返回 styleId -> (name, outlineLvl)。"""
    styles = ET.fromstring(doc_zip.read("word/styles.xml"))
    out: dict[str, tuple[str, str]] = {}
    for s in styles.findall(W + "style"):
        sid = s.get(W + "styleId") or ""
        name_el = s.find(W + "name")
        name = name_el.get(W + "val") if name_el is not None else ""
        ol = s.find(W + "pPr/" + W + "outlineLvl")
        olv = ol.get(W + "val") if ol is not None else ""
        out[sid] = (name, olv)
    return out


def parse_rels(doc_zip: zipfile.ZipFile) -> dict[str, str]:
    """rId -> target（图片相对路径）。"""
    rels = ET.fromstring(doc_zip.read("word/_rels/document.xml.rels"))
    NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    return {r.get("Id"): r.get("Target") for r in rels.findall(NS + "Relationship")}


def collect_text(elem: ET.Element) -> str:
    """汇总段落文本。w:t 直接取；w:tab / w:br 保持空白；
    `m:oMath` 块内的所有 m:t 合并为占位 LaTeX 文本，前后加 `$`，便于人工修复。
    """
    parts: list[str] = []
    math_tag = M + "oMath"
    math_para_tag = M + "oMathPara"

    def walk(node: ET.Element, in_math: bool) -> None:
        tag = node.tag
        if tag in (math_tag, math_para_tag) and not in_math:
            # 收集这个 math 块下所有 m:t 文本
            mparts = [t.text for t in node.iter(M + "t") if t.text]
            inner = "".join(mparts)
            if inner.strip():
                parts.append(f" ${inner}$ ")
            return
        if tag == W + "t" and node.text:
            parts.append(node.text)
        elif tag == W + "tab":
            parts.append("\t")
        elif tag == W + "br":
            parts.append("\n")
        for child in list(node):
            walk(child, in_math)

    walk(elem, False)
    return "".join(parts)


def collect_image_rids(elem: ET.Element) -> list[str]:
    """段落或单元中所有引用图片的 rId 列表（按出现顺序）。"""
    rids: list[str] = []
    for blip in elem.iter(A + "blip"):
        rid = blip.get(R + "embed") or blip.get(R + "link")
        if rid:
            rids.append(rid)
    return rids


def heading_level(sid: str, name: str, outline: str) -> int:
    """返回 1/2/3，否则 0。

    只在样式 name 以 "heading N" 或 styleId 以 "Heading" 开头时才认定为标题。
    避免把"Body Text"等带 outlineLvl 的正文样式误识为 `#####`。
    """
    nm = (name or "").lower()
    sl = sid.lower()
    if sl == "a3" or nm == "title":
        return 0  # Title 单独处理
    is_heading_style = nm.startswith("heading ") or sl.startswith("heading")
    if not is_heading_style:
        return 0
    if nm.startswith("heading "):
        try:
            return max(1, min(6, int(nm.split()[1])))
        except Exception:
            pass
    if outline.isdigit():
        v = int(outline)
        if 0 <= v <= 5:
            return v + 1
    return 0


def strip_heading_prefix(text: str) -> str:
    return _HEAD_PREFIX_RE.sub("", text).strip()


def is_list_paragraph(sid: str, name: str, text: str) -> bool:
    if (name or "").lower() in {"list paragraph"}:
        return True
    if _LIST_PREFIX_RE.match(text):
        return True
    return False


def normalize_text(t: str) -> str:
    """合并多余空白，但保留 latex 内的空格。"""
    # 把段落中段内全角/半角空格归并；保留数学的 \  反斜杠
    t = t.replace("\u00a0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()


_LATEX_CMD_RE = re.compile(
    r"\\(?:frac|int|sum|prod|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|infty|cdot|times|quad|qquad|pm|mp|leq|geq|neq|approx|to|left|right|partial|nabla|circ|text|mathrm|begin|end)\b"
)


def looks_like_pure_latex(t: str) -> bool:
    """段落很短且含有典型 LaTeX 命令时视为公式行。"""
    if not t or len(t) > 240:
        return False
    if not _LATEX_CMD_RE.search(t):
        return False
    # 不应有大段中文叙述（>10 个连续中文字符）
    if re.search(r"[\u4e00-\u9fff]{10,}", t):
        return False
    return True


def table_to_markdown(tbl: ET.Element) -> str:
    rows: list[list[str]] = []
    for tr in tbl.findall(W + "tr"):
        cells: list[str] = []
        for tc in tr.findall(W + "tc"):
            txt_parts = [collect_text(p) for p in tc.findall(W + "p")]
            cell = " <br> ".join(normalize_text(t) for t in txt_parts if t).strip()
            cells.append(cell or " ")
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [" "] * (width - len(r)) for r in rows]
    head = rows[0]
    sep = ["---"] * width
    body = rows[1:]
    lines = [
        "| " + " | ".join(head) + " |",
        "| " + " | ".join(sep) + " |",
    ]
    for r in body:
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in r) + " |")
    return "\n".join(lines)


def extract(docx_path: Path, out_md: Path, image_dir: Path, image_rel: str) -> dict:
    image_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(docx_path) as z:
        styles = parse_styles(z)
        rels = parse_rels(z)
        doc = ET.fromstring(z.read("word/document.xml"))
        # 拷贝并重命名图片
        rid_to_filename: dict[str, str] = {}
        media_index = 0
        for rid, tgt in rels.items():
            if not tgt.startswith("media/"):
                continue
            media_index += 1
            ext = os.path.splitext(tgt)[1].lower() or ".png"
            new_name = f"image{media_index:02d}{ext}"
            data = z.read("word/" + tgt)
            (image_dir / new_name).write_bytes(data)
            rid_to_filename[rid] = new_name

    body = doc.find(W + "body")
    out: list[str] = []
    title: str | None = None
    seen_abstract = False
    seen_abstract_en = False
    pending_image_caption_for: list[str] = []  # 上一段是图（待 caption）
    pending_table_caption: str | None = None
    stats = {"headings": 0, "images": 0, "tables": 0, "paragraphs": 0, "lists": 0}

    children = list(body)
    i = 0
    while i < len(children):
        child = children[i]
        tag = child.tag.split("}")[-1]

        if tag == "tbl":
            md_tbl = table_to_markdown(child)
            if pending_table_caption:
                out.append(md_tbl)
                out.append(f"\nTable: {pending_table_caption}\n")
                pending_table_caption = None
            else:
                out.append(md_tbl + "\n")
            stats["tables"] += 1
            i += 1
            continue

        if tag != "p":
            i += 1
            continue

        ps = child.find(W + "pPr/" + W + "pStyle")
        sid = ps.get(W + "val") if ps is not None else ""
        name, outline = styles.get(sid, ("", ""))
        text = normalize_text(collect_text(child))
        rids = collect_image_rids(child)

        # 图片段
        if rids:
            for rid in rids:
                fname = rid_to_filename.get(rid)
                if not fname:
                    continue
                rel = f"{image_rel}/{fname}".replace("\\", "/")
                out.append(f"![]({rel})\n")
                stats["images"] += 1
            # 若同一段还有文字（少见），作为后文继续
            if not text:
                i += 1
                continue

        # 题目
        if title is None and (sid == "a3" or (name or "").lower() == "title") and text:
            title = text
            i += 1
            continue

        if not text:
            i += 1
            continue

        # 摘要 / 关键词识别（无样式）
        if text == "摘要":
            seen_abstract = True
            out.append("\n摘要\n")
            i += 1
            continue
        if text == "Abstract":
            seen_abstract_en = True
            out.append("\nAbstract\n")
            i += 1
            continue
        if text.startswith(("关键词：", "关键词:", "关 键 词：")):
            kw = re.sub(r"^关\s*键\s*词\s*[:：]\s*", "", text)
            out.append(f"\n**关键词**：{kw}\n")
            i += 1
            continue
        if text.lower().startswith(("keywords:", "keywords：", "key words:")):
            kw = re.sub(r"^[Kk]ey\s*[Ww]ords\s*[:：]\s*", "", text)
            out.append(f"\n**Keywords**: {kw}\n")
            i += 1
            continue

        # 图注 / 表注：图片之后或表格之前的 "图N xxx" / "表N xxx"
        m_fig = re.match(r"^(图\s*\d+[\s．.：:、　]*)(.*)$", text)
        m_tbl = re.match(r"^(表\s*\d+[\s．.：:、　]*)(.*)$", text)
        if m_fig and out and out[-1].startswith("!["):
            # 紧跟图片：作为 Figure caption
            cap = m_fig.group(2).strip() or m_fig.group(1).strip()
            # 把上一行 ![]() 改为 ![cap]()
            last = out[-1].rstrip("\n")
            out[-1] = last.replace("![]", f"![{cap}]", 1) + "\n"
            i += 1
            continue
        if m_tbl:
            # 下一个 sibling 若是 tbl，则作为 caption
            j = i + 1
            while j < len(children) and children[j].tag.split("}")[-1] not in {"tbl", "p"}:
                j += 1
            if j < len(children) and children[j].tag.split("}")[-1] == "tbl":
                pending_table_caption = (m_tbl.group(2).strip() or m_tbl.group(1).strip())
                i += 1
                continue

        # 标题
        lvl = heading_level(sid, name, outline)
        if lvl >= 1:
            clean = strip_heading_prefix(text)
            if clean:
                out.append(f"\n{'#' * lvl} {clean}\n")
                stats["headings"] += 1
                i += 1
                continue

        # 列表
        if is_list_paragraph(sid, name, text):
            t2 = _LIST_PREFIX_RE.sub("", text)
            out.append(f"- {t2}")
            stats["lists"] += 1
            i += 1
            continue

        # LaTeX 公式行 → $$...$$
        if looks_like_pure_latex(text):
            out.append(f"$$\n{text}\n$$")
            stats["paragraphs"] += 1
            i += 1
            continue

        # 极短无意义段（如孤立的 "。"）
        if len(text) <= 2 and re.fullmatch(r"[。.！!？?，,；;：:、\s]+", text):
            i += 1
            continue

        # 普通段
        out.append(text)
        stats["paragraphs"] += 1
        i += 1

    # 组装 markdown
    head_yaml = ["---", f"title: {title or docx_path.stem}", "---", ""]
    body_md = "\n\n".join(line for line in out if line is not None)
    # 收紧多余空行
    body_md = re.sub(r"\n{3,}", "\n\n", body_md)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text("\n".join(head_yaml) + body_md + "\n", encoding="utf-8")
    return {"title": title, **stats}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--input", required=True, help="源 .docx")
    ap.add_argument("-o", "--output", required=True, help="目标 .md")
    ap.add_argument("--image-dir", help="图片导出目录（默认 input/images/<slug>）")
    ap.add_argument("--image-rel", help="markdown 中图片相对路径前缀（默认 images/<slug>）")
    args = ap.parse_args()

    src = Path(args.input).resolve()
    dst = Path(args.output).resolve()
    slug = dst.stem
    img_dir = Path(args.image_dir).resolve() if args.image_dir else dst.parent / "images" / slug
    img_rel = args.image_rel or f"images/{slug}"

    stats = extract(src, dst, img_dir, img_rel)
    print(f"[extract] 写入 {dst}")
    print(f"[extract] 标题: {stats['title']}")
    print(f"[extract] 标题段 {stats['headings']} | 段落 {stats['paragraphs']} | 列表 {stats['lists']} | 图 {stats['images']} | 表 {stats['tables']}")


if __name__ == "__main__":
    sys.exit(main())
