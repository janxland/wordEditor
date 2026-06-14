# WordEditor Frontend

React 可视化管理台：Markdown 导出 Word、编辑模板 DSL / Lua。

## 启动

```powershell
cd services/api-node
pnpm install
pnpm dev

cd apps/wordEditor-frontend
pnpm install
pnpm dev
```

依赖：本机 **Pandoc**（纯 Node 后端）；无需 Python、无需 Word。

## 页面

| 路由 | 功能 |
|------|------|
| `/export` | Markdown → `build.py` → 下载 docx |
| `/` | 模板 DSL / Lua 编辑、样式在线预览 |
| `/docs` | 规范文档只读 |

## API（开发态 `/api`）

前端开发服务器通过 Vite Proxy 将 `/api` 转发到 `http://localhost:8787`（`services/api-node`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/build/stream` | SSE 流式构建 |
| POST | `/preview/styles` | 样式预览 docx |
| GET | `/build/download` | 下载 docx |
| GET | `/templates` | templates.json |
| GET/PUT | `/file?path=` | 读写仓库文本 |
| GET | `/docs?name=` | 读取 docs/*.md |
