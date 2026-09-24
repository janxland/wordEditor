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
