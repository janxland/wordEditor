/** 模板端点：GET /api/templates、GET /api/templates/reference-styles。 */
import type { FastifyInstance } from 'fastify';

import { extractReferenceStyles } from '../../pipeline/reference-styles.js';
import {
  findTemplate,
  loadTemplatesConfig,
  resolveTemplate,
  withTemplateStatus,
} from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';

export function registerTemplateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/templates', async (_req, reply) => {
    const file = `${ctx.repoRoot}/config/templates.json`;
    try {
      return withTemplateStatus(ctx.repoRoot, loadTemplatesConfig(ctx.repoRoot));
    } catch (e) {
      return reply.status(500).send({ error: `config/templates.json 不可用: ${file}` });
    }
  });

  app.get('/api/templates/reference-styles', async (req, reply) => {
    const templateId = String((req.query as { template?: string }).template ?? '').trim();
    if (!templateId || !/^[\w-]+$/.test(templateId)) {
      return reply.status(400).send({ error: 'template 参数缺失或非法' });
    }

    try {
      const def = findTemplate(loadTemplatesConfig(ctx.repoRoot), templateId);
      const template = resolveTemplate(ctx.repoRoot, def);
      const styles = await extractReferenceStyles(template.referenceDoc);
      return { docx: template.referenceDoc, count: styles.length, styles };
    } catch (e) {
      return reply.status(500).send({ error: `读取 reference styles 失败: ${String(e)}` });
    }
  });
}
