# wordEditor

湖南工商大学论文导出工具：将 Markdown 转为符合模板规范的 Word（Pandoc + reference.docx + OOXML 后处理 + 样式 DSL）。

## 环境

- Pandoc >= 2.13（Windows 可用 `winget install --id JohnMacFarlane.Pandoc`）
- Python 3（`pip install -r requirements.txt`）
- 无需安装 Microsoft Word（标题、引用、样式处理均由 Python + OOXML 完成）

## 一键导出

```powershell
# 默认：input/carbon-neutral-renewable.md -> output/<文件名>-hutb-guanke.docx
py services/api-python/run.py build

# 工科模板
py services/api-python/run.py build -t hutb-gongke

# 指定输入
py services/api-python/run.py build -i input/你的论文.md

# 仅 Pandoc（跳过后处理，便于调试）
py services/api-python/run.py build --no-postprocess
```

首次使用请将学校官方模板另存为 `templates/hutb-shared/reference.docx`。详情见 `templates/hutb-shared/README.md`。

## 前后端联调（可选）

```powershell
cd apps/wordEditor-frontend
pnpm install

# 方案 A：前端 + Python 后端（推荐，优先回归）
pnpm dev:python
pnpm dev

# 方案 B：前端 + Node 后端
pnpm dev:node
pnpm dev
```

前端开发时统一走 `/api` 代理，默认目标是 `http://localhost:8787`。

## 调用链路（收束后）

```text
apps/wordEditor-frontend
  -> /api (vite proxy)
  -> services/api-python/app.py   或   services/api-node

Python 离线能力（构建/预览/提取）
  -> services/api-python/run.py
  -> services/api-python/pipeline/*
```

说明：Node 与 Python 计划使用同一个端口 8787，切换时请先停止当前后端，再启动另一套。

## 核心目录

- `config/templates.json`：模板注册
- `templates/hutb-shared/`：共享 reference 与 Lua
- `templates/_shared/`：共享样式 DSL 与列表样式库
- `templates/hutb-*/styles.yaml`：各模板样式覆盖
- `services/api-python/app.py`：FastAPI 入口
- `services/api-python/run.py`：Python 统一 CLI 入口
- `services/api-python/pipeline/`：构建与后处理实现
- `apps/wordEditor-frontend/`：前端工作台
- `docs/`：Markdown 规范与 DSL 文档

更易读的目录导航见 `docs/project-structure.md`。

## 文档

- Markdown 规范：`docs/markdown-conventions.md`
- 样式 DSL：`docs/styles-dsl.md`
