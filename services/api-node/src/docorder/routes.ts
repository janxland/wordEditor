/**
 * 文档工单路由 —— 业务完全落在 wordEditor 自有后端（服务器 MySQL 新库 wordeditor + COS 临时工作区），
 * AuthCenter 只承担登录/注册/鉴权（见 docorder/auth.ts），不承载业务。
 *
 * 端点：
 *   POST /api/auth/login            登录代理（密文进明文出，浏览器抓包无明文密码）
 *   POST /api/auth/register         注册代理（同上）
 *   POST /api/doc-order-uploads     上传附件（登录即可，返回可回填的 url）
 *   POST /api/doc-orders            下单（可带附件）
 *   GET  /api/doc-orders/my         我的工单
 *   GET  /api/doc-orders/queue      制作队列（员工）
 *   POST /api/doc-orders/:id/accept|submit|deliver|rework|cancel
 */
import crypto from 'node:crypto';
import path from 'node:path';

import multipartPlugin from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

import { HttpError } from '../http/params.js';
import { proxyLogin, proxyRegister, requireUser, isWorkerUser } from './auth.js';
import { openDocOrderStore, type AttachmentRow, type DocOrderStore, type OrderRow } from './db.js';
import { deleteObjects, keyOfUrl, objectUrl, putObject } from './cos.js';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
const NAME_MAX_CHARS = 120;

/**
 * 文件名校验 —— 只挡会出事的，其余一律放行。
 * 以前用纯白名单 `[\w.\-\u4e00-\u9fa5]`，导致「开题报告（修改稿） v2.docx」
 * 这种再正常不过的名字被判非法；这里改成黑名单：
 *   空 / 路径穿越 / 控制字符 / 超长 → 拒绝
 *   Windows 保留字符（* " < > |）→ 替换而不是报错，避免用户改一遍文件名
 */
