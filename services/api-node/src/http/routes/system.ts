/** 运行状态与接口自述端点：GET /、/api/health、/api/tools、/openapi.json、/docs。 */
import type { FastifyInstance } from 'fastify';

import { findPandoc, resolvePort, which } from '../../config.js';
import type { AppContext } from '../context.js';
import { contractFile, openapiBytes } from '../contract.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  // 桌面端（WORDEDITOR_WEB_DIR）会把前端页面挂到 /，这里不再抢注根路径
  if (!process.env.WORDEDITOR_WEB_DIR) {
    app.get('/', async () => ({
      ok: true,
      service: 'api-node',
      port: resolvePort(),
      hint: 'pnpm dev  (services/api-node)',
      openapi: '/openapi.json',
    }));
  }

  /**
   * 机器可读的接口契约：与 api-python 逐字节同发同一份 contracts/openapi.json。
   * Agent 只需要这一个地址就能拿到全部端点、请求体 schema、错误文案与 curl 样例。
   */
  app.get('/openapi.json', async (_req, reply) =>
    reply.type('application/json').send(openapiBytes(ctx.repoRoot)),
  );

  app.get('/docs', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(contractFile(ctx.repoRoot, 'api-docs.html')),
  );

  app.get('/api/health', async () => ({ ok: true, service: 'api-node', repo: ctx.repoRoot }));

  /** 与 api-python 同构：python 项反映「备用引擎」是否可用，Node 引擎本身不依赖它。 */
  app.get('/api/tools', async () => {
    const pandoc = findPandoc(ctx.repoRoot);
    const python = process.env.WORDEDITOR_PYTHON || which('python3') || which('python') || null;
    return {
      pandoc: {
        ok: Boolean(pandoc),
        path: pandoc ?? null,
        hint: pandoc
          ? null
          : process.platform === 'win32'
            ? 'winget install --id JohnMacFarlane.Pandoc'
            : 'brew install pandoc',
      },
      python: { ok: Boolean(python), path: python },
    };
  });
}
