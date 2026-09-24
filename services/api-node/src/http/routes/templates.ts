/** 模板端点：GET /api/templates、GET /api/templates/reference-styles。 */
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { isFile } from '../../config.js';
import { extractReferenceStyles } from '../../pipeline/reference-styles.js';
import { loadTemplatesConfig, templateById, withTemplateStatus } from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';
import { errorMessage } from '../respond.js';
import { fromQuery, HttpError, mustMatch, trimOf } from '../params.js';

export function registerTemplateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/templates', async () => {
    if (!isFile(path.join(ctx.repoRoot, 'config', 'templates.json'))) {
      throw new HttpError(500, 'config/templates.json 不存在');
    }
    return withTemplateStatus(ctx.repoRoot, loadTemplatesConfig(ctx.repoRoot));
  });

  app.get('/api/templates/reference-styles', async (req) => {
    const templateId = mustMatch(
      trimOf(fromQuery(req), 'template'),
      /^[\w-]+$/,
      'template 参数缺失或非法',
    );
    const template = templateById(ctx.repoRoot, templateId);

    try {
      const styles = await extractReferenceStyles(template.referenceDoc);
      // docx 字段与 list_reference_styles.py 一致：相对仓库根的路径。
      return {
        docx: path.relative(ctx.repoRoot, template.referenceDoc),
        count: styles.length,
        styles,
      };
    } catch (e) {
      throw new HttpError(500, errorMessage(e) || '读取 reference styles 失败');
    }
  });
}
