# wordEditor

湖南工商大学碳中和论文：**Markdown → Word**（Pandoc + 学校 `reference.docx` + OOXML 后处理 + 样式 DSL）。

## 环境

- [Pandoc](https://pandoc.org/installing.html) ≥ 2.13（`winget install --id JohnMacFarlane.Pandoc`）
- Python 3：`pip install -r requirements.txt`
- **无需 Microsoft Word**（标题/引用/样式均为纯 OOXML 脚本）

## 一键导出

```powershell
# 默认：input/carbon-neutral-renewable.md → output/<名>-hutb-guanke.docx
python scripts/build.py

# 工科编号（1 / 1.1 / 1.1.1）
python scripts/build.py -t hutb-gongke

# 指定文稿
python scripts/build.py -i input/你的论文.md

# 仅 Pandoc（跳过后处理，调试）
python scripts/build.py --no-postprocess
```

首次使用请将学校官方 Word 另存为 `templates/hutb-carbon-neutral/reference.docx`，详见 [templates/hutb-carbon-neutral/README.md](templates/hutb-carbon-neutral/README.md)。

## 可视化编辑（可选）

```powershell
cd apps/wordEditor-frontend
pnpm install
pnpm dev
```

工作台可编辑 `styles.yaml`；导出页与 CLI 共用 `scripts/build.py`。

## 项目结构

```
config/templates.json           # 模板注册（hutb-gongke 工科 / hutb-guanke 管科）
config/preview-cdn.json         # 样式预览图片 CDN
templates/hutb-carbon-neutral/  # reference.docx、Lua、styles.yaml
scripts/build.py                # 主入口
scripts/postprocess_document.py # 标题/引用（OOXML）
scripts/postprocess_styles.py   # styles.yaml 注入
scripts/preview_styles.py       # 工作台样式预览
input/                          # 示例 Markdown
output/                         # 生成 docx（git 忽略）
docs/                           # DSL 与 Markdown 约定
```

## Markdown 约定

见 [docs/markdown-conventions.md](docs/markdown-conventions.md)。

## 许可证

模板内 Lua 参考 [Achuan-2/pandoc_docx_template](https://github.com/Achuan-2/pandoc_docx_template)，在 `templates/hutb-carbon-neutral/` 独立维护。
