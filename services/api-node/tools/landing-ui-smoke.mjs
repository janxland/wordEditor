// 验证落地页 + 分组导航（复用本机 chromium，不下载浏览器）
import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_MODULES ?? '/tmp/pw/node_modules/');
const { chromium } = require('playwright-core');

const exe =
  process.env.CHROME_PATH ??
  path.join(
    os.homedir(),
    'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  );
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));

await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });

const check = (ok, name, extra = '') =>
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : ''));

check(await page.locator('.lp-hero').count() > 0, '落地页渲染');
check((await page.locator('.lp-title').innerText()).includes('你只管把内容写好'), '标题是下单人口吻');
check(await page.getByRole('button', { name: /去下单/ }).count() > 0, '主 CTA「去下单」存在');

// 侧边栏分组与顺序
const labels = await page.locator('.app-sider .ant-menu-item-group-title').allInnerTexts();
check(labels.join('|') === '顾客服务|制作工具|其他', '导航分组', labels.join(' | '));
const items = await page.locator('.app-sider .ant-menu-item .ant-menu-title-content').allInnerTexts();
check(items[0] === '首页' && items[1] === '工单中心', '工单中心紧随首页', items.join(' / '));
check(items.includes('模板工作台') && items.includes('导出 Word'), '制作工具收拢成组');

// 落地页无「请登录读模板」打扰
check((await page.locator('.ant-alert').count()) === 0, '落地页无 API 报错打扰');

// CTA 跳转
await page.getByRole('button', { name: /去下单/ }).click();
await page.waitForURL('**/orders');
check(page.url().endsWith('/orders'), 'CTA 跳到工单中心');

// /workbench 可达
await page.goto('http://127.0.0.1:5174/workbench', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
check(await page.locator('.app-content').count() > 0, '/workbench 正常加载');

check(errors.length === 0, '无 JS 异常', errors[0] ?? '');
await page.screenshot({ path: '/tmp/landing.png', fullPage: false });
await browser.close();
console.log('LANDING SMOKE DONE');
