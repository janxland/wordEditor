# 湖南工商大学 · 共享资源（reference.docx + Lua 过滤器，被所有 hutb 模板复用）

本目录**不含 styles.yaml**，仅存放被多个 hutb 模板共享的 `reference.docx` 与 Lua 过滤器。样式 DSL 在各模板自己的 `templates/hutb-{guanke,gongke,xingce,math-modeling}/styles.yaml`。

| 文件 | 作用 |
|------|------|
| `reference.docx` | 学校官方 Word 样式母版（须自行放入） |
| `markdown-to-docx.lua` + `lua/` | Pandoc 过滤器 |
| `zhengwen-style.lua` | 段落语义 → Word custom-style |

## 首次使用

1. 从学校获取官方 Word 模板（页眉页脚、样式表完整）。
2. 另存为 **`reference.docx`**，放在本目录。
3. 导出：

```powershell
# 管科：一、 → 1.1 → 1.1.1（默认）
python scripts/build.py -i input/你的文稿.md -t hutb-guanke

# 工科：1 → 1.1 → 1.1.1
python scripts/build.py -i input/你的文稿.md -t hutb-gongke
```

## 样式调整

- **前端工作台**：编辑 `styles.yaml`，点 **在线预览**（Pandoc + OOXML 标题/引用 + 样式注入，无需 Word）。
- **命令行预览**：`python scripts/preview_styles.py -t hutb-guanke -o output/preview.docx`
- 样例稿：`preview-styles.md`（摘要/关键词/Abstract/公式/双图 CDN/参考文献≥6 条）。
- 预览图 CDN：默认 `config/preview-cdn.json`（jsDelivr）；内网可设 `WORDEDITOR_PREVIEW_CDN=https://你的CDN根路径`。
- **命令行全文导出**：改 `styles.yaml` 后 `python scripts/build.py`。

## reference.docx 维护

- 在 Word 中改**样式**（非直接改段落格式）。
- Pandoc 映射：`Heading 1`–`6`、正文、以及 Lua 打的 custom-style（`文章的正文`、`Abstract`、`参考文献` 等）。

## Lua 维护说明

`markdown-to-docx.lua` 与 `lua/` 三文件逻辑参考 [Achuan-2/pandoc_docx_template](https://github.com/Achuan-2/pandoc_docx_template)，在本目录独立拷贝维护，**不依赖** 仓库 `vendor/`。
