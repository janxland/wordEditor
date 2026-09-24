/** 运行状态端点：GET /、/api/health、/api/tools。 */
import type { FastifyInstance } from 'fastify';

import { findPandoc, resolvePort, which } from '../../config.js';
import type { AppContext } from '../context.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/', async () => ({
    ok: true,
    service: 'api-node',
    port: resolvePort(),
    hint: 'pnpm dev  (services/api-node)',
  }));

  app.get('/api/health', async () => ({ ok: true, service: 'api-node', repo: ctx.repoRoot }));

  /** 与 api-python 同构：python 项反映「备用引擎」是否可用，Node 引擎本身不依赖它。 */
  app.get('/api/tools', async () => {
    const pandoc = findPandoc(ctx.repoRoot);
    const python = process.env.WORDEDITOR_PYTHON || which('python3') || which('python');
    return {
      pandoc: {
        ok: Boolean(pandoc),
        path: pandoc,
        hint: pandoc ? null : 'brew install pandoc',
      },
      python: {
        ok: Boolean(python),
        path: python ?? null,
        hint: python ? null : '仅备用引擎需要，Node 主链路不依赖 Python',
      },
    };
  });
}
