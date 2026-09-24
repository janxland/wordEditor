/** 构建端点：POST /api/build/stream、GET /api/build/download、POST /api/preview/styles。 */
import fs from 'node:fs';

import type { FastifyInstance, FastifyReply } from 'fastify';

import { findPandoc, isFile } from '../../config.js';
import { withSlot } from '../../jobs/gate.js';
import { createJob, jobDocxPath, writeMarkdown, writeUploadEntries } from '../../jobs/workspace.js';
import { runBuild } from '../../pipeline/build.js';
import type { PipelineEvent } from '../../pipeline/types.js';
import { runStylePreview } from '../../pipeline/preview.js';
import { sanitizeDownloadName } from '../../pipeline/naming.js';
import { findTemplate, loadTemplatesConfig, resolveTemplate } from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';
import { errorMessage, fail } from '../respond.js';
import { beginSse, writeSse } from '../sse.js';
import type { BuildRequestBody, DownloadPayload, PreviewStylesRequestBody } from '../types.js';

function payload(jobId: string, fileName: string): DownloadPayload {
  // 与 app.py 一致：fileName 已经过 sanitize，只余 \w.-()空格中文，直接拼进 URL。
  return { jobId, fileName, downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${fileName}` };
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
    const templateId = String(body.templateId ?? '').trim();
    const mdRelPath = String(body.mdRelPath ?? '').trim();
    const upload = Array.isArray(body.entries) && body.entries.length > 0 && mdRelPath ? body.entries : null;

    beginSse(reply);
    const emit = sseEmitter(reply);
    const step = (status: 'process' | 'finish', message?: string): void =>
      emit({ type: 'step', id: 'prepare', status, message });

    try {
      if (!templateId) throw new Error('templateId is required');
      if (!upload && !body.markdown?.trim()) throw new Error('markdown 或 entries 必填');

      const pandoc = findPandoc(ctx.repoRoot);
      if (!pandoc) {
        throw new Error(
          '未检测到 Pandoc：brew install pandoc（或 winget install --id JohnMacFarlane.Pandoc），' +
            '也可设置环境变量 PANDOC 指向可执行文件。',
        );
      }

      const template = resolveTemplate(ctx.repoRoot, findTemplate(loadTemplatesConfig(ctx.repoRoot), templateId));
      const job = createJob(ctx.cacheDir);

      step('process', upload ? `写入 ${upload.length} 个文件…` : '写入 Markdown…');
      const input = upload
        ? writeUploadEntries(job, upload, mdRelPath, templateId)
        : writeMarkdown(job, String(body.markdown ?? ''), templateId);
      if (input.skipped) {
        emit({ type: 'log', line: `已跳过 ${input.skipped} 个越界或超大条目`, stream: 'stderr' });
      }
      step('finish');

      const fileName = sanitizeDownloadName(body.fileName || input.defaultFileName);
      // 一路构建要拉起 300~400MB 的 Pandoc，槽位满时排队而不是继续压内存。
      await withSlot(
        () =>
          runBuild({
            repoRoot: ctx.repoRoot,
            pandoc,
            template,
            inputMd: input.inputMd,
            outputDocx: job.outputDocx,
            options,
            provenance: body.provenance,
            emit,
          }),
        (position) =>
          emit({ type: 'log', line: `[排队] 服务端并发已满，等待中（第 ${position} 位）`, stream: 'stdout' }),
      );

      writeSse(reply, 'done', payload(job.id, fileName));
    } catch (e) {
      writeSse(reply, 'error', { error: errorMessage(e) });
    } finally {
      reply.raw.end();
    }
  });

  app.get('/api/build/download', async (req, reply) => {
    const query = req.query as { jobId?: string; fileName?: string };
    const jobId = String(query.jobId ?? '');
    if (!/^[\w-]+$/.test(jobId)) return fail(reply, 400, 'invalid jobId');

    const docx = jobDocxPath(ctx.cacheDir, jobId);
    if (!isFile(docx)) return fail(reply, 404, 'file not found or expired');

    const fileName = sanitizeDownloadName(query.fileName ?? 'export.docx');
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('Content-Disposition', `attachment; filename*=utf-8''${encodeURIComponent(fileName)}`)
      .send(fs.createReadStream(docx));
  });

  app.post('/api/preview/styles', async (req, reply) => {
    const body = (req.body ?? {}) as PreviewStylesRequestBody;
    const templateId = String(body.templateId ?? '').trim();
    if (!templateId) return fail(reply, 400, 'templateId is required');
    if (!body.stylesYaml?.trim()) return fail(reply, 400, 'stylesYaml is required');
    const stylesYaml = body.stylesYaml;

    try {
      const result = await withSlot(() =>
        runStylePreview({
          repoRoot: ctx.repoRoot,
          cacheDir: ctx.cacheDir,
          templateId,
          stylesYaml,
          onEvent: () => undefined,
        }),
      );
      return payload(result.jobId, result.fileName);
    } catch (e) {
      return fail(reply, 500, `style preview failed\n${errorMessage(e)}`.trim());
    }
  });
}
