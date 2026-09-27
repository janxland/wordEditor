/**
 * 桌面端桥 —— Electron 主进程通过 preload 注入 window.wordEditorDesktop：
 *   { localApiBase: 'http://127.0.0.1:<port>', cloudApiBase: 'https://word.roginx.ink' }
 *
 * 语义（云地分工，桌面端窗口加载的是本地全功能站点）：
 * - 管线类请求（模板/构建/导入/工具探测）：apiBase() 返回本地后端 → pandoc 本机干活；
 * - 业务类请求（登录/工单/下载中心）：apiFetch 对相对路径补 cloudApiBase → 打到云端，
 *   中心鉴权、工单库、下载中心全在云端，制作人机器不需要 Tailscale。
 * 非桌面环境（浏览器直接开云端/本地站点）本模块零影响。
 */

export interface DesktopBridge {
  localApiBase: string;
  cloudApiBase?: string;
  version?: string;
}

/** 只认本模块注入的形状，别处乱挂同名对象不认 */
function bridge(): DesktopBridge | null {
  const w = window as unknown as { wordEditorDesktop?: DesktopBridge };
  const b = w.wordEditorDesktop;
  return b && typeof b.localApiBase === 'string' && b.localApiBase.startsWith('http://127.0.0.1')
    ? b
    : null;
}

export function isDesktop(): boolean {
  return bridge() !== null;
}

/** 桌面端本地后端根（如 http://127.0.0.1:8787）；非桌面返回 null */
export function localApiOrigin(): string | null {
  return bridge()?.localApiBase ?? null;
}

/** 云端站点根（登录/工单/下载中心）；非桌面返回 null */
export function cloudApiOrigin(): string | null {
  return bridge()?.cloudApiBase ?? null;
}
