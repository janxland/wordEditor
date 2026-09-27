/**
 * 下载中心 —— 给制作人分发桌面端安装包等产物。
 *
 * 数据源是 COS（wordeditor/downloads/ 前缀，deploy:releases 直传），不是服务器本地盘：
 *   GET /api/downloads          文件列表（登录即可），返回限时预签名直链
 *   GET /api/downloads/file/*   生成单文件预签名直链（制作员权限）
 *
 * 为什么 302/预签名而不是后端流式转发：安装包几百 MB，走服务器带宽又慢又贵；
 * 预签名让浏览器免 Authorization 头直接从 COS 拉，权限门槛收敛在「能拿到直链」上。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { isWorkerUser } from '../../docorder/auth.js';
import { DOWNLOADS_PREFIX, listDownloadObjects, presignedDownloadUrl } from '../../docorder/cos.js';
import { HttpError } from '../params.js';

/** 从 key 反解展示文件名（prefix 之后的路径；key 均由本方上传，不存在穿越问题） */
function nameOfKey(key: string): string {
  return key.slice(DOWNLOADS_PREFIX.length + 1).split('/').pop() ?? key;
}

export function registerDownloadRoutes(app: FastifyInstance, ctx: { repoRoot: string }): void {
  void ctx;

  // ---- 列表（登录即可；COS 没放包时回空列表，桌面端首启不报错）
  app.get('/api/downloads', async () => {
    const objects = await listDownloadObjects();
    const items = await Promise.all(
      objects
        .filter((o) => nameOfKey(o.key))
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
        .map(async (o) => {
          const name = nameOfKey(o.key);
          return {
            name,
            size: o.size,
            updateTime: o.lastModified,
            url: await presignedDownloadUrl(o.key, name),
          };
        }),
    );
    return { items, prefix: DOWNLOADS_PREFIX };
  });

  // ---- 单文件预签名直链（制作员专属；用于补签/直链分享）
  app.get('/api/downloads/file/*', async (req: FastifyRequest) => {
    const user = (req as { authUser?: { roleCodes: string[] } }).authUser;
    if (!user || !isWorkerUser(user as never)) throw new HttpError(403, '需要制作员权限');
    const name = decodeURIComponent((req.params as { '*': string })['*'] ?? '');
    if (!name || name.includes('..')) throw new HttpError(400, '非法文件名');
    const key = `${DOWNLOADS_PREFIX}/${name}`;
    const objects = await listDownloadObjects();
    if (!objects.some((o) => o.key === key)) throw new HttpError(404, '文件不存在');
    return { url: await presignedDownloadUrl(key, name) };
  });

  app.log.info({ prefix: DOWNLOADS_PREFIX }, '[downloads] 下载中心已注册（COS 数据源）');
}
