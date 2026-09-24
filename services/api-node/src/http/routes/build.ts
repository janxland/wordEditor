/** 构建端点：POST /api/build/stream、GET /api/build/download、POST /api/preview/styles。 */
import fs from 'node:fs';

import type { FastifyInstance, FastifyReply } from 'fastify';

import { findPandoc } from '../../config.js';
import { createJob, jobDocxPath, writeMarkdown, writeUploadEntries } from '../../jobs/workspace.js';
import { runBuild } from '../../pipeline/build.js';
import type { PipelineEvent } from '../../pipeline/types.js';
import { runStylePreview } from '../../pipeline/preview.js';
import { sanitizeDownloadName } from '../../pipeline/naming.js';
import { findTemplate, loadTemplatesConfig, resolveTemplate } from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';
import { beginSse, writeSse } from '../sse.js';
import type { BuildRequestBody, DownloadPayload, PreviewStylesRequestBody } from '../types.js';

export function artifactDownloadUrl(jobId: string, fileName: string): string {
  return `/api/build/download?jobId=${jobId}&fileName=${encodeURIComponent(fileName)}`;
}

function payload(jobId: string, fileName: string): DownloadPayload {
  return { jobId, fileName, downloadUrl: artifactDownloadUrl(jobId, fileName) };
}

function sseEmitter(reply: FastifyReply) {
  return (event: PipelineEvent): void => {
    if (event.type === 'step') {
      writeSse(reply, 'step', { id: event.id, status: event.status, message: event.message });
    } else {
      writeSse(reply, 'log', { line: event.line, stream: event.stream });
    }
  };
}

export function registerBuildRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/build/stream', async (req, reply) => {
    const body = (req.body ?? {}) as BuildRequestBody;
    const options = body.options ?? {};
    const entries = Array.isArray(body.entries) && body.entries.length > 0 ? body.entries : null;

    beginSse(reply);
    const emit = sseEmitter(reply);
    const step = (status: 'process' | 'finish', message?: string): void =>
      emit({ type: 'step', id: 'prepare', status, message });

    let jobId: string | undefined;
    try {
      if (!body.templateId) throw new Error('templateId is required');
      if (!entries && !body.markdown?.trim()) throw new Error('markdown 或 entries 必填');

      const pandoc = findPandoc(ctx.repoRoot);
      if (!pandoc) {
        throw new Error(
          '未检测到 Pandoc：brew install pandoc（或 winget install --id JohnMacFarlane.Pandoc），' +
            '也可设置环境变量 PANDOC 指向可执行文件。',
        );
      }

      const def = findTemplate(loadTemplatesConfig(ctx.repoRoot), body.templateId);
      const template = resolveTemplate(ctx.repoRoot, def);
      const job = createJob(ctx.cacheDir);
      jobId = job.id;

      step('process', entries ? `写入 ${entries.length} 个文件…` : '写入 Markdown…');
      const input = entries
        ? writeUploadEntries(job, entries, String(body.mdRelPath ?? ''), def.id)
        : writeMarkdown(job, String(body.markdown ?? ''), def.id);
      if (input.skipped) {
        emit({ type: 'log', line: `已跳过 ${input.skipped} 个越界或超大条目`, stream: 'stderr' });
      }
      step('finish');

      const fileName = sanitizeDownloadName(body.fileName || input.defaultFileName);
      await runBuild({
        repoRoot: ctx.repoRoot,
        pandoc,
        template,
        inputMd: input.inputMd,
        outputDocx: job.outputDocx,
        options,
        provenance: body.provenance,
        emit,
      });

      writeSse(reply, 'done', payload(job.id, fileName));
    } catch (e) {
      writeSse(reply, 'error', {
        error: 'build failed',
        detail: e instanceof Error ? e.message : String(e),
        ...(jobId ? { jobId } : {}),
      });
    } finally {
      reply.raw.end();
    }
  });

  app.get('/api/build/download', async (req, reply) => {
    const query = req.query as { jobId?: string; fileName?: string };
    const jobId = String(query.jobId ?? '');
    if (!/^[\w-]+$/.test(jobId)) return reply.status(400).send({ error: 'invalid jobId' });

    const docx = jobDocxPath(ctx.cacheDir, jobId);
    if (!fs.existsSync(docx)) return reply.status(404).send({ error: 'file not found or expired' });

    const fileName = sanitizeDownloadName(query.fileName ?? 'export.docx');
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(fs.createReadStream(docx));
  });

  app.post('/api/preview/styles', async (req, reply) => {
    const body = (req.body ?? {}) as PreviewStylesRequestBody;
    const templateId = String(body.templateId ?? '').trim();
    if (!templateId) return reply.status(400).send({ error: 'templateId is required' });
    if (!body.stylesYaml?.trim()) return reply.status(400).send({ error: 'stylesYaml is required' });

    try {
      const result = await runStylePreview({
        repoRoot: ctx.repoRoot,
        cacheDir: ctx.cacheDir,
        templateId,
        stylesYaml: body.stylesYaml,
        onEvent: () => undefined,
      });
      return payload(result.jobId, result.fileName);
    } catch (e) {
      return reply.status(500).send({
        error: 'style preview failed',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
