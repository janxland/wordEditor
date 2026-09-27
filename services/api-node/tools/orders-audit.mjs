/**
 * 工单残留审计 —— 回答「一单走完后中间产物到底删干净没有」。
 *
 *   cd services/api-node && node tools/orders-audit.mjs
 *
 * 查三处并互相印证：
 *   1. MySQL    —— 已终结（delivered/cancelled）工单及其附件行
 *   2. COS      —— wordeditor/docorder-temp/ 前缀下的全部对象
 *   3. 本地 .cache —— 导出任务的临时目录（job TTL 之外有没有堆积）
 * 结论口径：已终结工单的附件对象必须不在 COS 里；剩下的就是孤儿。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config();
const mysql = require('mysql2/promise');
const COS = require('cos-nodejs-sdk-v5');

const COS_BUCKET = process.env.COS_BUCKET ?? 'mybox-1257251314';
const COS_REGION = process.env.COS_REGION ?? 'ap-chengdu';
const PREFIX = (process.env.COS_WORKSPACE_PREFIX ?? 'wordeditor/docorder-temp').replace(/^\/|\/$/g, '');
const CACHE_DIR = process.env.WORDEDITOR_CACHE_DIR ?? path.resolve(process.cwd(), '../../.cache/wordeditor-api-node');

const cos = new COS({ SecretId: process.env.COS_SECRET_ID ?? '', SecretKey: process.env.COS_SECRET_KEY ?? '' });

async function listAllObjects() {
  const out = [];
  let marker = '';
  for (;;) {
    const res = await cos.getBucket({
      Bucket: COS_BUCKET, Region: COS_REGION, Prefix: PREFIX + '/', MaxKeys: 1000, Marker: marker,
    });
    out.push(...(res.Contents ?? []));
    if (!res.IsTruncated) break;
    marker = res.NextMarker ?? (res.Contents ?? []).slice(-1)[0]?.Key;
    if (!marker) break;
  }
  return out;
}

const pool = mysql.createPool({
  host: process.env.DOCORDER_DB_HOST ?? '100.98.118.42',
  port: Number(process.env.DOCORDER_DB_PORT ?? 3306),
  user: process.env.DOCORDER_DB_USER ?? 'wordeditor',
  password: process.env.DOCORDER_DB_PASSWORD ?? '',
  database: process.env.DOCORDER_DB_NAME ?? 'wordeditor',
  connectionLimit: 2,
});

const [orders] = await pool.query(
  'SELECT id, order_no AS orderNo, status, title, worker_name AS workerName, create_time AS createTime, update_time AS updateTime FROM orders ORDER BY id',
);
const [atts] = await pool.query(
  'SELECT id, order_id AS orderId, kind, name, url, size, uploaded_by AS uploadedBy FROM attachments ORDER BY order_id',
);
await pool.end();

const objects = await listAllObjects();
const cosKeys = new Set(objects.map((o) => o.Key));
const keyOf = (url) => {
  try { return new URL(url).pathname.replace(/^\//, ''); } catch { return ''; }
};

console.log('=== 1. 工单 ===');
const byStatus = {};
for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
console.log(`  共 ${orders.length} 单：${Object.entries(byStatus).map(([k, v]) => k + '=' + v).join('  ')}`);

const closed = orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled');
console.log('\n=== 2. 已终结工单（' + closed.length + ' 单）及其附件 ===');
for (const o of closed) {
  const mine = atts.filter((a) => a.orderId === o.id);
  const survivors = mine.filter((a) => cosKeys.has(keyOf(a.url)));
  const mark = survivors.length === 0 ? (mine.length === 0 ? '-' : 'ok  ') : 'FAIL';
  console.log(`  ${mark} ${o.orderNo} ${o.status.padEnd(10)} 附件 ${mine.length} 个，COS 残留 ${survivors.length} 个`);
  for (const s of survivors) console.log(`        仍在 COS: ${s.name}  ${keyOf(s.url)}`);
}

console.log('\n=== 3. COS 总览 ===');
console.log(`  前缀 ${PREFIX}/ 下共 ${objects.length} 个对象，合计 ${(objects.reduce((n, o) => n + Number(o.Size || 0), 0) / 1024).toFixed(1)} KB`);

const knownKeys = new Set(atts.map((a) => keyOf(a.url)).filter(Boolean));
const orphans = objects.filter((o) => !knownKeys.has(o.Key));
async function deleteKeys(keys) {
  return cos.deleteMultipleObject({
    Bucket: COS_BUCKET,
    Region: COS_REGION,
    Objects: keys.map((Key) => ({ Key })),
  });
}

console.log('\n=== 4. 孤儿对象（不属于任何工单附件）');
if (orphans.length === 0) console.log('  无');
for (const o of orphans) console.log(`  ${o.Key}  ${(Number(o.Size) / 1024).toFixed(1)} KB  ${o.LastModified}`);

// ↑↑ 上传后没下单 / 没提交就会留下这种对象：它不进任何 attachments 行，无处可回收。
// --purge 手动清一轮；想一劳永逸就在 COS 配生命周期规则（前缀 24h 过期）。
if (process.argv.includes('--purge') && orphans.length) {
  const keys = orphans.map((o) => o.Key);
  await deleteKeys(keys);
  console.log(`\n  已删除 ${keys.length} 个孤儿对象：`);
  for (const k of keys) console.log('    - ' + k);
}

const openAtts = atts.filter((a) => {
  const o = orders.find((x) => x.id === a.orderId);
  return o && o.status !== 'delivered' && o.status !== 'cancelled';
});
console.log('\n=== 5. 在办工单的正常附件（应当保留）');
console.log(`  ${openAtts.length} 个`);
for (const a of openAtts) console.log(`  单#${a.orderId} ${a.kind} ${a.name}  COS存在=${cosKeys.has(keyOf(a.url))}`);

console.log('\n=== 6. 本地导出缓存 ===');
if (fs.existsSync(CACHE_DIR)) {
  const dirs = fs.readdirSync(CACHE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  let bytes = 0;
  for (const d of dirs) {
    const p = path.join(CACHE_DIR, d.name);
    for (const f of fs.readdirSync(p, { recursive: true })) {
      try { bytes += fs.statSync(path.join(p, f)).size; } catch { /* 竞态 */ }
    }
  }
  console.log(`  ${CACHE_DIR}\n  ${dirs.length} 个任务目录，${(bytes / 1024 / 1024).toFixed(1)} MB（TTL ${process.env.WORDEDITOR_JOB_TTL_MINUTES ?? 360} 分钟）`);
} else {
  console.log(`  不存在：${CACHE_DIR}`);
}
