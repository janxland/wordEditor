# 项目结构导航

目标：降低仓库一级目录阅读成本，明确 apps / services 分层。

## 一级目录职责

- `apps/`：前端应用（UI、交互、页面与状态）
- `services/`：后端服务
- `templates/`：模板与样式 DSL
- `config/`：全局配置（模板注册等）
- `docs/`：规范与功能文档
- `input/`：示例输入
- `output/`：构建输出
- `macros/`、`legacy/`：历史 VBA 与兼容资源

## 服务分层

- `services/api-node`：主后端（纯 Node，提供前端全部 `/api/*`）
- `services/api-python`：占位目录（不承载 Python 运行职责）
- `services/api-python/pipeline`：离线 Python 管线（构建与 OOXML 后处理）

## 前后端开发路径

1. 启动 Node API：`services/api-node`
2. 启动前端：`apps/wordEditor-frontend`
3. 前端通过 `/api` 代理调用 Node API

## 推荐阅读顺序（新同学）

1. `README.md`
2. `docs/project-structure.md`
3. `config/templates.json`
4. `services/api-node/src/main.ts`
5. `apps/wordEditor-frontend/src/kernel/pipeline/*`
