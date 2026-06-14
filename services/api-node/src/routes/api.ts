import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BuildRequestBody } from '../types/api.js';
import { safeResolve, sanitizeDownloadName } from '../utils/path.js';
import { beginSse, writeSse } from '../utils/sse.js';
import { findPandoc } from '../config/env.js';
import { extractReferenceStyles } from '../services/docx.service.js';
import {
  loadTemplatesConfig,
  resolveTemplate,
  withTemplateStatus,
} from '../services/template.service.js';
import {
  runBuildStream,
  runImportDocx,
  runStylePreview,
} from '../services/pipeline.service.js';

interface RouteDeps {
  repoRoot: string;
  cacheDir: string;
}

export async function registerApiRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { repoRoot, cacheDir } = deps;

  app.get('/api/health', async () => ({ ok: true, repo: repoRoot, service: 'api-node-ts' }));

  app.get('/api/tools', async () => {
    const pandoc = findPandoc();
    return {
      pandoc: {
        ok: Boolean(pandoc),
        path: pandoc,
        hint: pandoc ? null : 'winget install --id JohnMacFarlane.Pandoc',
      },
      python: {
        ok: true,
        path: process.execPath,
        hint: 'Node backend: python not required',
      },
    };
  });

  app.get('/api/templates', async () => {
    const cfg = loadTemplatesConfig(repoRoot);
    return withTemplateStatus(repoRoot, cfg);
  });

  app.get('/api/templates/reference-styles', async (req, reply) => {
    const query = req.query as { template?: string };
    const templateId = String(query.template || '');
    if (!templateId || !/^[\w-]+$/.test(templateId)) {
      return reply.status(400).send({ error: 'template 参数缺失或非法' });
    }

    const cfg = loadTemplatesConfig(repoRoot);
    const template = resolveTemplate(cfg, templateId);
    const docx = path.join(repoRoot, template.reference_doc);
    const styles = await extractReferenceStyles(docx);
    return {
      docx: path.relative(repoRoot, docx).replace(/\\/g, '/'),
      count: styles.length,
      styles,
    };
  });

  app.get('/api/docs', async (req, reply) => {
    const query = req.query as { name?: string };
    const name = String(query.name || '');
    if (!name || !/^[\w-]+\.md$/.test(name)) {
      return reply.status(400).send({ error: 'invalid doc name' });
    }

    const abs = safeResolve(repoRoot, path.join('docs', name));
    if (!abs) return reply.status(400).send({ error: 'invalid path' });

    try {
      return { content: fs.readFileSync(abs, 'utf-8') };
    } catch (e) {
      return reply.status(404).send({ error: String(e) });
    }
  });

  app.get('/api/build/download', async (req, reply) => {
    const query = req.query as { jobId?: string; fileName?: string };
    const jobId = String(query.jobId || '');
    if (!jobId || !/^[\w-]+$/.test(jobId)) {
      return reply.status(400).send({ error: 'invalid jobId' });
    }

    const docx = path.join(cacheDir, jobId, 'output.docx');
    if (!fs.existsSync(docx)) {
      return reply.status(404).send({ error: 'file not found or expired' });
    }

    const fileName = sanitizeDownloadName(String(query.fileName || 'export.docx'));
    reply
      .status(200)
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return reply.send(fs.createReadStream(docx));
  });

  app.post('/api/preview/styles', async (req, reply) => {
    const body = req.body as { templateId?: string; stylesYaml?: string };
    if (!body.templateId) return reply.status(400).send({ error: 'templateId is required' });
    if (!body.stylesYaml?.trim()) return reply.status(400).send({ error: 'stylesYaml is required' });

    try {
      return await runStylePreview(repoRoot, cacheDir, body.templateId, body.stylesYaml);
    } catch (e) {
      return reply.status(500).send({ error: 'style preview failed', detail: String(e) });
    }
  });

  app.post('/api/build/stream', async (req, reply) => {
    const body = req.body as BuildRequestBody;
    if (!body.templateId) return reply.status(400).send({ error: 'templateId is required' });

    const hasEntries = Array.isArray(body.entries) && body.entries.length > 0;
    if (!hasEntries && !body.markdown?.trim()) {
      return reply.status(400).send({ error: 'markdown 或 entries 必填' });
    }

    beginSse(reply);

    try {
      const done = await runBuildStream(
        repoRoot,
        cacheDir,
        body,
        (id, status, message) => writeSse(reply, 'step', { id, status, message }),
        (line, stream) => writeSse(reply, 'log', { line, stream }),
      );
      writeSse(reply, 'done', done);
      reply.raw.end();
      return reply;
    } catch (e) {
      writeSse(reply, 'error', { error: String(e) });
      reply.raw.end();
      return reply;
    }
  });

  app.post('/api/import/docx', async (req, reply) => {
    const body = req.body as { filename?: string; contentBase64?: string; imageSlug?: string };
    if (!body.contentBase64) return reply.status(400).send({ error: 'contentBase64 is required' });

    try {
      return await runImportDocx(repoRoot, cacheDir, body);
    } catch (e) {
      return reply.status(500).send({ error: 'extract failed', detail: String(e) });
    }
  });

  app.get('/api/file', async (req, reply) => {
    const query = req.query as { path?: string };
    const rel = String(query.path || '');
    if (!rel) return reply.status(400).send({ error: 'path required' });

    const abs = safeResolve(repoRoot, rel);
    if (!abs) return reply.status(400).send({ error: 'invalid path' });

    try {
      return { content: fs.readFileSync(abs, 'utf-8') };
    } catch (e) {
      return reply.status(404).send({ error: String(e) });
    }
  });

  app.put('/api/file', async (req, reply) => {
    const query = req.query as { path?: string };
    const rel = String(query.path || '');
    const body = req.body as { content?: string };

    if (!rel) return reply.status(400).send({ error: 'path required' });
    const abs = safeResolve(repoRoot, rel);
    if (!abs) return reply.status(400).send({ error: 'invalid path' });
    if (typeof body.content !== 'string') {
      return reply.status(400).send({ error: 'content required' });
    }

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body.content, 'utf-8');
    return { ok: true };
  });
}
