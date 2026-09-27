/**
 * 下单指引截图脚本 —— 真实页面 + 红圈标注（移植 crmeb 手册流水线的 shots.py 思路）。
 * 场景按手册章节组织；标注 = 红圈 + 序号徽章（绝对定位浮层，不修改页面本身）。
 * 跑法：PLAYWRIGHT_MODULES=/tmp/pw/node_modules/ node manual/guide-shots.mjs
 */
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pw/node_modules/');
const { chromium } = require('playwright-core');

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
const BASE = process.env.BASE ?? 'http://127.0.0.1:5174';
const OUT = path.resolve(import.meta.dirname, 'images');
const USER = 'we-guide';
const PASS = 'Guide@2026';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

let seq = 0;
/** 在屏幕上画红圈+序号徽章。项：{ sel, text }（容器+文本）或 { sel }（纯选择器） */
async function annotate(items) {
  seq = 0;
  for (const it of items) {
    const loc = it.text
      ? page.locator(`${it.sel ?? ''}:has-text("${it.text}")`).first()
      : page.locator(it.sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await loc.boundingBox();
    if (!box) {
      console.log('  !! 找不到标注目标:', it.text ?? it.sel);
      continue;
    }
    seq += 1;
    await page.evaluate(
      ({ box, no }) => {
        const pad = 6;
        const c = document.createElement('div');
        c.className = 'anno-mark';
        c.style.cssText = `position:fixed;z-index:99999;pointer-events:none;
          left:${box.x - pad}px;top:${box.y - pad}px;width:${box.width + pad * 2}px;height:${box.height + pad * 2}px;
          border:3px solid #ff2b2b;background:rgba(255,43,43,.07);border-radius:6px;`;
        const b = document.createElement('div');
        b.className = 'anno-mark';
        b.textContent = String(no);
        b.style.cssText = `position:fixed;z-index:100000;pointer-events:none;
          left:${box.x - 14}px;top:${Math.max(box.y - 14, 2)}px;width:22px;height:22px;
          background:#ff2b2b;color:#fff;font:bold 13px/22px -apple-system,sans-serif;
          text-align:center;border-radius:50%;`;
        document.body.append(c, b);
      },
      { box, no: seq },
    );
  }
}

async function shot(name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('shot', name);
}
async function clearAnno() {
  await page.evaluate(() => {
    document.querySelectorAll('.anno-mark').forEach((e) => e.remove());
  });
}

// ---------- 场景 1：首页落地页，圈「去下单」 ----------
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await annotate([{ sel: 'button:has-text("去下单")' }]);
await shot('01-home.png');
await clearAnno();

// ---------- 场景 2：登录弹窗（顶栏登录按钮进入） ----------
await page.locator('.app-header button', { hasText: '登录' }).first().click();
await page.waitForTimeout(600);
await annotate([
  { sel: '.ant-modal .ant-tabs-tab', text: '注册' },
  { sel: '.ant-modal label', text: '用户名' },
  { sel: '.ant-modal label', text: '密码' },
  { sel: '.ant-modal button[type="submit"]' },
]);
await shot('02-login.png');
await clearAnno();

// ---------- 登录 ----------
await page.locator('.ant-modal input[autocomplete="username"]').fill(USER);
await page.locator('.ant-modal input[type="password"]').fill(PASS);
await page.locator('.ant-modal button[type="submit"]').click();
await page.waitForTimeout(1800);

// ---------- 场景 3：工单中心总览，圈「新建工单」 ----------
await page.goto(BASE + '/orders', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await annotate([{ sel: 'button:has-text("新建工单")' }]);
await shot('03-orders.png');
await clearAnno();

// ---------- 场景 4-6：新建工单抽屉 ----------
await page.locator('button', { hasText: '新建工单' }).first().click();
await page.waitForTimeout(800);
await annotate([{ sel: '.ant-drawer .ant-segmented-item:has-text("文档产出")' }]);
await shot('04-order-type.png');
await clearAnno();

await page.locator('.ant-drawer input#title').fill('毕业论文排版');
await page
  .locator('.ant-drawer textarea')
  .fill('请按学校模板排版：宋体小四、行距 24 磅、参考文献悬挂缩进，模板见附件。');
await page.waitForTimeout(300);
await annotate([
  { sel: '.ant-drawer label:has-text("标题")' },
  { sel: '.ant-drawer label:has-text("需求描述")' },
  { sel: '.ant-drawer label:has-text("参考附件")' },
]);
await shot('05-order-form.png');
await clearAnno();

// 上传一个演示附件（setInputFiles 不经系统弹窗）
const demo = path.join(OUT, '..', 'demo-attachment.docx');
(await import('node:fs')).writeFileSync(demo, Buffer.alloc(2048, 1));
await page.locator('.ant-drawer input[type="file"]').setInputFiles(demo);
await page.waitForTimeout(1500);
await annotate([
  { sel: '.ant-drawer .ant-form-item:has-text("参考附件")' },
  { sel: '.ant-drawer-footer button:has-text("提交订单")' },
]);
await shot('06-order-upload.png');
await clearAnno();

// 提交，等列表出现新单
await page.locator('.ant-drawer button', { hasText: '提交订单' }).click();
await page.waitForTimeout(2000);

// ---------- 场景 7：列表中的新单，圈状态标签 ----------
const firstCard = page.locator('.od-card').first();
const orderNo = (await firstCard.innerText()).match(/DO\d+/)?.[0] ?? '';
await annotate([{ sel: '.od-card' }]);
await shot('07-order-placed.png');
await clearAnno();
console.log('created order:', orderNo);

// ---------- 场景 8-9：详情（状态轨 + 取消） ----------
await firstCard.click();
await page.waitForTimeout(900);
await annotate([{ sel: '.od-rail-label', text: '已下单' }, { sel: '.od-rail-label', text: '制作中' }]);
await shot('08-detail-track.png');
await clearAnno();
await annotate([{ sel: 'button:has-text("取消工单")' }]);
await shot('09-detail-actions.png');
await clearAnno();

console.log('GUIDE SHOTS DONE, order =', orderNo);
await browser.close();
