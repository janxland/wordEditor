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

