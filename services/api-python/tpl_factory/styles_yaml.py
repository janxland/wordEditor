"""styles.yaml DSL 渲染：spec → postprocess_styles 可消费的样式文件。"""
import json
from pathlib import Path

from .reference import NUMBERING_PRESETS

def _yaml_para(p: dict) -> list[str]:
    """custom_styles 项下的 paragraph 子块（相对 `- id:` 缩进 4 / 属性 6）。"""
    out = ["    paragraph:"]
    for key in ("align", "line_spacing", "first_line_chars", "first_line_dxa",
                "spacing_before_dxa", "spacing_after_dxa"):
        if key in p:
            out.append(f"      {key}: {json.dumps(p[key], ensure_ascii=False)}")
    if p.get("indent_clear"):
        out.append("      indent_clear: true")
    if p.get("word_wrap_break_latin", True):
        out.append("      word_wrap_break_latin: true")
    return out

def _yaml_run(r: dict) -> list[str]:
    out = ["    run:"]
    for key in ("cjk_font", "latin_font", "size_half_pt", "size_cs_half_pt", "bold"):
        if key in r:
            out.append(f"      {key}: {json.dumps(r[key], ensure_ascii=False)}")
    return out

def render_styles_yaml(spec: dict, out_path: Path) -> Path:
    b = spec["body"]
    lines = [
        "# 由 template_factory.py 从 spec.yaml 生成，请勿手改（改 spec 后重跑）。",
        'extends: "../_shared/hutb-base.yaml"',
        "template:",
        f'  id: "{spec["id"]}"',
        f'  name: "{spec["name"]}"',
        'default_list_style: "DecimalList"',
    ]
    # 摘要 / Abstract / 关键词段落用哪个样式。默认英文摘要沿用 ae（文章的正文），
    # 模板若要求「ABSTRACT 四号 TNR」则指到独立样式上（双引擎都会读这一段）。
    if spec.get("abstract_styles"):
        lines.append("abstract:")
        lines += [f'  {k}: "{v}"' for k, v in spec["abstract_styles"].items()]
    lines += [
        "use_list_styles:",
        '  - id: "DecimalList"',
        '  - id: "BulletList"',
        '  - id: "ParenDecimalList"',
        '  - id: "CircledList"',
        '  - id: "ChineseList"',
        "overrides:",
        "  - match:",
        '      kind: "body"',
        "    word_wrap_break_latin: true",
    ]
    # 章节标题：一级前分页（封面之后正文另起一页）
    for lvl, h in enumerate(spec.get("headings", []), start=1):
        lines += ["  - match:", f'      id: "{lvl}"', "    paragraph:",
                  "      word_wrap_break_latin: true", "      clear_indent: true"]
        if lvl == 1 and h.get("page_break_before"):
            lines.append("      page_break_before: true")
        if h.get("paragraph"):
            lines += [f"      {k}: {json.dumps(v, ensure_ascii=False)}"
                      for k, v in h["paragraph"].items() if k in
                      ("line_spacing", "first_line_chars", "first_line_dxa",
                       "spacing_before_dxa", "spacing_after_dxa", "align")]
        lines += ["    run:"]
        lines += [f"      {k}: {json.dumps(v, ensure_ascii=False)}"
                  for k, v in h.get("run", {}).items()
                  if k in ("cjk_font", "latin_font", "size_half_pt", "size_cs_half_pt", "bold")]

    # 自定义样式
    lines += ["custom_styles:", "  - id: \"ae\"", '    name: "文章的正文"', '    based_on: "a"']
    lines += _yaml_para(b["paragraph"])
    lines += _yaml_run(b["run"])
    for st in spec.get("extra_styles", []):
        lines += [f'  - id: "{st["id"]}"', f'    name: "{st["name"]}"', '    based_on: "a"']
        if st.get("paragraph"):
            lines += _yaml_para(st["paragraph"])
        if st.get("run"):
            lines += _yaml_run(st["run"])

    lines += ["fonts:", f'  latin: "{spec["fonts"]["latin"]}"']
    if spec["fonts"].get("cjk"):
        lines.append(f'  cjk: "{spec["fonts"]["cjk"]}"')

    # 多级编号
    preset = NUMBERING_PRESETS.get(spec.get("numbering", "guanke"))
    if preset:
        lines += ["multilevel_list:", "  num_id: 2", "  levels:"]
        for lvl, h in enumerate(spec.get("headings", []), start=1):
            cfg = preset["levels"][lvl - 1]
            hr, hp = h.get("run", {}), h.get("paragraph", {})
            lines += [
                f"    - ilvl: {lvl - 1}",
                f'      heading_style: "{lvl}"',
                f'      num_fmt: "{cfg["fmt"]}"',
                f'      lvl_text: "{cfg["text"]}"',
                f'      suff: "{cfg["suff"]}"',
                "      start: 1",
                "      run:",
            ]
            lines += [f'        {k}: {json.dumps(v, ensure_ascii=False)}'
                      for k, v in hr.items()
                      if k in ("cjk_font", "size_half_pt", "size_cs_half_pt", "bold")]
            lines += ["      paragraph:", f'        align: "{hp.get("align", "left")}"']
            if "line_spacing" in hp:
                lines.append(f'        line_spacing: {json.dumps(hp["line_spacing"], ensure_ascii=False)}')
            lines += [f'        first_line_chars: {hp.get("first_line_chars", 0)}',
                      "        spacing_before_dxa: 0", "        spacing_after_dxa: 0"]

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path

