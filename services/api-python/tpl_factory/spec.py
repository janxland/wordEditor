"""spec.yaml 读写与骨架模板（schema 校验 + 相对路径解析）。"""
from pathlib import Path

import yaml

SPEC_SCHEMA = "wordeditor-template-spec/v1"

SPEC_SCHEMA = "wordeditor-template-spec/v1"

def load_spec(path: str | Path) -> dict:
    spec_path = Path(path).resolve()
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    if spec.get("schema") != SPEC_SCHEMA:
        raise SystemExit(f"spec.schema 必须为 {SPEC_SCHEMA}，当前为 {spec.get('schema')!r}")
    for key in ("id", "name", "page", "fonts", "cover", "tail"):
        if key not in spec:
            raise SystemExit(f"spec 缺少必填字段: {key}")
    # source_docx 相对路径按 spec 所在目录解析（模板目录自包含，便于重跑/入库）
    src = Path(spec["source_docx"]).expanduser()
    if not src.is_absolute():
        src = spec_path.parent / src
    spec["source_docx"] = str(src)
    spec["_spec_path"] = str(spec_path)
    return spec

_SPEC_TEMPLATE = """\
schema: wordeditor-template-spec/v1

# ===================================================================
# @NAME@
# 反向复刻自 @SRC_NAME@（source.docx，自包含）。
# 格式数值一律以模板正文里的**文字描述**为准（铁律二），不要照抄示范段 OOXML。
# 待填项已标 TODO：跑 `template_factory.py text` 拿全文后逐条映射（SKILL §4 映射字典）。
# ===================================================================
id: @TID@
name: "@NAME@"

numbering: guanke          # 一、→（一）→①（工科用 gongke：1 → 1.1）
standalone: true
three_line_tables: true

# 摘要段落样式（DSL abstract 块，双引擎都会读）。模板没有英文摘要时可整段删除。
abstract_styles:
  abstract_style_id: ZhaiYao
  abstract_title_style_id: ZhaiYaoTitle
  en_abstract_style_id: Abstract
  en_abstract_title_style_id: AbstractTitle
  keywords_style_id: KeyWordsZh
  en_keywords_style_id: Keywords

source_docx: "source.docx"   # 相对本 spec 所在目录

# ------------------------------------------------------------------ 页面（已按源 docx 实测填充）
page:
  width_twips: @PAGE_W@
  height_twips: @PAGE_H@
  margin:
    top: @MAR_TOP@
    bottom: @MAR_BOTTOM@
    left: @MAR_LEFT@
    right: @MAR_RIGHT@
  header_twips: @HEADER@
  footer_twips: @FOOTER@
  cols_space: 425
  doc_grid:
    type: lines
    line_pitch: 312

fonts:
  latin: "Times New Roman"
  cjk: "宋体"

# ------------------------------------------------------------------ 正文（默认 = HUTB 基线：小四 24 / 固定 24 磅 / 缩进 2 字符）
# TODO: 对照模板文字描述改字号/字体；2 字符缩进必须显式 first_line_dxa: 560
body:
  paragraph:
    align: both
    line_spacing: "24pt"
    first_line_chars: 2
    first_line_dxa: 560
    spacing_before_dxa: 0
    spacing_after_dxa: 0
    word_wrap_break_latin: true
  run:
    cjk_font: "宋体"
    latin_font: "Times New Roman"
    size_half_pt: 24
    size_cs_half_pt: 24

# ------------------------------------------------------------------ 标题（一级黑体四号 = HUTB 默认；二~四级照基线）
headings:
  - level: 1
    page_break_before: false
    paragraph:
      align: left
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      spacing_before_dxa: 0
      spacing_after_dxa: 0
    run:
      cjk_font: "黑体"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
      bold: true
  - level: 2
    paragraph:
      align: left
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      spacing_before_dxa: 0
      spacing_after_dxa: 0
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 24
      size_cs_half_pt: 24
      bold: true
  - level: 3
    paragraph:
      align: left
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      spacing_before_dxa: 0
      spacing_after_dxa: 0
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 24
      size_cs_half_pt: 24
      bold: true
  - level: 4
    paragraph:
      align: left
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      spacing_before_dxa: 0
      spacing_after_dxa: 0
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 24
      size_cs_half_pt: 24
      bold: true

# ------------------------------------------------------------------ 论文题目（TODO: 对照文字描述改字号，Title 无 DSL 覆盖入口，必须写全）
title:
  paragraph:
    align: center
    line_spacing: "24pt"
    spacing_before_dxa: 0
    spacing_after_dxa: 0
    indent_clear: true
    word_wrap_break_latin: true
  run:
    cjk_font: "宋体"
    latin_font: "Times New Roman"
    size_half_pt: 36
    size_cs_half_pt: 36
    bold: true

# ------------------------------------------------------------------ 摘要/关键词/参考文献（TODO: 按 SKILL §4 映射，没用到就删，过度切是错）
extra_styles:
  - id: "ZhaiYaoTitle"
    name: "摘要标题"
    paragraph:
      align: both
      line_spacing: "24pt"
      indent_clear: true
      spacing_before_dxa: 0
      spacing_after_dxa: 0
      word_wrap_break_latin: true
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
      bold: true
  - id: "ZhaiYao"
    name: "摘要"
    paragraph:
      align: both
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      word_wrap_break_latin: true
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
  - id: "AbstractTitle"
    # name 必须与 pandoc 按 custom-style 生成的样式名逐字一致（无空格）。
    name: "AbstractTitle"
    paragraph:
      align: both
      line_spacing: "24pt"
      indent_clear: true
      spacing_before_dxa: 0
      spacing_after_dxa: 0
      word_wrap_break_latin: true
    run:
      cjk_font: "Times New Roman"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
      bold: true
  - id: "Abstract"
    name: "Abstract"
    paragraph:
      align: both
      line_spacing: "24pt"
      first_line_chars: 2
      first_line_dxa: 560
      word_wrap_break_latin: true
    run:
      cjk_font: "Times New Roman"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
  - id: "KeyWordsZh"
    name: "关键词"
    paragraph:
      align: both
      line_spacing: "24pt"
      first_line_chars: 0
      word_wrap_break_latin: true
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
  - id: "Keywords"
    name: "Keywords"
    paragraph:
      align: both
      line_spacing: "24pt"
      first_line_chars: 0
      word_wrap_break_latin: true
    run:
      cjk_font: "Times New Roman"
      latin_font: "Times New Roman"
      size_half_pt: 28
      size_cs_half_pt: 28
  - id: "Cankaowenxian"
    name: "参考文献"
    paragraph:
      align: both
      line_spacing: "24pt"
      indent_clear: true
      spacing_before_dxa: 0
      spacing_after_dxa: 0
      word_wrap_break_latin: true
    run:
      cjk_font: "宋体"
      latin_font: "Times New Roman"
      size_half_pt: 24
      size_cs_half_pt: 24

# ------------------------------------------------------------------ 封面（自动切片；TODO: 跑 detect 核对后填 fields 行列）
cover:
  slice: auto                # 自动探测；只有探测认错才改显式索引，如 slice: [0, 8]
  page_break: "inherited"    # 切片内自带分页段；若 detect 报 not_in_slice 则改 "injected"
  fields: []                 # TODO: 按 cover 切片里的信息表填 {key,label,row,col} / {key,label,para,default}

# ------------------------------------------------------------------ 尾页评分表（自动切片；TODO: 按表内容填 rubric）
tail:
  slice: auto
  title: "TODO 评分表标题文本"
  rubric:
    total: 100
    grade_row: "TODO 成绩行首格文本"
    remark_row: "TODO 备注行首格文本"
    signature_row: "TODO 签名行首格文本"
    groups: []               # TODO: {key,label,max,items:[{desc,score}]}，按评分表逐格转写
"""

