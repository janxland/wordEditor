/**
 * 做单台主进程：起本地后端（api-node full 形态）→ 等健康检查 → 窗口加载云端站点。
 *
 * 云地分工：登录 / 工单 / 下载中心都在 word.roginx.ink（云端鉴权），
 * 登录后前端把构建/导入/pandoc 管线请求重定向到本地后端（带 token，本地照常鉴权）。
 * 本地后端通过 WORDEDITOR_CORS_ORIGIN 放行云端 origin（见 http/cors.ts）。
 *
 * 跨平台约束（Windows / macOS 都走同一条路径）：
 * 1. 路径一律 path.join，不拼 '/'；子进程一律 spawn(exec, args)，shell 恒为 false。
 * 2. 不加任何 macOS 专属 API；Windows 上可执行文件补 .exe。
 * 3. 后端起不来也要把窗口开出来（显示诊断页），保证「能启动」而不是黑屏。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';

const isPackaged = app.isPackaged;
const RESOURCES = isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');

/** 云端站点：登录 / 工单 / 下载中心都在这里（可用 WORDEDITOR_CLOUD_URL 覆盖） */
const cloudUrl = (): string => (process.env.WORDEDITOR_CLOUD_URL ?? 'https://word.roginx.ink/').trim();

/** 运行时资源定位：打包后在 resources/，开发时回落到仓库内真实目录 */
const runtime = {
  backendDir: isPackaged
    ? path.join(RESOURCES, 'api-node')
    : path.resolve(__dirname, '..', '..', '..', 'services', 'api-node'),
  webDir: isPackaged
    ? path.join(RESOURCES, 'web', 'dist')
    : path.resolve(__dirname, '..', '..', '..', 'apps', 'wordEditor-frontend', 'dist'),
  pandocDir: isPackaged
    ? path.join(RESOURCES, 'pandoc')
    : path.resolve(__dirname, '..', '..', '..', '.tools', 'pandoc-3.9-arm64', 'bin'),
};

const logLines: string[] = [];
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.log(line);
}

/** 端口占用检测：占用就换下一个（多开/端口冲突时不至于白屏）。
 *  必须绑全接口探测——只绑 127.0.0.1 会被「别人绑了 0.0.0.0:8787」骗过，
 *  spawn 出来的真后端 EADDRINUSE 退出，健康检查还误判成自己健康。 */
function freePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number): void => {
      if (port > start + 50) return resolve(start);
      const server = net.createServer();
      server.once('error', () => {
        server.close();
        tryPort(port + 1);
      });
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port); // 不指定 host = 绑全部接口，任何形式的占用都探得出来
    };
    tryPort(start);
  });
}

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

