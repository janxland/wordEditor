# Markdown → Word（带模板）的实现原理

> 本文记录 `wordEditor` 这套「Markdown 一键生成符合 Word 模板规范的论文 docx」管线的设计与实现要点。适合写博客或团队内部分享。

## 一、问题

学校 / 期刊给的 Word 模板里有：

- 自定义页眉页脚（带 `第 N 页/共 M 页` 域）
- 自定义章节样式（标题字体字号、悬挂缩进的参考文献、居中图与图注）
- 中文章节编号约定（中文「一、二、…」一级 + 数字 1.1 / 1.1.1 / 1.1.1.1 多级）
- 上标 `[1][2]` 形式的参考文献交叉引用，且必须真正的 **REF 域**而不是纯文本
- 行内 `\(...\)` 与 `$...$` 形式的公式，必须落到 Word **原生 OMML**（Alt + = 可编辑）

直接 `pandoc -o out.docx --reference-doc=template.docx` 完全不行，因为：

1. Pandoc 把图片 alt 直接当作 caption，会带 `Figure 1:` 这种英文前缀
2. 标题样式由 Markdown 的 `#` 数量决定，没法处理「中文章节符号一、」
3. `[1]` 直接成普通字符，不会生成真正书签 / REF 域
4. 章节段落保留模板原始首行缩进、对齐时英文产生大空格
5. 参考文献条目、图、图注没有专门的命名样式，只能挂"Normal"

## 二、管线总览

```
input.md ──► Pandoc(MD → HTML, --mathjax) ──► HTML ──► Pandoc(HTML → DOCX, --reference-doc, Lua filters)
                                                                  │
                                                                  ▼
                                                            初版 .docx
                                                                  │
                                                                  ▼
                                            VBA 后处理 (pywin32 + Word COM)
                                              · 标题层级识别与归一
                                              · [N] → 上标 + REF 域
                                              · （可选）公式宏
                                                                  │
                                                                  ▼
                                            OOXML 样式后处理 (Python + zipfile + xml.etree)
                                              · 按 DSL 重写 word/styles.xml
                                                                  │
                                                                  ▼
                                                            最终 .docx
```

## 三、四个关键技术决策

### 3.1 为什么走「HTML 中转」？

`Pandoc 直接 md → docx` 会丢掉一些 HTML 习惯写法（譬如 `<a id="RefN">N</a>` 这样手写的书签锚点）。先 `md → html` 再 `html → docx`，可以把 Markdown 里的内嵌 HTML 完整保留，并由 HTML reader 解析为 Pandoc AST 中的 `Span` / `Link`，方便后续 Lua filter 识别。

**坑**：HTML 中转默认会把 `\(...\)` 当作普通文本扔掉。修复需要两端都开扩展：

```
pandoc input.md -f markdown+tex_math_single_backslash -t html --mathjax
pandoc           -f html+tex_math_dollars+tex_math_single_backslash  -o out.docx --reference-doc=...
```

`--mathjax` 让 Pandoc 在 HTML 阶段保留 `\(...\)` 形态而不是渲染为 Unicode；HTML reader 端两个扩展把它们重新识别为数学。Pandoc 的 DOCX writer 会**自动**把 `Math` AST 节点写成 OMML（`<m:oMath>`），即 Word 的原生公式格式。

**坑**：图片相对路径在 HTML 中转里要透传 —— cmd1 加 `--embed-resources --standalone` 把图片转成 data: URI 内嵌，再交给 cmd2 解出来。

### 3.2 Lua filter：在 Pandoc AST 上做语义打标

`zhengwen-style.lua` 的核心思想：**把每一类「角色不同」的段落包成带 `custom-style` 的 `Div`**。Pandoc 看到 `<div custom-style="参考文献">…</div>` 时会按这个 name 在 reference.docx 里查找同名样式，找到就挂上；没找到就建一个空壳，等我们后处理去填它的 `pPr/rPr`。

```lua
-- 简化版
function Para(el)
  if #el.content == 1 and el.content[1].t == 'Image' then
    return wrap('图', { el })
  end
  if is_bib_para(el) then                                -- 段首是 [Ref1]…
    return wrap('参考文献', { el })
  end
  return wrap('文章的正文', { el })
end
```

**坑**：HTML reader 里 `<a id="X">` 无 `href` 时是 `Span`，有 `href` 时才是 `Link`；两者都要识别。

`Figure(fig)` 里维护一个计数器自动给 caption 加 `图 N　` 前缀，并在 vendor 把 alt 丢掉的情况下回退从 `img.caption`（即 Image 的 alt）取标题文字。

### 3.3 VBA 宏：解决 Pandoc 表达不了的 Word 功能

两个不可绕过的需求：

1. **真正的 REF 域** —— `[1]` 这种交叉引用得是 Word 域，否则改 `[1]` 顺序时不能自动更新。Pandoc 没法生成 `Fields.Add(Range, wdFieldRef, "Ref1", True)`，得开 Word COM 用 VBA 干。
2. **多级标题归一** —— 用户在 MD 里写 `1.1 研究背景` 是普通段落，需要在文档里扫描这些前缀模式，识别为 Heading 2，但**保留前缀文字**。

