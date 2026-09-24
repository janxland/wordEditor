/** 导入端点：POST /api/import/docx。 */
import fs from 'node:fs';

import type { FastifyInstance } from 'fastify';

import { createJob } from '../../jobs/workspace.js';
import { extractDocxToMarkdown } from '../../pipeline/extract.js';
import type { AppContext } from '../context.js';
import type { ImportDocxRequestBody } from '../types.js';

export function registerImportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/import/docx', async (req, reply) => {
    const body = (req.body ?? {}) as ImportDocxRequestBody;
    if (!body.contentBase64) return reply.status(400).send({ error: 'contentBase64 is required' });

    const job = createJob(ctx.cacheDir);
    try {
      const result = await extractDocxToMarkdown({
        workDir: job.dir,
        filename: String(body.filename ?? 'input.docx'),
        contentBase64: body.contentBase64,
        imageSlug: body.imageSlug,
      });

      return {
        jobId: job.id,
        fileName: `${result.stem}.md`,
        mdRelPath: `${result.stem}.md`,
        markdown: result.markdown,
        entries: result.files.map((file) => {
          const buffer = fs.readFileSync(file.absPath);
          return { relPath: file.relPath, contentBase64: buffer.toString('base64'), size: buffer.length };
        }),
        log: result.log,
      };
    } catch (e) {
      return reply.status(500).send({
        error: 'extract failed',
        detail: e instanceof Error ? e.message : String(e),
        jobId: job.id,
      });
    }
  });
}
