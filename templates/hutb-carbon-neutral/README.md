# 湖南工商大学 · 碳中和报告模板

GitHub 上**没有**现成的「湖南工商大学碳中和」公开 Word 模板仓库，需要在本机放入学校/学院下发的官方 `.docx`，由 Pandoc 的 `--reference-doc` 机制套用样式（页眉页脚、标题、正文、图表等）。

## 操作步骤

1. 从学院或教务处获取官方 Word 模板（含页眉页脚、样式表）。
2. 用 Word 打开，确认已设置好：
   - **样式**面板中的「标题 1–6」「正文」「图表题注」等（Pandoc 会映射 Markdown 标题到 Word 的 Heading 1–6）。
   - 页眉页脚（在模板中预设即可，导出后会保留）。
3. 另存为 **`reference.docx`**，放在本目录（与本 README 同级）。
4. 在项目根目录执行：

```powershell
python scripts/build.py -i input/你的文稿.md -t hutb-carbon-neutral
```

## 制作 / 调整 reference.docx 的要点

- 修改的是 **样式**（右键样式 → 修改），不要只改当前段落格式。
- Pandoc 常用样式名：`Heading 1`–`Heading 6`、正文、`First Paragraph`、`Source Code`、`Block Text` 等，与 [pandoc 手册](https://pandoc.org/MANUAL.html#option--reference-doc) 一致。
- 若需图片题注、行内代码等特殊样式，可沿用 `vendor/pandoc_docx_template` 中的 Lua 过滤器（已在 `scripts/build.py` 中默认启用）。

## 可选：二次开发

若官方模板还需自动填封面字段（学号、姓名等），可后续接入 [python-docx-template](https://github.com/elapouya/python-docx-template) 做变量填充；当前流程以 **MD 内容 + 样式模板** 为主。
