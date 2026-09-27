/**
 * 工单链路冒烟 —— 零依赖（只用 node:crypto），后端起在 8787 时直接跑：
 *   node services/api-node/tools/orders-smoke.mjs
 *
 * 覆盖：注册 → 登录 → 拉我的单 → 拉队列 → 下单 → 再拉 → 五个动作的错误码 → 取消。
 * 断言口径：
 *   - 列表必须能解出数组（曾经因前端把裸体当信封取 .data 而整体 undefined）；
 *   - 无 body 的动作（accept/deliver/cancel）不能是 400（曾经带空 Content-Type 被 Fastify 拒）。
 *
 * 副作用：会在 AuthCenter 注册一个 we-smoke-* 测试账号、在 wordeditor 库留一条已取消工单。
 * 想不留账号就先手动在 AuthCenter 删掉它。
 */
import crypto from 'node:crypto';

const BASE = process.env.WORDEDITOR_API ?? 'http://127.0.0.1:8787';
const KEY = Buffer.from('aoligeimeimaobin', 'utf8');

/** 与前端 credentialCrypto.ts 同源：AES-128-ECB + Pkcs7，base64 做 URL-safe 替换 */
function encryptCredential(plain) {
  const c = crypto.createCipheriv('aes-128-ecb', KEY, null);
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
  return out.replace(/\//g, '_').replace(/\+/g, '-');
}

/** 复刻前端 services/docOrder.ts 的 call()：裸体与信封两种返回体都要接得住 */
async function call(path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || (payload.code && payload.code !== 200)) {
    const msg = payload.message || payload.detail || JSON.stringify(payload).slice(0, 160);
    const err = new Error(path + ' -> HTTP ' + res.status + ' ' + msg);
    err.status = res.status;
    throw err;
  }
  return 'data' in payload ? payload.data : payload;
}

const problems = [];
const check = (ok, label, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail ? '  ' + detail : ''));
  if (!ok) problems.push(label);
};

const user = 'we-smoke-' + Date.now().toString().slice(-6);
const pass = 'Smoke@2026';
console.log('工单链路冒烟  baseline=' + BASE + '  user=' + user);

await call('/api/auth/register', { method: 'POST', body: { username: user, password: encryptCredential(pass) } });

const envelope = await call('/api/auth/login', {
  method: 'POST',
  body: { username: user, password: encryptCredential(pass) },
});
const inner = envelope && envelope.data ? envelope.data : envelope;
const token = inner && inner.accessToken;
check(!!token, '登录拿到 accessToken');
const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
console.log('        userId=' + claims.userId + '  roles=' + JSON.stringify(claims.roleCodes ?? []));

const mine0 = (await call('/api/doc-orders/my', { token })).orders;
check(Array.isArray(mine0), 'GET my 解出数组', 'len=' + mine0.length);

let queueStatus = '200';
try {
  const q = await call('/api/doc-orders/queue', { token });
  check(Array.isArray(q.orders), 'GET queue 解出数组', 'len=' + q.orders.length);
} catch (e) {
  queueStatus = String(e.status);
  // 非制作员必 403；若是 400 说明守卫或 body 处理坏了
  check(e.status === 403, 'GET queue 非制作员应 403', 'got ' + e.status);
}

// 附件名校验走黑名单，带空格/括号/+& 的中文论文名必须放行（曾经用白名单被误杀）
const fd = new FormData();
const trickyName = '开题报告（修改稿）v2+附录&.docx';
fd.append('file', new Blob(['x'.repeat(64)]), trickyName);
const up = await fetch(BASE + '/api/doc-order-uploads', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token },
  body: fd,
}).then((r) => r.json());
check(up?.name === trickyName, 'POST 上传（文件名含空格/括号/+&）', up?.name ?? up?.message ?? up?.detail);

const created = await call('/api/doc-orders', {
  method: 'POST',
  token,
  body: {
    type: 'document',
    title: '冒烟单',
    requirement: '验证解析与动作码',
    // 挂到单上，稍后 cancel 会连带 purge COS 对象，不留孤儿
    attachments: up?.url ? [{ name: up.name, url: up.url, size: 64 }] : [],
  },
});
check(created?.order?.status === 'placed', 'POST 下单', created?.order?.orderNo);
check(created?.order?.attachments?.length === 1, '附件回填进工单', 'len=' + created?.order?.attachments?.length);

const mine1 = (await call('/api/doc-orders/my', { token })).orders;
check(mine1.length === 1, 'my 能看到刚下的单', 'len=' + mine1.length);

// 无 body 的动作曾经被 Fastify 以「声明 json 却无 body」回 400；403/409 都算通过
for (const [act, body] of [
  ['accept', undefined],
  ['submit', { note: 'x' }],
  ['deliver', undefined],
  ['rework', { note: 'x' }],
]) {
  let status = 200;
  try {
    await call('/api/doc-orders/' + created.order.id + '/' + act, { method: 'POST', token, body });
  } catch (e) {
    status = e.status;
  }
  check(status !== 400, 'POST ' + act + ' 不应 400', 'got ' + status);
}

const done = await call('/api/doc-orders/' + created.order.id + '/cancel', { method: 'POST', token });
check(done?.order?.status === 'cancelled', 'POST cancel 无 body 可通过');

console.log(problems.length ? '\nFAILED: ' + problems.join(' | ') : '\nSMOKE OK（工单链路闭环）');
console.log('测试账号可删：' + user + (queueStatus === '403' ? '（非制作员）' : ''));
process.exit(problems.length ? 1 : 0);
