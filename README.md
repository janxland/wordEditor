# wordEditor

Markdown 一键导出为符合多种 Word 样式模板的 `.docx`，支持页眉页脚、标题编号、列表与表格等。基于 [Pandoc](https://pandoc.org/) + 可配置的 `reference.docx` 模板库，并集成上游 [Achuan-2/pandoc_docx_template](https://github.com/Achuan-2/pandoc_docx_template)（Lua 过滤器与通用中文模板）。

## 快速开始

### 1. 安装 Pandoc

```powershell
winget install --id JohnMacFarlane.Pandoc
```

或从 [pandoc.org/installing](https://pandoc.org/installing.html) 安装。需要 **Pandoc ≥ 2.13**。

### 2. 初始化内置模板（首次）

```powershell
cd d:\janxl\workplace\Project\wordEditor
python scripts/setup_templates.py
```

### 3. 一键导出

```powershell
# 默认：input/example.md + 通用「标题编号·列表顶格」模板
python scripts/build.py

# 指定模板
python scripts/build.py -i input/example.md -t sci-heading-number

# 湖南工商大学碳中和（需先放置 templates/hutb-carbon-neutral/reference.docx）
python scripts/build.py -i input/example.md -t hutb-carbon-neutral

# 列出所有模板
python scripts/build.py --list-templates
```

也可双击或命令行运行 `scripts\build.bat` / `scripts\build.ps1`。

输出目录：`output/<文件名>-<模板id>.docx`。

## 添加自定义模板（如学校官方版式）

1. 在 `templates/<你的模板id>/` 下放入 `reference.docx`（从官方 Word 另存，保留页眉页脚与样式表）。
2. 在 `config/templates.json` 的 `templates` 数组中增加一项（学校完整版式可复制 `hutb-carbon-neutral` 并设 `standalone: true`）。
3. 执行 `python scripts/build.py -t <你的模板id> -i 你的.md`。

湖南工商大学碳中和模板说明见 [templates/hutb-carbon-neutral/README.md](templates/hutb-carbon-neutral/README.md)。

## 项目结构

```
wordEditor/
├── config/templates.json      # 模板注册表
├── input/                     # 示例与待转换 MD
├── output/                    # 生成的 docx
├── scripts/
│   ├── build.py               # 主入口
│   ├── setup_templates.py     # 从 vendor 提取内置 docx
│   ├── build.ps1 / build.bat
├── templates/
│   ├── builtin/               # 内置英文文件名模板（setup 生成）
│   └── hutb-carbon-neutral/   # 学校独立模板（standalone，含自有 Lua + styles.yaml）
└── vendor/
    └── pandoc_docx_template/  # 上游克隆（Lua + 原始 docx）
```

## 参考的开源项目

| 项目 | 用途 |
|------|------|
| [Achuan-2/pandoc_docx_template](https://github.com/Achuan-2/pandoc_docx_template) | 中文排版 reference-docx、Lua 过滤器（已克隆至 `vendor/`） |
| [ilcpm/cqu-thesis-markdown](https://github.com/ilcpm/cqu-thesis-markdown) | 高校论文 MD→Word + Python 后处理思路 |
| [Flint2004/szu-thesis-md-template](https://github.com/Flint2004/szu-thesis-md-template) | Pandoc + python-docx 后处理 |
| [elapouya/python-docx-template](https://github.com/elapouya/python-docx-template) | 封面/字段类模板填充（可扩展） |

**说明**：公开仓库中未见「湖南工商大学碳中和」专用模板，需自行放入官方 `reference.docx`；通用样式可先使用 `builtin` 下 6 套模板。

## 更新上游模板

```powershell
cd vendor/pandoc_docx_template
git pull
cd ../..
python scripts/setup_templates.py
```

## 许可证

本项目脚本与配置可自由使用；`vendor/pandoc_docx_template` 遵循其上游仓库许可。
