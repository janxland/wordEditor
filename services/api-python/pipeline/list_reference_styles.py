#!/usr/bin/env python3
"""
枚举 reference.docx 中的所有样式，并输出 JSON / 可读列表。

用途：
    把 reference.docx 内置 / 自定义样式（标题、正文、列表、表格…）原样
    暴露给前端"样式总览"面板，方便定位需要在 styles.yaml 里 override 的目标。

用法：
    py scripts/list_reference_styles.py -t hutb-guanke              # 可读
    py scripts/list_reference_styles.py -t hutb-guanke --json       # 机读
    py scripts/list_reference_styles.py --docx path/to/x.docx --json
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ET.register_namespace("w", W)


def _q(t: str) -> str:
    return f"{{{W}}}{t}"


def _val(el: ET.Element | None, default: str = "") -> str:
    return el.get(_q("val"), default) if el is not None else default


def _twips_to_pt(twips: str | None) -> float | None:
    if not twips:
        return None
    try:
        return round(int(twips) / 20.0, 2)
    except ValueError:
        return None


def _parse_rfonts(rfonts: ET.Element | None) -> dict[str, str]:
    if rfonts is None:
        return {}
    out: dict[str, str] = {}
    for k in ("ascii", "hAnsi", "cs", "eastAsia"):
        v = rfonts.get(_q(k))
        if v:
            out[k] = v
    return out


def _parse_rpr(rpr: ET.Element | None) -> dict[str, Any]:
    if rpr is None:
        return {}
    out: dict[str, Any] = {}
    fonts = _parse_rfonts(rpr.find("w:rFonts", NS))
    if fonts:
        out["fonts"] = fonts
    sz = rpr.find("w:sz", NS)
    if sz is not None and sz.get(_q("val")):
        try:
            out["size_pt"] = round(int(sz.get(_q("val"), "0")) / 2.0, 2)
            out["size_half_pt"] = int(sz.get(_q("val"), "0"))
        except ValueError:
            pass
    if rpr.find("w:b", NS) is not None:
        out["bold"] = True
    if rpr.find("w:i", NS) is not None:
        out["italic"] = True
    color = rpr.find("w:color", NS)
    if color is not None and color.get(_q("val")):
        out["color"] = color.get(_q("val"))
    u = rpr.find("w:u", NS)
    if u is not None and u.get(_q("val")):
        out["underline"] = u.get(_q("val"))
    return out


def _parse_ppr(ppr: ET.Element | None) -> dict[str, Any]:
    if ppr is None:
        return {}
    out: dict[str, Any] = {}
    jc = ppr.find("w:jc", NS)
    if jc is not None and jc.get(_q("val")):
        out["align"] = jc.get(_q("val"))
    spacing = ppr.find("w:spacing", NS)
    if spacing is not None:
        sp: dict[str, Any] = {}
        line = spacing.get(_q("line"))
        rule = spacing.get(_q("lineRule"), "auto")
        if line:
            try:
                ln = int(line)
                if rule == "auto":
                    # 240 twips = 1.0 倍行距
                    sp["line_multi"] = round(ln / 240.0, 2)
                else:
                    sp["line_pt"] = round(ln / 20.0, 2)
                sp["line_rule"] = rule
            except ValueError:
                pass
        before = spacing.get(_q("before"))
        after = spacing.get(_q("after"))
        if before:
            sp["before_pt"] = _twips_to_pt(before)
        if after:
            sp["after_pt"] = _twips_to_pt(after)
        if sp:
            out["spacing"] = sp
    ind = ppr.find("w:ind", NS)
    if ind is not None:
        i: dict[str, Any] = {}
        for attr in ("firstLine", "firstLineChars", "hanging", "hangingChars", "left", "leftChars", "right"):
            v = ind.get(_q(attr))
            if v and v != "0":
                if attr.endswith("Chars"):
                    try:
                        i[attr] = int(v) / 100.0
                    except ValueError:
                        i[attr] = v
                else:
                    i[attr] = _twips_to_pt(v)
        if i:
            out["indent"] = i
    outline = ppr.find("w:outlineLvl", NS)
    if outline is not None and outline.get(_q("val")) is not None:
        try:
            out["outline_level"] = int(outline.get(_q("val"), "0"))
        except ValueError:
            pass
    return out


def _summarize_run(rpr: dict[str, Any]) -> str:
    bits: list[str] = []
    fonts = rpr.get("fonts") or {}
    if fonts.get("eastAsia"):
        bits.append(fonts["eastAsia"])
    if fonts.get("ascii") and fonts["ascii"] != fonts.get("eastAsia"):
        bits.append(fonts["ascii"])
    if "size_pt" in rpr:
        name = _chinese_size_name(rpr["size_pt"])
        bits.append(f"{name}({rpr['size_pt']}磅)" if name else f"{rpr['size_pt']}磅")
    if rpr.get("bold"):
        bits.append("粗")
    if rpr.get("italic"):
        bits.append("斜")
    if rpr.get("color"):
        bits.append(f"#{rpr['color']}")
    return " ".join(bits)


_CHINESE_SIZE: list[tuple[float, str]] = [
    (42, "初号"), (36, "小初"), (26, "一号"), (24, "小一"),
    (22, "二号"), (18, "小二"), (16, "三号"), (15, "小三"),
    (14, "四号"), (12, "小四"), (10.5, "五号"), (9, "小五"),
    (7.5, "六号"), (6.5, "小六"), (5.5, "七号"), (5, "八号"),
]


def _chinese_size_name(pt: float | None) -> str | None:
    if pt is None:
        return None
    for v, name in _CHINESE_SIZE:
        if abs(pt - v) < 0.26:
            return name
    return None


def _summarize_paragraph(ppr: dict[str, Any]) -> str:
    bits: list[str] = []
    align = ppr.get("align")
    if align:
        bits.append({"left": "左", "right": "右", "center": "中", "both": "两端", "distribute": "分散"}.get(align, align))
    sp = ppr.get("spacing") or {}
    if "line_multi" in sp:
        bits.append(f"行距×{sp['line_multi']}")
    elif "line_pt" in sp:
        bits.append(f"行距{sp['line_pt']}磅({sp.get('line_rule', '')})")
    ind = ppr.get("indent") or {}
    if "firstLineChars" in ind:
        bits.append(f"首行{ind['firstLineChars']}字符")
    elif "firstLine" in ind:
        bits.append(f"首行{ind['firstLine']}磅")
    if "hangingChars" in ind:
        bits.append(f"悬挂{ind['hangingChars']}字符")
    return " ".join(bits)


def extract_styles(docx: Path) -> list[dict[str, Any]]:
    with zipfile.ZipFile(docx, "r") as z:
        with z.open("word/styles.xml") as f:
            xml_bytes = f.read()
    root = ET.fromstring(xml_bytes)
    styles: list[dict[str, Any]] = []
    for s in root.findall("w:style", NS):
        style_id = s.get(_q("styleId"), "")
        if not style_id:
            continue
        stype = s.get(_q("type"), "")
        is_default = s.get(_q("default"), "0") == "1"
        is_custom = s.get(_q("customStyle"), "0") == "1"
        name = _val(s.find("w:name", NS))
        based_on = _val(s.find("w:basedOn", NS))
        next_style = _val(s.find("w:next", NS))
        link = _val(s.find("w:link", NS))
        ui_priority = _val(s.find("w:uiPriority", NS))
        q_format = s.find("w:qFormat", NS) is not None
        hidden = s.find("w:hidden", NS) is not None or s.find("w:semiHidden", NS) is not None
        run_props = _parse_rpr(s.find("w:rPr", NS))
        para_props = _parse_ppr(s.find("w:pPr", NS))
        styles.append({
            "styleId": style_id,
            "name": name or style_id,
            "type": stype,
            "isDefault": is_default,
            "isCustom": is_custom,
            "basedOn": based_on,
            "next": next_style,
            "link": link,
            "uiPriority": int(ui_priority) if ui_priority.isdigit() else None,
            "qFormat": q_format,
            "hidden": hidden,
            "run": run_props,
            "paragraph": para_props,
            "runSummary": _summarize_run(run_props),
            "paragraphSummary": _summarize_paragraph(para_props),
        })
    styles.sort(key=lambda x: (
        {"paragraph": 0, "character": 1, "table": 2, "numbering": 3}.get(x["type"], 9),
        9999 if x["uiPriority"] is None else x["uiPriority"],
        x["styleId"].lower(),
    ))
    return styles


def resolve_docx(args: argparse.Namespace) -> Path:
    if args.docx:
        p = Path(args.docx)
        if not p.is_absolute():
            p = (Path.cwd() / p).resolve()
        return p
    if not args.template:
        raise SystemExit("必须指定 --template 或 --docx")
    from build import load_config, resolve_template  # noqa: E402
    cfg = load_config()
    template = resolve_template(cfg, args.template)
    return ROOT / template["reference_doc"]


def main() -> int:
    ap = argparse.ArgumentParser(description="枚举 reference.docx 的样式")
    ap.add_argument("-t", "--template", help="模板 id（从 config/templates.json 解析 reference.docx）")
    ap.add_argument("--docx", help="直接指定 docx 路径（与 -t 二选一）")
    ap.add_argument("--json", action="store_true", help="输出 JSON（默认人类可读）")
    args = ap.parse_args()

    docx = resolve_docx(args)
    if not docx.is_file():
        raise SystemExit(f"reference.docx 不存在: {docx}")

    styles = extract_styles(docx)

    if args.json:
        json.dump({"docx": str(docx.relative_to(ROOT) if docx.is_relative_to(ROOT) else docx),
                   "count": len(styles), "styles": styles},
                  sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0

    print(f"reference: {docx}")
    print(f"共 {len(styles)} 个样式\n")
    type_label = {"paragraph": "段落", "character": "字符", "table": "表格", "numbering": "编号"}
    for s in styles:
        flags = []
        if s["isDefault"]:
            flags.append("默认")
        if s["isCustom"]:
            flags.append("自定义")
        if s["qFormat"]:
            flags.append("Q")
        if s["hidden"]:
            flags.append("隐藏")
        flag_str = f" [{','.join(flags)}]" if flags else ""
        print(f"  {type_label.get(s['type'], s['type']):4} {s['styleId']:30} {s['name']}{flag_str}")
        if s["runSummary"] or s["paragraphSummary"]:
            print(f"       {s['paragraphSummary']}  |  {s['runSummary']}".rstrip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
