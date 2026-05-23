"""从 .docx 提取列表样式，输出可直接合并进 list-style-library.yaml 的片段。

用法：
    py scripts/extract_list_styles.py -i path/to/list-style.docx \
        [-o output/extracted-list-styles.yaml] [--prefix Extracted]

行为：
  1. 扫描 word/document.xml，找所有挂了 numPr 的段落，按 (numId, ilvl) 去重并
     记录"使用样例文本"（取首段非空 5 个字符）
  2. 从 word/numbering.xml 解析每个 numId → abstractNumId → 各 lvl 的
     (numFmt, lvlText, suff, start, jc, font)
  3. 输出 yaml 片段：每个唯一的 (numFmt, lvlText) 组合 → 一条样式
       id: <prefix><NN>      # 如 Extracted01
       name: "<numFmt> %1=… 列表"
       based_on: ListBase
       list: { num_fmt, lvl_text, suff, start }

  4. bullet 字体（如 Wingdings 字符）会附 description 备注，便于人工命名

把输出 yaml 中的样式块拷贝到 templates/_shared/list-style-library.yaml
末尾即可，前端勾选启用。

依赖：仅标准库 zipfile + xml.etree。
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def Q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def parse_numbering(numbering_xml: bytes) -> tuple[dict[str, str], dict[str, dict[int, dict]]]:
    """返回 (numId -> abstractId, abstractId -> {ilvl -> lvl_props})。"""
    if not numbering_xml.strip():
        return {}, {}
    root = ET.fromstring(numbering_xml)
    num_to_abs: dict[str, str] = {}
    for n in root.findall("w:num", NS):
        nid = n.get(Q("numId"))
        a = n.find("w:abstractNumId", NS)
        if nid and a is not None:
            num_to_abs[nid] = a.get(Q("val"), "")

    abs_lvls: dict[str, dict[int, dict]] = {}
    for ab in root.findall("w:abstractNum", NS):
        aid = ab.get(Q("abstractNumId"), "")
        lvls: dict[int, dict] = {}
        for lvl in ab.findall("w:lvl", NS):
            try:
                ilvl = int(lvl.get(Q("ilvl"), "0"))
            except ValueError:
                continue
            def gv(tag: str) -> str | None:
                el = lvl.find(f"w:{tag}", NS)
                return el.get(Q("val")) if el is not None else None
            # bullet 字体（Wingdings 等）
            rfont = lvl.find("w:rPr/w:rFonts", NS)
            font = None
            if rfont is not None:
                font = rfont.get(Q("ascii")) or rfont.get(Q("hAnsi")) or rfont.get(Q("cs"))
            lvls[ilvl] = {
                "num_fmt": gv("numFmt") or "decimal",
                "lvl_text": gv("lvlText") or "",
                "suff": gv("suff") or "tab",
                "start": int(gv("start") or 1),
                "align": gv("lvlJc") or "left",
                "font": font,
                "pStyle": gv("pStyle"),
            }
        abs_lvls[aid] = lvls
    return num_to_abs, abs_lvls


def find_used_numpr(doc_xml: bytes) -> dict[tuple[str, int], list[str]]:
    """扫 document.xml，统计 (numId, ilvl) → 例句列表。"""
    root = ET.fromstring(doc_xml)
    used: dict[tuple[str, int], list[str]] = {}
    for p in root.iter(Q("p")):
        np = p.find(".//w:pPr/w:numPr", NS)
        if np is None:
            continue
        ilvl_el = np.find("w:ilvl", NS)
        nid_el = np.find("w:numId", NS)
        if nid_el is None:
            continue
        nid = nid_el.get(Q("val"), "")
        ilvl = int(ilvl_el.get(Q("val"), "0")) if ilvl_el is not None else 0
        text = "".join(t.text or "" for t in p.iter(Q("t")))
        key = (nid, ilvl)
        used.setdefault(key, []).append(text.strip()[:20])
    return used


def yaml_escape(s: str) -> str:
    if s == "":
        return '""'
    # 用双引号，转义内部双引号与反斜杠
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def to_yaml_snippet(
    items: list[dict],
    prefix: str = "Extracted",
) -> str:
    out: list[str] = []
    out.append("# === 由 extract_list_styles.py 自动生成；请检查后按需重命名/精简 ===")
    out.append("list_style_library:")
    for idx, it in enumerate(items, 1):
        sid = f"{prefix}{idx:02d}"
        name = it.get("name") or f"{it['num_fmt']} 列表 ({it['lvl_text']!r})"
        out.append(f"  - id: \"{sid}\"")
        out.append(f"    name: {yaml_escape(name)}")
        out.append("    based_on: \"ListBase\"")
        desc = it.get("description")
        if desc:
            out.append(f"    description: {yaml_escape(desc)}")
        out.append("    list:")
        out.append(f"      num_fmt: {yaml_escape(it['num_fmt'])}")
        out.append(f"      lvl_text: {yaml_escape(it['lvl_text'])}")
        out.append(f"      suff: {yaml_escape(it.get('suff') or 'space')}")
        out.append(f"      start: {it.get('start', 1)}")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-i", "--input", required=True, help="源 .docx")
    ap.add_argument("-o", "--output", help="输出 yaml 片段（默认打印到 stdout）")
    ap.add_argument("--prefix", default="Extracted", help="生成的样式 id 前缀")
    ap.add_argument("--include-unused", action="store_true", help="也输出未在 document.xml 出现的 num 定义")
    args = ap.parse_args()

    src = Path(args.input).resolve()
    if not src.is_file():
        print(f"找不到: {src}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(src) as z:
        numbering = z.read("word/numbering.xml") if "word/numbering.xml" in z.namelist() else b""
        doc = z.read("word/document.xml")

    num_to_abs, abs_lvls = parse_numbering(numbering)
    used = find_used_numpr(doc)

    # 收集唯一样式：以 (num_fmt, lvl_text, font) 去重
    seen: dict[tuple, dict] = {}
    keys = sorted(used.keys()) if not args.include_unused else [
        (nid, ilvl)
        for nid, aid in num_to_abs.items()
        for ilvl in abs_lvls.get(aid, {})
    ]
    for nid, ilvl in keys:
        aid = num_to_abs.get(nid)
        if aid is None:
            continue
        lvl = abs_lvls.get(aid, {}).get(ilvl)
        if not lvl:
            continue
        key = (lvl["num_fmt"], lvl["lvl_text"], lvl.get("font"))
        if key in seen:
            continue
        examples = used.get((nid, ilvl), [])
        ex_str = " / ".join(e for e in examples[:3] if e)
        desc_parts = [f"源 numId={nid} ilvl={ilvl}"]
        if lvl.get("font"):
            desc_parts.append(f"字体: {lvl['font']}")
        if ex_str:
            desc_parts.append(f"例句: {ex_str}")
        item = {
            **lvl,
            "description": "；".join(desc_parts),
        }
        # 给 bullet 起个临时名（基于 lvl_text 的可见字符）
        lt = lvl["lvl_text"]
        if lvl["num_fmt"] == "bullet":
            item["name"] = f"{lt or 'bullet'} 项目符号列表"
        elif lvl["num_fmt"] == "decimal" and "%" in lt:
            item["name"] = f"{lt.replace('%1', '1')} 数字列表"
        seen[key] = item

    snippet = to_yaml_snippet(list(seen.values()), prefix=args.prefix)

    if args.output:
        Path(args.output).resolve().write_text(snippet, encoding="utf-8")
        print(f"[extract_list_styles] 写入 {args.output} （{len(seen)} 条）")
    else:
        sys.stdout.write(snippet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
