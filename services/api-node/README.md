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
- JSZip + xmldom + xpath (OOXML handling)
