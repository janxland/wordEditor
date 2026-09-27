/**
 * 打包前准备运行时资源（幂等）：
 *   resources/runtime/api-node   —— 后端 dist + 生产依赖 + 一份 .env 模板
 *   resources/runtime/web/dist   —— 前端完整版（full）静态站点
 *   resources/pandoc             —— 平台对应的 pandoc（缺失时给出提示，不阻断打包）
 *
 * 跨平台：只用 node:fs / node:path，不依赖 shell；Windows 上同样可直接执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const runtimeDir = path.join(desktopDir, 'resources', 'runtime');

const copyDir = (src, dst) => {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};

function prepareBackend() {
  const src = path.join(repoRoot, 'services', 'api-node');
  const dst = path.join(runtimeDir, 'api-node');
  const dist = path.join(src, 'dist', 'main.js');
  if (!fs.existsSync(dist)) {
    throw new Error(`缺少后端产物 ${dist}，先在 services/api-node 跑 npm run build`);
  }
  copyDir(path.join(src, 'dist'), path.join(dst, 'dist'));
  fs.copyFileSync(path.join(src, 'package.json'), path.join(dst, 'package.json'));
  // 生产依赖必须进包（mysql2 / fastify 等），否则打包版后端 require 即崩
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = cp.spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'], {
    cwd: dst,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('runtime/api-node 生产依赖安装失败');
  // .env 只写模板，真实凭据由安装者填（不入库、不进包）；放在打包目录外，避免被打包器 walk
  fs.writeFileSync(
    path.join(desktopDir, 'env.example'),
    [
      '# 做单台本地后端配置（复制为 .env 后填写真实值，.env 不进分发包）',
      'WORDEDITOR_EDITION=full',
      '# 工单库：做单人机器通过 Tailscale/内网直连；留空则用默认值',
      'DOCORDER_DB_HOST=',
      'DOCORDER_DB_PORT=3306',
      'DOCORDER_DB_USER=wordeditor',
      'DOCORDER_DB_PASSWORD=',
      'DOCORDER_DB_NAME=wordeditor',
      'COS_SECRET_ID=',
      'COS_SECRET_KEY=',
      'COS_REGION=ap-chengdu',
      'COS_BUCKET=mybox-1257251314',
      'COS_CDN_BASE=https://cos.roginx.ink',
      'COS_WORKSPACE_PREFIX=wordeditor/docorder-temp',
      '',
    ].join('\n'),
  );
  console.log('[prepare] api-node:', dst);
}

function prepareWeb() {
  const src = path.join(repoRoot, 'apps', 'wordEditor-frontend', 'dist');
  const dst = path.join(runtimeDir, 'web', 'dist');
  if (!fs.existsSync(path.join(src, 'index.html'))) {
    throw new Error(`缺少前端产物 ${src}，先在 apps/wordEditor-frontend 跑 vite build（不要带 VITE_EDITION=cloud）`);
  }
  copyDir(src, dst);
  console.log('[prepare] web:', dst);
}

/** templates.json + contracts/openapi.json 是后端启动硬依赖（打包版 REPO_ROOT 指向 Resources） */
function prepareConfig() {
  for (const name of ['config/templates.json', 'contracts/openapi.json']) {
    const src = path.join(repoRoot, name);
    const dst = path.join(runtimeDir, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('[prepare]', name);
  }
}

function checkPandoc() {
  const dir = path.join(desktopDir, 'resources', 'pandoc');
  const exe = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  if (fs.existsSync(path.join(dir, exe))) {
    console.log('[prepare] pandoc 已就位:', path.join(dir, exe));
    return;
  }
  console.warn(`[prepare] 未内置 pandoc（${dir}）。分发包将依赖系统 pandoc，或先跑 npm run fetch:pandoc`);
}

fs.mkdirSync(runtimeDir, { recursive: true });
prepareBackend();
prepareWeb();
prepareConfig();
checkPandoc();
console.log('[prepare] 完成');
