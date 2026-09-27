/**
 * 工单页 UI 冒烟 —— 真浏览器登录，验证「返工后的工单仍然看得见」。
 *
 *   NODE_PATH=/Users/Admin1/.workbuddy/binaries/node/workspace/node_modules \
 *   node services/api-node/tools/orders-ui-smoke.mjs
 *
 * 可选环境变量：USER / PASS / URL / SHOT（截图路径）
 * 依赖 playwright-core（不下载浏览器，复用本机 ~/Library/Caches/ms-playwright 的 chromium）
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// playwright-core 装在隔离目录，ESM 不认 NODE_PATH，用 require 从绝对路径取
const require = createRequire(
  process.env.PLAYWRIGHT_MODULES ??
    path.join(os.homedir(), '.workbuddy/binaries/node/workspace/node_modules/'),
);
const { chromium } = require('playwright-core');

const EXE =
  process.env.CHROME_PATH ??
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL = process.env.URL ?? 'http://127.0.0.1:5174/orders';
const USER = process.env.USERNAME_ARG ?? 'we-smoke-859250';
const PASS = process.env.PASS ?? 'Smoke@2026';
const SHOT = process.env.SHOT ?? '/tmp/orders-ui.png';

const problems = [];
const check = (ok, label, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail ? '  ' + detail : ''));
  if (!ok) problems.push(label);
};

if (!fs.existsSync(EXE)) throw new Error('找不到 chromium：' + EXE);

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const badRequests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('response', (r) => {
  if (r.status() >= 400) badRequests.push(r.status() + ' ' + r.url());
});

await page.goto(URL, { waitUntil: 'networkidle' });

// 登录框：外壳 Modal 与工单页引导卡各渲染一份，只操作真正可见的那个
const scope = page.locator('.ant-modal-wrap').filter({ visible: true }).first();
await scope.locator('input[autocomplete="username"]').waitFor({ timeout: 15000 });
await scope.locator('input[autocomplete="username"]').fill(USER);
await scope.locator('input[type="password"]').fill(PASS);
await scope.locator('button[type="submit"]').click();

await page.waitForSelector('.od', { timeout: 20000 });
await page.waitForTimeout(2500); // 等列表接口回来

const cards = await page.locator('.od-card').count();
check(cards > 0, '左栏列出卡片', 'count=' + cards);

const orderNoVisible = await page.getByText('DO202609265EBXOL').count();
check(orderNoVisible > 0, '工单在默认视图可见（没有被筛选挡掉）');

const body = (await page.locator('.od').innerText()).replace(/\s+/g, ' ');
// 状态随流转变化
const known = /已下单|制作中|待确认|返工中|已完成|已取消/.test(body);
check(known, '详情显示状态标签');
console.log('        详情摘要: ' + body.slice(0, Number(process.env.DETAIL_CHARS ?? 220)));
// 工单终结后 COS 对象已清，附件必须标「已清理」而不是给一个 404 链接
if (/已完成|已取消/.test(body)) {
  check(/已清理/.test(body), '终结工单的附件标记为「已清理」');
}

check(errors.length === 0, '页面无 JS 异常', errors.slice(0, 2).join(' | '));
if (badRequests.length) {
  console.log('        失败请求（含未登录 401，属预期）:');
  for (const b of [...new Set(badRequests)]) console.log('          ' + b);
}

await page.screenshot({ path: SHOT, fullPage: false });
console.log('        截图: ' + SHOT);
await browser.close();

console.log(problems.length ? '\nFAILED: ' + problems.join(' | ') : '\nUI SMOKE OK');
process.exit(problems.length ? 1 : 0);