async function waitHealth(url: string, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 后端还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let backend: ChildProcess | null = null;
let backendReadyResolve: ((ok: boolean) => void) | null = null;

function startBackend(port: number): { ok: boolean; reason?: string } {
  const entry = path.join(runtime.backendDir, 'dist', 'main.js');
  if (!fs.existsSync(entry)) {
    return { ok: false, reason: `找不到后端入口：${entry}` };
  }
  const env = { ...process.env };
  // 在 Electron 主进程里 process.execPath 是 Electron 二进制，必须强制当 Node 跑
  env.ELECTRON_RUN_AS_NODE = '1';
  env.WORDEDITOR_PORT = String(port);
  env.WORDEDITOR_EDITION = 'full';
  // 中心鉴权强制开启：做单台必须先登录（AuthCenter，走 edu.roginx.ink 公网入口，
  // 见 docorder/auth.ts），未登录时所有业务接口 401，前端自动弹登录框
  env.WORDEDITOR_AUTH = 'on';
  env.WORDEDITOR_WEB_DIR = runtime.webDir;
  env.WORDEDITOR_REPO_ROOT = isPackaged ? RESOURCES : path.join(runtime.backendDir, '..', '..');
  // 云端站点要跨源调本地后端做管线，放行云端 origin（见 http/cors.ts）
  env.WORDEDITOR_CORS_ORIGIN = env.WORDEDITOR_CORS_ORIGIN ?? cloudUrl();
  // 自带 pandoc 优先：直接前置到 PATH，Windows 与 macOS 用同一份逻辑
  const pandocBin = path.join(runtime.pandocDir, exe('pandoc'));
  if (fs.existsSync(pandocBin)) {
    env.PATH = `${runtime.pandocDir}${path.delimiter}${env.PATH ?? ''}`;
  }
  try {
    backend = spawn(process.execPath, [entry], {
      cwd: runtime.backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    backend.stdout?.on('data', (b) => {
      const line = String(b).trim();
      log(`api ${line}`);
      // main.ts listen 成功后会打 `http://localhost:<port>  repo=...`，
      // 以它为准 —— 端口被别人占了时 /api/health 会被占位者顶替，误判健康
      if (line.includes(`http://localhost:${port}`) && backendReadyResolve) {
        backendReadyResolve(true);
        backendReadyResolve = null;
      }
    });
    backend.stderr?.on('data', (b) => log(`api! ${String(b).trim()}`));
    backend.on('exit', (code) => {
      log(`后端退出 code=${code}`);
      if (backendReadyResolve) {
        backendReadyResolve(false);
        backendReadyResolve = null;
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function waitBackendReady(timeoutMs = 30000): Promise<boolean> {
  if (backend && backend.exitCode !== null) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      backendReadyResolve = null;
      resolve(ok);
    };
    backendReadyResolve = done;
    // 抢占式兜底：等待期间进程挂了/超时都算失败
    const poll = setInterval(() => {
      if (backend && backend.exitCode !== null) {
        clearInterval(poll);
        done(false);
      }
    }, 300);
    setTimeout(() => {
      clearInterval(poll);
      done(false);
    }, timeoutMs);
  });
}

function diagnosticPage(title: string, detail: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
  <body style="font:14px/1.7 -apple-system,Segoe UI,Microsoft YaHei,sans-serif;padding:32px;max-width:760px;margin:auto">
  <h2>${title}</h2><pre style="white-space:pre-wrap;background:#f6f8fa;padding:16px;border-radius:8px">${detail.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</pre>
  <p>关闭本窗口后可在日志中查看完整输出。</p></body>`;
}

async function createWindow(url: string | null, detail: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      // 注入本地后端地址（前端据此把管线请求重定向到本机）；站点是远程页面，不给 node 集成
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 外链一律交系统浏览器，桌面端不内置多标签（Electron 31 起用 setWindowOpenHandler）
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  if (url) {
    await win.loadURL(url);
  } else {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(diagnosticPage('WordEditor 做单台启动异常', detail)),
    );
  }
  return win;
}

const smoke = process.argv.includes('--smoke');

app.whenReady().then(async () => {
  // 端口探测只是初筛；真正的判据是「后端自己报 listen 成功」。
  // 被占（比如本地 dev 后端在跑）就 EADDRINUSE 退出 → 自动换下一个端口重试。
  let port = await freePort(Number(process.env.WORDEDITOR_DESKTOP_PORT ?? 8787));
  let started: { ok: boolean; reason?: string } = { ok: false, reason: '未启动' };
  let ready = false;
  for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
    started = startBackend(port);
    if (!started.ok) break;
    ready = await waitBackendReady();
    if (!ready && backend && backend.exitCode !== null) {
      port += 1; // 大概率端口被占，换一个再来
      log(`端口 ${port - 1} 起不来，换 ${port} 重试`);
    }
  }
  process.env.WORDEDITOR_LOCAL_API_BASE = `http://127.0.0.1:${port}`;
  // 窗口加载本地全功能站点（full 前端由本地后端静态托管）：
  // 制作人能看到模板工作台/导出/还原全部 Tab；登录/工单/下载中心由前端
  // （apiFetch 相对路径 → cloudApiBase）自动打向云端，中心鉴权不受影响。
  // 本地后端离线时才回退云端站点（此时只能看工单，管线不可用）。
  const target = ready ? `http://127.0.0.1:${port}/` : cloudUrl();
  const win = await createWindow(target, started.ok ? '' : started.reason ?? '');
  log(`窗口已加载：${target}（本地后端 ${ready ? '就绪' : '离线，已回退云端'}，端口 ${port}）`);

  if (smoke) {
    await new Promise((r) => setTimeout(r, 3000));
    const shot = path.join(app.getPath('temp'), 'wordeditor-desktop-smoke.png');
    const image = await win.webContents.capturePage();
    fs.writeFileSync(shot, image.toPNG());
    log(`冒烟截图：${shot}`);
    if (!ready) {
      dialog.showErrorBox('本地后端启动失败', started.reason ?? logLines.slice(-20).join('\n'));
    }
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // macOS 习惯：关窗不退出；Windows/Linux 关窗即退出
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backend && !backend.killed) backend.kill();
});
