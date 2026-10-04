# wordEditor

湖南工商大学论文导出工具：将 Markdown 转为符合模板规范的 Word（Pandoc + reference.docx + OOXML 后处理 + 样式 DSL）。

## 环境

- Pandoc >= 2.13（Windows 可用 `winget install --id JohnMacFarlane.Pandoc`）
- Python 3（`pip install -r requirements.txt`）
- 无需安装 Microsoft Word（标题、引用、样式处理均由 Python + OOXML 完成）

## 一键导出

```bash
# 默认模板 hutb-guanke，产物回写 MD 所在目录
./bin/we build 报告.md

# 工科模板
./bin/we build 报告.md -t hutb-gongke

# 工作区目录（自动取其中唯一 md，连同 images/ 一起打包）
./bin/we build ~/Downloads/某调查

# 仅 Pandoc（跳过后处理，便于调试）
./bin/we build 报告.md --no-postprocess

# 设修改密码（明文不进命令行）+ 写元数据与页眉页脚
WPW=xxx ./bin/we build 报告.md --password-env WPW --author "你的名字" --header-text "湖南工商大学"
```

`bin/we` 是唯一 CLI 入口（build / templates / analyze / clone / verify / extract / ref-styles），
`we --help` 看全量。stdout 只输出结果（可 `jq`），进度走 stderr。

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
  -> services/api-python/direct.py（bin/we 与 MCP 共用）
  -> services/api-python/pipeline/*
```

说明：Node 与 Python 计划使用同一个端口 8787，切换时请先停止当前后端，再启动另一套。

## 核心目录

- `config/templates.json`：模板注册
- `templates/hutb-shared/`：共享 reference 与 Lua
- `templates/_shared/`：共享样式 DSL 与列表样式库
- `templates/hutb-*/styles.yaml`：各模板样式覆盖
- `services/api-python/app.py`：FastAPI 入口
- `bin/we`：唯一 CLI 入口（build/templates/analyze/clone/verify/extract/ref-styles）
- `services/api-python/pipeline/`：构建与后处理实现
- `apps/wordEditor-frontend/`：前端工作台
- `docs/`：Markdown 规范与 DSL 文档

更易读的目录导航见 `docs/project-structure.md`。

## 单一入口：CLI / MCP / HTTP 三条路，同一个内核

```
we build    md/目录 → docx          CI 脚本
we analyze  只读解剖 docx（不写文件）  Agent
we clone    反向复刻 docx 为模板      Agent
we verify   机械验收（0 退出码 = 全通过） CI 卡口
```

MCP（`services/api-python/mcp_server.py`，stdio，9 个工具）暴露同一批能力，
任何支持 MCP 的客户端（WorkBuddy / ZCode / Claude Code / Cursor…）装上即用；
HTTP 走 `/api`（契约 `contracts/openapi.json`）。三条路等价，不是三套实现。

### 接入一所新学校

```bash
we analyze "某大学论文格式规范.docx" --text      # 只读：页面/正文逐段实测/封面尾表边界
we clone   "某大学论文格式规范.docx" my-univ --name "某大学 · 学位论文" --marker 摘要
# ok=true 即模板可用（0 FAIL 才结案）；此后 we build <md> -t my-univ
```

封面与尾页评分表**整页字节级搬运**，不复刻不重画；正文/标题按源实测自动落进 spec。
只有评分项分值这类需要判断的语义才需人工补（`advisory` 会点名提示）。

## 授权

专有许可，见 [`LICENSE`](LICENSE)。源码不公开传播；允许本机使用与本单位内部部署。
防技术盗窃的上线检查单见 [`docs/ip-protection-checklist.md`](docs/ip-protection-checklist.md)。

## 文档

- Markdown 规范：`docs/markdown-conventions.md`
- 样式 DSL：`docs/styles-dsl.md`
