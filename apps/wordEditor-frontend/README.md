# WordEditor Frontend

React 可视化管理台：Markdown 导出 Word、编辑模板 DSL / Lua。

## 启动

```powershell
cd apps/wordEditor-frontend
pnpm install
pnpm dev
```

依赖：本机 **Python**、**Pandoc**（后处理为 OOXML，无需 Word）。

## 页面

| 路由 | 功能 |
|------|------|
| `/export` | Markdown → `build.py` → 下载 docx |
| `/` | 模板 DSL / Lua 编辑、样式在线预览 |
| `/docs` | 规范文档只读 |

## API（开发态 `/api`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/build/stream` | SSE 流式构建 |
| POST | `/preview/styles` | 样式预览 docx |
| GET | `/build/download` | 下载 docx |
| GET | `/templates` | templates.json |
| GET/PUT | `/file?path=` | 读写仓库文本 |
| GET | `/docs?name=` | 读取 docs/*.md |
