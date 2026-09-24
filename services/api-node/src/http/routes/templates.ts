/** 模板端点：GET /api/templates、GET /api/templates/reference-styles。 */
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { isFile } from '../../config.js';
import { extractReferenceStyles } from '../../pipeline/reference-styles.js';
import {
  findTemplate,
  loadTemplatesConfig,
  resolveTemplate,
  withTemplateStatus,
} from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';
import { errorMessage, fail } from '../respond.js';

export function registerTemplateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/templates', async (_req, reply) => {
    const file = path.join(ctx.repoRoot, 'config', 'templates.json');
    if (!isFile(file)) return fail(reply, 500, 'config/templates.json 不存在');
    return withTemplateStatus(ctx.repoRoot, loadTemplatesConfig(ctx.repoRoot));
  });

  app.get('/api/templates/reference-styles', async (req, reply) => {
    const templateId = String((req.query as { template?: string }).template ?? '').trim();
    if (!/^[\w-]+$/.test(templateId)) return fail(reply, 400, 'template 参数缺失或非法');

    try {
      const def = findTemplate(loadTemplatesConfig(ctx.repoRoot), templateId);
      const template = resolveTemplate(ctx.repoRoot, def);
      const styles = await extractReferenceStyles(template.referenceDoc);
      // docx 字段与 list_reference_styles.py 一致：相对仓库根的路径。
      return { docx: path.relative(ctx.repoRoot, template.referenceDoc), count: styles.length, styles };
    } catch (e) {
      return fail(reply, 500, errorMessage(e) || '读取 reference styles 失败');
    }
  });
}
