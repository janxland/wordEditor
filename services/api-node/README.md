# api-node

Fastify + TypeScript backend with API parity for wordEditor frontend.

## Goals

- Implement all `/api/*` endpoints used by frontend.
- Keep markdown/docx processing in Node orchestration.
- Resolve templates and workflow paths from repository root.
- Modular service architecture for future api-node expansion.

## Run

```powershell
cd services/api-node
pnpm install
pnpm dev
```

Default port: `8787`

Optional env:

- `WORDEDITOR_PORT` (default `8787`)
- `WORDEDITOR_REPO_ROOT` (auto-detected by default)
- `PANDOC` (optional explicit pandoc executable path)

## Tech Stack

- Fastify (API framework)
- TypeScript (NodeNext ESM)
- JSZip + xmldom (OOXML 部件读写，ElementTree 等价 DOM 层见 `src/pipeline/ooxml/xml.ts`)
- yaml (styles.yaml DSL)

## Parity

后端与 `services/api-python` 是同一套 `/api/*` 契约的两份实现，docx 产物要求一致。
用 `npx tsx tools/parity.ts <pandoc|stage --upto <stage>|full> -i <md> -t <template>`
逐阶段对比两条链路：XML 部件按命名空间规范化后做语义比较（Node 侧为 DOM 改写，不追求 zip 逐字节）。
两份已有产物可直接 `npx tsx tools/parity.ts docx -a <file> -b <file>`（HTTP 端点回归用）。

## 有意保留的差异

以下是核对过、决定不跟 Python 对齐的点，别再当 bug 反复修：

- `GET /api/health` 的 `service` 为 `api-node`：用来分辨当前生效的引擎。
- `GET /api/tools` 的 `python.path`：Python 侧是自身解释器，Node 侧是探测到的 `python3`（仅备用引擎需要）。
- 错误文案：Python 常给 `build failed: 1` / 带尾随换行的 stderr，Node 在同样的 `{"detail"}` / SSE `{"error"}` 结构下给可读原因（如未知模板 + 可用列表）。
- SSE `step` 事件集合一致，但顺序按真实阶段单调推进；Python 因 `build.py` stdout 块缓冲，后处理事件会先于 `模板:/输入:` 到达，不复制这个乱序。
- `PUT /api/file?path=`（空路径）：Python 试图写仓库根返回 500，Node 返回 400 `invalid path`。
- 请求体上限 `MAX_BODY_BYTES` 96 MB（超限 413）：Python 无上限，Node 保留护栏。

