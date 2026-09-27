/** 构建端点：POST /api/build/stream、GET /api/build/download、POST /api/preview/styles。 */
import fs from 'node:fs';

import type { FastifyInstance } from 'fastify';

import { findPandoc, isFile } from '../../config.js';
import { withSlot } from '../../jobs/gate.js';
import {
  createJob,
  dropJob,
  jobDocxPath,
  jobOwnerOf,
  rememberJobOwner,
  writeMarkdown,
  writeUploadEntries,
  type Job,
  type UploadEntry,
} from '../../jobs/workspace.js';
import { runBuild } from '../../pipeline/build.js';
import type { BuildOptions } from '../../pipeline/types.js';
import { runStylePreview } from '../../pipeline/preview.js';
import { sanitizeDownloadName } from '../../pipeline/naming.js';
import type { DocxProvenance } from '../../pipeline/metadata.js';
import { templateById } from '../../pipeline/templates.js';
import type { AppContext } from '../context.js';
import { requiredSchema } from '../contract.js';
import { authEnabled, type AuthedRequest } from '../guard.js';
import { badRequest, fromBody, fromQuery, HttpError, mustMatch, mustStr, mustTrim, strOf, trimOf } from '../params.js';
import { errorMessage, serverError } from '../respond.js';
import { openSse } from '../sse.js';
import type { DownloadPayload } from '../types.js';

function payload(jobId: string, fileName: string): DownloadPayload {
  // 与 app.py 一致：fileName 已经过 sanitize，只余 \w.-()空格中文，直接拼进 URL。
  return { jobId, fileName, downloadUrl: `/api/build/download?jobId=${jobId}&fileName=${fileName}` };
}

export function registerBuildRoutes(app: FastifyInstance, ctx: AppContext): void {
  // 该端点的入参错误按契约以 SSE error 帧回吐（HTTP 恒 200），所以不注册请求体 schema，
  // 否则框架会在进处理函数之前就抛 400，前端只能看到一个无详情的连接错误。
  app.post('/api/build/stream', async (req, reply) => {
    const body = fromBody(req);
    const ch = openSse(reply);
    const { emit, close } = ch;
    const step = (status: 'process' | 'finish', message?: string): void =>
      ch.step('prepare', status, message);

    let created: Job | undefined; // 失败时回收；成功路径不登记
    try {
      const templateId = mustTrim(body, 'templateId');
      const markdown = strOf(body, 'markdown');
      const mdRelPath = trimOf(body, 'mdRelPath');
      const entries = Array.isArray(body.entries) && body.entries.length > 0
        ? (body.entries as UploadEntry[])
        : null;
      const upload = entries && mdRelPath ? entries : null;
      if (!upload && !markdown.trim()) throw badRequest('markdown 或 entries 必填');

      const pandoc = findPandoc(ctx.repoRoot);
      if (!pandoc) {
        throw new Error(
          '未检测到 Pandoc：brew install pandoc（或 winget install --id JohnMacFarlane.Pandoc），' +
            '也可设置环境变量 PANDOC 指向可执行文件。',
        );
      }

      const template = templateById(ctx.repoRoot, templateId);
      const job = createJob(ctx.cacheDir);
      created = job;
      const owner = (req as AuthedRequest).authUser;
      if (owner) rememberJobOwner(job.id, owner.userId);

      step('process', upload ? `写入 ${upload.length} 个文件…` : '写入 Markdown…');
      const input = upload
        ? writeUploadEntries(job, upload, mdRelPath, templateId)
        : writeMarkdown(job, markdown, templateId);
      if (input.skipped) {
        emit({ type: 'log', line: `已跳过 ${input.skipped} 个越界或超大条目`, stream: 'stderr' });
      }
      step('finish');

      const fileName = sanitizeDownloadName(strOf(body, 'fileName') || input.defaultFileName);
      // 一路构建要拉起 300~400MB 的 Pandoc，槽位满时排队而不是继续压内存。
      await withSlot(
        () =>
          runBuild({
            repoRoot: ctx.repoRoot,
            pandoc,
            template,
            inputMd: input.inputMd,
            outputDocx: job.outputDocx,
            options: (body.options ?? {}) as BuildOptions,
            provenance: body.provenance as DocxProvenance | undefined,
            emit,
          }),
        (position) =>
          emit({ type: 'log', line: `[排队] 服务端并发已满，等待中（第 ${position} 位）`, stream: 'stdout' }),
      );

      ch.done(payload(job.id, fileName));
    } catch (e) {
      if (created) dropJob(created);
      ch.fail(errorMessage(e));
    } finally {
      close();
    }
  });

  app.get('/api/build/download', async (req, reply) => {
    const jobId = mustMatch(strOf(fromQuery(req), 'jobId'), /^[\w-]+$/, 'invalid jobId');
    const docx = jobDocxPath(ctx.cacheDir, jobId);
    if (!isFile(docx)) throw new HttpError(404, 'file not found or expired');

    // 产物只归创建者：jobId 一旦外泄，别人也拿不到这份 docx
    const owner = jobOwnerOf(jobId);
    const user = (req as AuthedRequest).authUser;
    if (authEnabled() && owner != null && user?.userId !== owner) {
      throw new HttpError(403, '这不是你的构建任务');
    }

    // 缺参数走 Fastify/Query 的默认值口径（与 app.py 的 Query("export.docx") 一致），
    // 所以这里用 ?? 而不是把空串当缺省。
    const fileName = sanitizeDownloadName(String(fromQuery(req).fileName ?? 'export.docx'));
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('Content-Disposition', `attachment; filename*=utf-8''${encodeURIComponent(fileName)}`)
      .send(fs.createReadStream(docx));
  });

  app.post(
    '/api/preview/styles',
    { schema: { body: requiredSchema(ctx.repoRoot, 'PreviewStylesRequest') } },
    async (req) => {
      const body = fromBody(req);
      const templateId = mustTrim(body, 'templateId');
      const stylesYaml = mustStr(body, 'stylesYaml');

      try {
        const result = await withSlot(() =>
          runStylePreview({
            repoRoot: ctx.repoRoot,
            cacheDir: ctx.cacheDir,
            templateId,
            stylesYaml,
            onEvent: () => undefined,
            ownerId: (req as AuthedRequest).authUser?.userId,
          }),
        );
        return payload(result.jobId, result.fileName);
      } catch (e) {
        throw serverError('style preview failed', e);
      }
    },
  );
}