实现走 `pywin32` 打开 Word（必须 `Visible=True`，否则 `Selection.Select` 死锁），临时 `Application.Options.Pagination = False`（避免每次 Field.Add 触发整文档重排），从尾向前遍历段落，命中正则就 `p.Style = ActiveDocument.Styles(-2)`（用 `wdStyleHeading1=-2` 这种内置常量跨语言安全），再清掉残留缩进与列表标记。

引用宏会先扫一遍 `<a id="RefN">` 转成 Word 书签，再把每一处 `[N]` 替换为 `REF RefN \h` 域并设置成上标。

**坑**：导入的 `.bas` 文件必须 mbcs/GBK 编码，UTF-8 + BOM 会让 VBA 静默拒绝；保存前要把宏 Project 组件 Remove 掉，否则保存的 .docx 会带「找不到宏」提示。

### 3.4 OOXML 后处理：解决"样式还没生效就被锁死"的问题

Pandoc + Lua 已经把段落挂到了 `参考文献` 这类自定义样式上，但 reference.docx 里其实没有真正定义这些样式（Pandoc 只是建了个空壳）。我们直接用 `zipfile` 打开 docx，重写 `word/styles.xml`：

```python
existing = find_style_by_name(root, "参考文献")
if existing is not None:
    # 清空 pPr / rPr 重建
    for tag in ("w:pPr", "w:rPr"):
        el = existing.find(tag, NS)
        if el is not None: existing.remove(el)
    apply_paragraph(existing, dsl["paragraph"])
    apply_run(existing, dsl["run"], dsl["fonts"])
```

把硬编码的格式规则抽出成 **YAML DSL**（[docs/styles-dsl.md](styles-dsl.md)），未来再加一个学校的模板只要写一份 `styles.yaml` 就行。

### 3.5 顺序很关键

VBA 后处理**必须早于** OOXML 样式后处理：

- VBA 跑完 `Document.Save` 后，Word 会重新整理 `styles.xml`（顺手"修正"我们注入的某些字段），后处理才有意义。
- 反过来如果先改 styles.xml，Word 打开时可能"治好"我们做的改动。

## 四、踩过的坑（按时间顺序）

| 现象 | 根因 | 修复 |
|---|---|---|
| `Permission denied` 写不进 output | Windows Search Indexer 给 docx 加锁 | 用唯一文件名或重启系统 |
| VBA 跑完 Word 弹「未找到工程或库」 | `.bas` 文件 UTF-8 BOM | 写 `.bas` 强制 `mbcs` 编码 |
| `Selection.Select` 一直挂起 | Word 进程 `Visible=False` 时 Selection 模型阻塞 | 后处理强制 `Visible=True` |
| 标题失去缩进但前面多个 `▸` 列表标记 | 模板原有 `<w:numPr>` 残留 | `p.Range.ListFormat.RemoveNumbers` |
| 中文样式名 `Styles("标题 2")` 在英文 Word 上找不到 | 中英文版样式 name 不同 | 用 `Styles(-2)`（`wdStyleHeading1`）跨语言安全 |
| `is_bib_para` 永远返回 false | HTML reader 把 `<a id="">` 解析成 `Span` 而不是 `Link` | 同时识别两种 |
| 公式整体丢失 | HTML reader 默认不开 `tex_math_single_backslash` | MD 阶段和 HTML 阶段都加扩展 |
| 西文两端对齐有巨大空白 | 默认 `wordWrap=1`（不允许单词中间断行） | 给 Normal / 文章的正文 / Heading 注入 `<w:wordWrap w:val="0"/>` |

## 五、目录与流程对应

| 步骤 | 文件 |
|---|---|
| 入口 / 模板调度 | [scripts/build.py](../scripts/build.py) |
| 模板清单 | [config/templates.json](../config/templates.json) |
| 模板样式 DSL | [templates/`<id>`/styles.yaml](../templates/hutb-carbon-neutral/styles.yaml) |
| 模板 Lua filter（语义打标） | [templates/`<id>`/zhengwen-style.lua](../templates/hutb-carbon-neutral/zhengwen-style.lua) |
| VBA 宏 | [macros/](../macros/) |
| pywin32 后处理（导宏 + 运行 + 保存 + 移除宏） | [scripts/postprocess_word.py](../scripts/postprocess_word.py) |
| OOXML 样式注入 | [scripts/postprocess_styles.py](../scripts/postprocess_styles.py) |
| 测试图片生成 | [scripts/generate_test_images.py](../scripts/generate_test_images.py) |
| 输出验证 | [scripts/verify_output.py](../scripts/verify_output.py) |

## 六、未来工作

- 把 Lua 里的语义检测规则也驱动到 `styles.yaml` 的 `semantics` 段，做到"一份 DSL 即一套模板"
- 把 VBA 的标题识别也 DSL 化（`headings` 段已是文档化形式）
- 提供 GUI（VS Code 扩展或 Tauri）让非技术用户增删模板
- 支持表格三线表样式 / 公式自动编号 `(N)`