function safeDisplayName(raw: string): string {
  const base = String(raw ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const name = base.trim();
  if (!name || name === '.' || name === '..') throw new HttpError(400, '文件名为空或不合法');
  if (/[\x00-\x1f\x7f]/.test(name)) throw new HttpError(400, '文件名含不可见控制字符');
  if (name.length > NAME_MAX_CHARS) throw new HttpError(400, `文件名超过 ${NAME_MAX_CHARS} 个字符`);
  return name.replace(/[*"<>|]/g, '_');
}

/** 上传单文件进 COS 工作区，返回可落库的附件元数据 */
async function uploadToCos(file: { filename: string; toBuffer(): Promise<Buffer> }, uploadedBy: string) {
  const displayName = safeDisplayName(file.filename || '附件');
  const buf = await file.toBuffer();
  if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, '文件超过 50MB 限制');
  const key = `${process.env.COS_WORKSPACE_PREFIX ?? 'wordeditor/docorder-temp'}/${crypto.randomUUID()}${path.extname(displayName)}`;
  await putObject(key, buf);
  return { name: displayName, url: objectUrl(key), size: buf.length, uploadedBy };
}

/** 交付/取消后立即清空该单的 COS 临时对象 */
async function purgeOrderObjects(store: DocOrderStore, orderId: number): Promise<void> {
  const atts = await store.attachmentsOf(orderId);
  const keys = atts.map((a) => keyOfUrl(a.url)).filter((k): k is string => !!k);
  try {
    await deleteObjects(keys);
  } catch (e) {
    // 清理失败不阻塞状态流转，仅记日志
    console.error('[docorder] purge COS failed:', (e as Error).message);
  }
}

export async function orderView(store: DocOrderStore, o: OrderRow) {
  return {
    ...o,
    attachments: await store.attachmentsOf(o.id),
    timeline: await store.timelineOf(o.id),
  };
}

export function registerDocOrderRoutes(app: FastifyInstance, ctx: { repoRoot: string }): void {
  const store = openDocOrderStore();

  app.register(multipartPlugin, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // ---------------------------------------------------------------- 凭证代理
  app.post('/api/auth/login', async (req) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) throw new HttpError(400, 'username / password required');
    const r = await proxyLogin(body.username, body.password);
    return replyPassthrough(r.status, r.body);
  });

  app.post('/api/auth/register', async (req) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) throw new HttpError(400, 'username / password required');
    const r = await proxyRegister(body.username, body.password);
    return replyPassthrough(r.status, r.body);
  });

  // ---------------------------------------------------------------- 上传（COS 工作区）
  app.post('/api/doc-order-uploads', async (req) => {
    const user = await requireUser(req.headers.authorization);
    const file = await req.file();
    if (!file) throw new HttpError(400, 'file required');
    return uploadToCos(file, user.username);
  });

  // ---------------------------------------------------------------- 工单
  const workerOnly = (u: { roleCodes: string[]; userId: number; username: string }): void => {
    if (!isWorkerUser(u)) throw new HttpError(403, '需要制作员权限');
  };

  app.post('/api/doc-orders', async (req) => {
    const user = await requireUser(req.headers.authorization);
    const body = (req.body ?? {}) as {
      type?: string;
      title?: string;
      requirement?: string;
      attachments?: { name: string; url: string; size?: number }[];
    };
    const type = body.type === 'template' ? 'template' : body.type === 'document' ? 'document' : null;
    if (!type) throw new HttpError(400, 'type 必须是 template | document');
    const title = (body.title ?? '').trim();
    if (title.length < 2) throw new HttpError(400, '标题至少 2 个字符');

    const order = await store.createOrder({
      type,
      title,
      requirement: (body.requirement ?? '').trim(),
      customerId: user.userId,
      customerName: user.username,
    });
    const atts = (body.attachments ?? []).filter((a) => a && a.name && a.url);
    if (atts.length) await store.addAttachments(order.id, 'requirement', atts, user.username);
    await store.addTimeline(order.id, { status: 'placed', by: user.username, byUserId: user.userId, note: '下单' });
    return { order: await orderView(store, (await store.getOrder(order.id))!) };
  });

  app.get('/api/doc-orders/my', async (req) => {
    const user = await requireUser(req.headers.authorization);
    const mine = await store.listByCustomer(user.userId);
    return { orders: await Promise.all(mine.map((o) => orderView(store, o))) };
  });

  app.get('/api/doc-orders/queue', async (req) => {
    const user = await requireUser(req.headers.authorization);
    workerOnly(user);
    const queue = await store.listQueue();
    return { orders: await Promise.all(queue.map((o) => orderView(store, o))) };
  });

  const transition = async (
    req: import('fastify').FastifyRequest,
    fn: (user: Awaited<ReturnType<typeof requireUser>>, order: OrderRow, body: Record<string, unknown>) => void | Promise<void>,
  ): Promise<{ order: Awaited<ReturnType<typeof orderView>> }> => {
    const user = await requireUser(req.headers.authorization);
    const id = Number((req.params as { id: string }).id);
    const order = await store.getOrder(id);
    if (!order) throw new HttpError(404, '工单不存在');
    const body = (req.body ?? {}) as Record<string, unknown>;
    await fn(user, order, body);
    return { order: await orderView(store, (await store.getOrder(id))!) };
  };

  app.post('/api/doc-orders/:id/accept', async (req) =>
    transition(req, async (user, order) => {
      workerOnly(user);
      if (order.status !== 'placed') throw new HttpError(409, '当前状态不可接单');
      await store.updateOrder(order.id, { status: 'producing', workerId: user.userId, workerName: user.username });
      await store.addTimeline(order.id, { status: 'producing', by: user.username, byUserId: user.userId, note: '接单' });
    }),
  );

  app.post('/api/doc-orders/:id/submit', async (req) =>
    transition(req, async (user, order, body) => {
      workerOnly(user);
      if (order.workerId !== user.userId) throw new HttpError(403, '不是该工单的制作人');
      if (order.status !== 'producing' && order.status !== 'rework') throw new HttpError(409, '当前状态不可提交');
      const atts = (body.attachments as { name: string; url: string; size?: number }[] | undefined)?.filter(
        (a) => a && a.name && a.url,
      );
      if (!atts?.length) throw new HttpError(400, '请上传交付附件');
      await store.addAttachments(order.id, 'deliverable', atts, user.username);
      await store.updateOrder(order.id, { status: 'checking' });
      await store.addTimeline(order.id, {
        status: 'checking',
        by: user.username,
        byUserId: user.userId,
        note: typeof body.note === 'string' ? body.note : '提交检查',
      });
    }),
  );

  app.post('/api/doc-orders/:id/deliver', async (req) =>
    transition(req, async (user, order) => {
      if (order.customerId !== user.userId) throw new HttpError(403, '只有下单人可确认');
      if (order.status !== 'checking') throw new HttpError(409, '当前状态不可确认交付');
      await store.updateOrder(order.id, { status: 'delivered' });
      await store.addTimeline(order.id, { status: 'delivered', by: user.username, byUserId: user.userId, note: '确认完成' });
      await purgeOrderObjects(store, order.id); // 交付即清空 COS 临时工作区
    }),
  );

  app.post('/api/doc-orders/:id/rework', async (req) =>
    transition(req, async (user, order, body) => {
      if (order.customerId !== user.userId) throw new HttpError(403, '只有下单人可要求返工');
      if (order.status !== 'checking') throw new HttpError(409, '当前状态不可返工');
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!note) throw new HttpError(400, '返工必须附说明');
      await store.updateOrder(order.id, { status: 'rework' });
      await store.addTimeline(order.id, { status: 'rework', by: user.username, byUserId: user.userId, note });
    }),
  );

  app.post('/api/doc-orders/:id/cancel', async (req) =>
    transition(req, async (user, order) => {
      if (order.customerId !== user.userId) throw new HttpError(403, '只有下单人可取消');
      if (order.status !== 'placed') throw new HttpError(409, '制作已开始，不可取消');
      await store.updateOrder(order.id, { status: 'cancelled' });
      await store.addTimeline(order.id, { status: 'cancelled', by: user.username, byUserId: user.userId, note: '用户取消' });
      await purgeOrderObjects(store, order.id); // 取消同样立即清理
    }),
  );
}

/** 透传 AuthCenter 信封：2xx 原样回，非 2xx 也要让前端拿到内层 message。 */
function replyPassthrough(status: number, body: unknown): unknown {
  if (status >= 200 && status < 300) return body;
  const e = new Error(extractMessage(body) ?? `AuthCenter ${status}`) as Error & { statusCode: number };
  e.statusCode = status === 401 || status === 403 ? 401 : 502;
  throw e;
}

function extractMessage(body: unknown): string | null {
  const b = body as { data?: { message?: string }; message?: string };
  return b?.data?.message ?? b?.message ?? null;
}

// kind 仅内部使用，导出便于前端类型对齐
export type { AttachmentRow };
