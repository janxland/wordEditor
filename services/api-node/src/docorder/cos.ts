/**
 * COS 工作区存储 —— 工单附件（可能很大）不落 MySQL/本地盘，直接进腾讯云 COS：
 *   路径：wordeditor/docorder-temp/<uuid><ext>   （单开前缀，视作临时工作区）
 *   生命周期：随工单走，交付/取消后立即 deleteObjects 清空该单全部对象。
 * 凭据来自 api-node/.env（COS_*），不进 git。
 */
import COS from 'cos-nodejs-sdk-v5';

// 惰性初始化：保证 main.ts 里 dotenv 先加载完 .env 再创建客户端
let _cos: COS | null = null;
function client(): COS {
  if (!_cos) {
    _cos = new COS({
      SecretId: process.env.COS_SECRET_ID ?? '',
      SecretKey: process.env.COS_SECRET_KEY ?? '',
    });
  }
  return _cos;
}

const BUCKET = process.env.COS_BUCKET ?? 'mybox-1257251314';
const REGION = process.env.COS_REGION ?? 'ap-chengdu';
const CDN_BASE = (process.env.COS_CDN_BASE ?? 'https://cos.roginx.ink').replace(/\/$/, '');
const PREFIX = (process.env.COS_WORKSPACE_PREFIX ?? 'wordeditor/docorder-temp').replace(/^\/|\/$/g, '');

export function objectUrl(key: string): string {
  return `${CDN_BASE}/${key}`;
}

export function keyOfUrl(url: string): string | null {
  const prefix = `${CDN_BASE}/`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  await client().putObject({ Bucket: BUCKET, Region: REGION, Key: key, Body: body });
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const valid = keys.filter(Boolean);
  if (!valid.length) return;
  // COS 单次最多删 1000 个，工单附件量级远小于此
  await new Promise<void>((resolve, reject) => {
    client().deleteMultipleObject(
      { Bucket: BUCKET, Region: REGION, Objects: valid.map((k) => ({ Key: k })) },
      (err, data) => {
        if (err) return reject(err);
        // 批量删除部分失败时 SDK 不走 err，需检查 Error 数组（如 CAM 未授 DeleteObject）
        const failed = (data as { Error?: { Key: string; Code: string }[] })?.Error ?? [];
        if (failed.length) {
          console.error('[docorder] COS 删除被拒（检查 CAM 是否授予 cos:DeleteObject）:', failed[0].Code);
        }
        resolve();
      },
    );
  });
}

// ---------------------------------------------------------------- 下载中心（发布物分发）

/** 下载中心前缀：桌面端安装包等发布物放这里（运营用 deploy:releases 直传 COS） */
export const DOWNLOADS_PREFIX = (process.env.COS_DOWNLOADS_PREFIX ?? 'wordeditor/downloads').replace(/^\/|\/$/g, '');

export interface DownloadObject {
  key: string;
  size: number;
  lastModified: string;
}

/** 列出下载中心前缀下的对象（单层，MaxKeys 100 足够安装包量级） */
export async function listDownloadObjects(): Promise<DownloadObject[]> {
  return new Promise((resolve, reject) => {
    client().getBucket(
      { Bucket: BUCKET, Region: REGION, Prefix: `${DOWNLOADS_PREFIX}/`, MaxKeys: 100 },
      (err, data) => {
        if (err) return reject(err);
        const contents = ((data as { Contents?: { Key: string; Size: string; LastModified: string }[] }).Contents ?? [])
          .filter((o) => o.Key && o.Key !== `${DOWNLOADS_PREFIX}/`) // 掉目录占位符
          .map((o) => ({ key: o.Key, size: Number(o.Size), lastModified: o.LastModified }));
        resolve(contents);
      },
    );
  });
}

/**
 * 生成限时预签名下载直链（带 attachment 文件名）。
 * 为什么不用 CDN 裸链：下载中心有制作员权限门槛，裸链会绕过后端鉴权；
 * 预签名既让浏览器无需带 Authorization 头就能下，又只有拿到接口响应的人能生成。
 */
export async function presignedDownloadUrl(key: string, filename: string, expiresSec = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    client().getObjectUrl(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
        Sign: true,
        Expires: expiresSec,
        Query: {
          // 让浏览器保存为友好文件名（RFC 5987，中文文件名不乱码）
          'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      } as never,
      (err, data) => {
        if (err) return reject(err);
        resolve(String(data?.Url ?? ''));
      },
    );
  });
}
