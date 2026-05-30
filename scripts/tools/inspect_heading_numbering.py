#!/usr/bin/env python3
"""读取 docx 中 Heading 1..N 的多级编号配置（styles.xml + numbering.xml）。

用法：
    py scripts/inspect_heading_numbering.py <docx> [--max-level 6]

输出：
    每个 heading 样式 → 绑定的 numId / abstractNumId / 各级 numFmt+lvlText+isLgl+suff+start
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = NS["w"]


def _q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def _val(el, tag: str) -> str | None:
    child = el.find(f"w:{tag}", NS)
    if child is None:
        return None
    return child.get(_q("val"))


def _is_heading_style_id(sid: str | None) -> int | None:
    """返回 heading level（1..9）或 None。
    支持: '1' '2' .. '9' / 'Heading1' .. / 'heading 1' .. / '标题 1' .."""
    if not sid:
        return None
    s = sid.strip()
    if re.fullmatch(r"\d", s):
        return int(s)
    m = re.fullmatch(r"(?:[Hh]eading|heading\s+|\u6807\u9898\s*)(\d)", s)
    if m:
        return int(m.group(1))
    return None


def load_styles(zf: zipfile.ZipFile) -> dict[int, dict]:
    """返回 {level: {'styleId':..., 'name':..., 'numId':..., 'ilvl':...}}"""
    out: dict[int, dict] = {}
    try:
        data = zf.read("word/styles.xml")
    except KeyError:
        return out
    root = ET.fromstring(data)
    for st in root.findall("w:style", NS):
        sid = st.get(_q("styleId"))
        lvl = _is_heading_style_id(sid)
        if lvl is None:
            # 兼容 name 形态 styleId="2" name="heading 2"
            name = _val(st, "name") or ""
            lvl = _is_heading_style_id(name)
        if lvl is None:
            continue
        name = _val(st, "name") or sid
        ppr = st.find("w:pPr", NS)
        numId = ilvl = None
        if ppr is not None:
            numpr = ppr.find("w:numPr", NS)
            if numpr is not None:
                numId = (numpr.find("w:numId", NS).get(_q("val"))
                         if numpr.find("w:numId", NS) is not None else None)
                ilvl = (numpr.find("w:ilvl", NS).get(_q("val"))
                        if numpr.find("w:ilvl", NS) is not None else None)
        out[lvl] = {"styleId": sid, "name": name, "numId": numId, "ilvl": ilvl}
    return out


def load_numbering(zf: zipfile.ZipFile) -> tuple[dict[str, str], dict[str, dict]]:
    """返回 (numId→abstractId, abstractId→{ilvl: lvl_props})"""
    num_to_abs: dict[str, str] = {}
    abs_lvls: dict[str, dict] = {}
    try:
        data = zf.read("word/numbering.xml")
    except KeyError:
        return num_to_abs, abs_lvls
    root = ET.fromstring(data)
    for num in root.findall("w:num", NS):
        nid = num.get(_q("numId"))
        anid_el = num.find("w:abstractNumId", NS)
        if nid and anid_el is not None:
            num_to_abs[nid] = anid_el.get(_q("val"))
    for an in root.findall("w:abstractNum", NS):
        aid = an.get(_q("abstractNumId"))
        lvls: dict[str, dict] = {}
        for lvl in an.findall("w:lvl", NS):
            il = lvl.get(_q("ilvl"))
            lvls[il] = {
                "numFmt": _val(lvl, "numFmt"),
                "lvlText": _val(lvl, "lvlText"),
                "suff": _val(lvl, "suff") or "tab",
                "start": _val(lvl, "start"),
                "isLgl": lvl.find("w:isLgl", NS) is not None,
                "pStyle": _val(lvl, "pStyle"),
            }
        abs_lvls[aid] = lvls
    return num_to_abs, abs_lvls


def inspect(path: Path, max_level: int = 6) -> None:
    print(f"\n== {path} ==")
    with zipfile.ZipFile(path) as zf:
        heads = load_styles(zf)
        n2a, alv = load_numbering(zf)
    if not heads:
        print("  (未发现任何 heading 样式)")
        return
    # 收集所有出现的 numId（含 heading 上的）
    seen_nums = sorted({h["numId"] for h in heads.values() if h["numId"]})
    print(f"  heading 样式 → numId 映射:")
    for lvl in sorted(heads):
        if lvl > max_level:
            continue
        h = heads[lvl]
        marker = "  ←"  if h["numId"] else ""
        print(f"    H{lvl}: styleId={h['styleId']!r:>10} name={h['name']!r:>18} numId={h['numId']} ilvl={h['ilvl']}{marker}")
    # 展开每个 numId 的各级
    for nid in seen_nums:
        aid = n2a.get(nid)
        print(f"\n  numId={nid} → abstractNumId={aid}:")
        if aid is None or aid not in alv:
            print("    (该 abstractNum 未在 numbering.xml 中找到)")
            continue
        for il in sorted(alv[aid], key=lambda x: int(x)):
            if int(il) >= max_level:
                continue
            p = alv[aid][il]
            tags = []
            if p["isLgl"]:
                tags.append("isLgl")
            if p["pStyle"]:
                tags.append(f"pStyle={p['pStyle']}")
            tag_str = f"  [{', '.join(tags)}]" if tags else ""
            print(f"    ilvl={il}: fmt={p['numFmt']!r:>16} text={p['lvlText']!r:>14} suff={p['suff']!r:>8} start={p['start']}{tag_str}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="读取 docx Heading 1..N 的多级编号配置")
    ap.add_argument("docx", nargs="+", type=Path, help="一个或多个 docx 文件")
    ap.add_argument("--max-level", type=int, default=6)
    args = ap.parse_args(argv[1:])
    for p in args.docx:
        if not p.is_file():
            print(f"  跳过（不存在）: {p}", file=sys.stderr)
            continue
        inspect(p, args.max_level)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
