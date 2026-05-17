# 模板样式 DSL 规范

> 适用于本仓库 `scripts/postprocess_styles.py`。每个 Word 模板在自己目录下放一份 `styles.yaml`，由 `build.py` 在 VBA 后处理之后自动加载并改写 `word/styles.xml`。

## 1. 单位与术语

| 字段 | 单位 | 例子 | 说明 |
|---|---|---|---|
| `size_half_pt` | 半磅 | 21 = 小四(10.5pt)、24 = 小三(12pt)、28 = 小二(14pt) | OOXML `w:sz w:val=` 的原生单位 |
| `spacing_before_dxa` / `spacing_after_dxa` | dxa = 1/20 pt | 240 = 一行(12pt)、120 = 半行 | `w:spacing before/after` |
| `line_spacing` | enum 或半磅 | `single` / `1.5` / `double` / `360` | 单倍=240，1.5=360，双倍=480 |
| `*_indent_chars` | 中文字符 | 2 = 两字符 | 自动换算为 `firstLineChars=200, firstLine=420` |
| `align` | enum | `left` / `center` / `right` / `both` / `distribute` | `w:jc w:val=` |

## 2. 顶层结构

```yaml
template:
  id: <模板 id，与 config/templates.json 一致>
  name: <显示名>

fonts:
  latin: Times New Roman    # 全局西文字体，可在样式里写 latin_font: inherit 引用
  cjk: 宋体                 # 全局中文字体（null = 不动模板默认）

overrides:                  # 覆盖已有样式（按 match 选择）
  - match: { kind: heading }
    word_wrap_break_latin: true
    clear_indent: true
    latin_font: inherit

custom_styles:              # 新增 / 重写自定义样式（按 name 匹配，缺失则建）
  - id: Cankaowenxian
    name: 参考文献
    based_on: a
    paragraph: { ... }
    run:       { ... }

semantics: { ... }          # 仅作文档，与 Lua filter 对照
headings:   [ ... ]         # 仅作文档，与 VBA 宏对照
```

## 3. `match` 选择器

任选其一或组合：

| 字段 | 含义 |
|---|---|
| `id` | 精确匹配 `w:styleId` |
| `name` | 精确匹配 `<w:name w:val>` |
| `name_regex` | 正则匹配 name（小写化后） |
| `kind` | `heading`（Heading 1–5 / 标题 1–5）或 `body`（Normal / 文章的正文） |

## 4. `overrides` / `custom_styles` 共享字段

### paragraph

| 字段 | 类型 | 作用 | 生成 OOXML |
|---|---|---|---|
| `word_wrap_break_latin` | bool | 允许西文中间断行（避免两端对齐时大空格） | `<w:wordWrap w:val="0"/>` |
| `clear_indent` / `indent_clear` | bool | 删除 `<w:ind>` 与 `<w:tabs>` | — |
| `align` | enum | 对齐 | `<w:jc>` |
| `line_spacing` | enum/num | 行距 | `<w:spacing line= lineRule=>` |
| `spacing_before_dxa` / `spacing_after_dxa` | int | 段前/段后 | `<w:spacing before= after=>` |
| `hanging_indent_chars` | int | 悬挂缩进（参考文献 `[1] ` 对齐） | `<w:ind leftChars hangingChars hanging firstLine>` |
| `first_line_chars` | int | 首行缩进 | `<w:ind firstLineChars firstLine>` |

### run

| 字段 | 类型 | 作用 |
|---|---|---|
| `latin_font` | str / `inherit` | 设 `rFonts ascii hAnsi cs` |
| `cjk_font`   | str / `inherit` | 设 `rFonts eastAsia` |
| `size_half_pt` | int | 字号 `sz / szCs` |

## 5. `custom_styles` 行为细节

执行顺序：
1. 按 `name` 查找已有样式（Pandoc 遇到 `<div custom-style="X">` 会自动生成空壳样式）
2. 命中：清空其 `pPr` 与 `rPr`，确保有 `<w:qFormat/>`，再按 DSL 重建
3. 未命中且 `id` 也不存在：以指定 `id` + `customStyle=1` + `basedOn` 新建

## 6. `semantics` / `headings`（说明性）

这两节当前**仅作文档**用途——真正生效的是 `templates/<id>/zhengwen-style.lua`（语义映射）和 `macros/ApplyHeadingsAndRemoveNumbering.bas`（标题识别）。当未来抽取 Lua / 宏成通用引擎时，可改为驱动来源。

## 7. 示例

完整示例见 [templates/hutb-carbon-neutral/styles.yaml](../templates/hutb-carbon-neutral/styles.yaml)。

## 8. 调用

```powershell
py scripts/postprocess_styles.py output.docx --styles templates/<id>/styles.yaml
```

由 `build.py` 自动调用：当 `config/templates.json` 的模板项含 `styles_yaml` 字段时即生效；未提供则回退内置默认 DSL（与 hutb-carbon-neutral 等价）。
