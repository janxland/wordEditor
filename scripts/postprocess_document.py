#!/usr/bin/env python3
"""
无 Word 的 docx 结构后处理（纯 OOXML）：
  - 标题：识别「一、」「1.1」等 → 去掉前缀 → 标题 1/2/3 + 多级编号（工科/管科）
  - 引用：正文 [N] → REF 书签域 + 上标
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from ooxml_numbering import HUTB_HEADING_NUM_ID  # noqa: E402
from ooxml_util import (  # noqa: E402
    NS,
    append_ref_field,
    append_text_run,
    bookmark_starts_in_paragraph,
    collect_bookmark_names,
    copy_rpr_superscript,
    paragraph_plain_text,
    parse_heading_line,
    patch_docx_parts,
    q,
    rebuild_paragraph_content,
    resolve_heading_style_ids,
    set_paragraph_heading_style,
    style_id_for_heading_level,
)

REF_IN_TEXT = re.compile(r"\[(\d+)\]")
TABLE_CAPTION_FALLBACK = re.compile(r"^\s*表(?:格)?\s*\d+\s*[-—:：.、）)]?\s*\S+")


def apply_headings(
    document_xml: bytes,
    styles_xml: bytes,
    *,
    heading_scheme: str = "guanke",
) -> tuple[bytes, bytes, int]:
    """heading_scheme: gongke | guanke"""
    styles_root = ET.fromstring(styles_xml)
    heading_ids = resolve_heading_style_ids(styles_root)
    if not heading_ids:
        print("  ! 未在 styles.xml 中找到标题样式，跳过标题识别", file=sys.stderr)
        return document_xml, styles_xml, 0

    root = ET.fromstring(document_xml)
    body = root.find("w:body", NS)
    if body is None:
        body = root

    changed = 0
    for child in list(body):
        if child.tag != q("p"):
            continue
        p = child
        parsed = parse_heading_line(paragraph_plain_text(p))
        if parsed is None:
            continue
        level, title = parsed
        if level not in heading_ids or not title:
            continue

        try:
            style_id = style_id_for_heading_level(level, heading_ids)
        except KeyError:
            continue

        set_paragraph_heading_style(
            p,
            style_id,
            title,
            num_id=HUTB_HEADING_NUM_ID,
            ilvl=level - 1,
        )
        changed += 1

    doc_out = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return doc_out, styles_xml, changed


def _patch_paragraph_refs(p: ET.Element, doc_bookmarks: set[str]) -> bool:
    text = paragraph_plain_text(p)
    if "[" not in text:
        return False

    bmk = bookmark_starts_in_paragraph(p)
    matches = list(REF_IN_TEXT.finditer(text))
    if not matches:
        return False

    valid: list[tuple[int, int, str]] = []
    for m in matches:
        num = m.group(1)
        name = f"Ref{num}"
        if name not in doc_bookmarks:
            continue
        if name in bmk and abs(bmk[name] - m.start()) <= 1:
            continue
        valid.append((m.start(), m.end(), num))

    if not valid:
        return False

    rpr = copy_rpr_superscript()
    pos = 0
    segments: list[tuple[str, str]] = []
    for start, end, num in valid:
        if start > pos:
            segments.append(("text", text[pos:start]))
        segments.append(("ref", num))
        pos = end
    if pos < len(text):
        segments.append(("text", text[pos:]))

    def build(p_el: ET.Element) -> None:
        for kind, payload in segments:
            if kind == "text":
                append_text_run(p_el, payload)
            else:
                append_ref_field(p_el, f"Ref{payload}", payload, rpr)

    rebuild_paragraph_content(p, build)
    return True


def apply_refs(document_xml: bytes) -> tuple[bytes, int]:
    root = ET.fromstring(document_xml)
    doc_bookmarks = collect_bookmark_names(root)
    if not doc_bookmarks:
        return document_xml, 0

    changed = 0
    for p in root.iter(q("p")):
        if _patch_paragraph_refs(p, doc_bookmarks):
            changed += 1

    return ET.tostring(root, encoding="utf-8", xml_declaration=True), changed


def _is_empty_para(p: ET.Element) -> bool:
    return paragraph_plain_text(p).strip() == ""


def _set_paragraph_style(p: ET.Element, style_name_or_id: str) -> None:
    ppr = p.find("w:pPr", NS)
    if ppr is None:
        ppr = ET.Element(q("pPr"))
        p.insert(0, ppr)
    ps = ppr.find("w:pStyle", NS)
    if ps is None:
        ps = ET.SubElement(ppr, q("pStyle"))
    ps.set(q("val"), style_name_or_id)


def apply_table_caption_fallback(document_xml: bytes) -> tuple[bytes, int]:
    """兜底：识别“表1/表 1/表格1 ...”且后面紧跟表格的段落，套用“表注”样式。"""
    root = ET.fromstring(document_xml)
    body = root.find("w:body", NS)
    if body is None:
        return document_xml, 0

    children = list(body)
    changed = 0
    for i, child in enumerate(children):
        if child.tag != q("p"):
            continue
        txt = paragraph_plain_text(child).strip()
        if not TABLE_CAPTION_FALLBACK.match(txt):
            continue

        j = i + 1
        while j < len(children) and children[j].tag == q("p") and _is_empty_para(children[j]):
            j += 1
        if j >= len(children) or children[j].tag != q("tbl"):
            continue

        _set_paragraph_style(child, "表注")
        changed += 1

    return ET.tostring(root, encoding="utf-8", xml_declaration=True), changed


def patch_docx(
    path: Path,
    *,
    skip_headings: bool = False,
    skip_refs: bool = False,
    heading_scheme: str = "guanke",
) -> dict[str, int]:
    import zipfile

    stats = {"headings": 0, "refs": 0, "table_captions": 0}
    with zipfile.ZipFile(path, "r") as z:
        styles_xml = z.read("word/styles.xml")
        doc_xml = z.read("word/document.xml")

    if not skip_headings:
        # 多级列表的 numbering.xml 修改由 postprocess_styles 的 DSL（multilevel_list）负责，
        # 这里只负责把「文本前缀」识别为 Heading 段并挂上 numPr。
        doc_xml, styles_xml, stats["headings"] = apply_headings(
            doc_xml,
            styles_xml,
            heading_scheme=heading_scheme or "guanke",
        )

    if not skip_refs:
        doc_xml, stats["refs"] = apply_refs(doc_xml)

    doc_xml, stats["table_captions"] = apply_table_caption_fallback(doc_xml)

    patches: dict[str, bytes] = {"word/document.xml": doc_xml}
    if not skip_headings:
        patches["word/styles.xml"] = styles_xml

    patch_docx_parts(
        path,
        {k: (lambda _data, v=v: v) for k, v in patches.items()},  # type: ignore[misc]
    )
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="OOXML 标题/引用后处理（无需 Word）")
    ap.add_argument("docx", type=Path)
    ap.add_argument("--skip-headings", action="store_true")
    ap.add_argument("--skip-refs", action="store_true")
    ap.add_argument(
        "--heading-scheme",
        choices=("gongke", "guanke"),
        default="guanke",
        help="标题多级编号：工科 gongke=1/1.1/1.1.1，管科 guanke=一、/1.1/1.1.1",
    )
    args = ap.parse_args(argv)

    if not args.docx.is_file():
        print(f"找不到: {args.docx}", file=sys.stderr)
        return 1

    stats = patch_docx(
        args.docx,
        skip_headings=args.skip_headings,
        skip_refs=args.skip_refs,
        heading_scheme=args.heading_scheme,
    )
    if not args.skip_headings:
        print(f"[postprocess_headings] {stats['headings']} 段（scheme={args.heading_scheme}）")
    if not args.skip_refs:
        print(f"[postprocess_refs] {stats['refs']} 段含引用")
    print(f"[postprocess_table_caption_fallback] {stats['table_captions']} 段")
    print("[postprocess_document] 完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
