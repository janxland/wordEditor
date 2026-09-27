/**
 * 桌面端 preload：往页面注入本地后端地址。
 * 云端站点（word.roginx.ink）据此把管线请求重定向到本机 pandoc 管线（见前端 desktopBridge.ts）。
 * 只暴露一个只读对象，不给 Node 能力；contextIsolation 保持开启。
 */
import { contextBridge } from 'electron';

const localApiBase = process.env.WORDEDITOR_LOCAL_API_BASE ?? '';
const cloudApiBase = (process.env.WORDEDITOR_CLOUD_URL ?? 'https://word.roginx.ink').trim().replace(/\/$/, '');

contextBridge.exposeInMainWorld('wordEditorDesktop', {
  localApiBase,
  cloudApiBase,
  version: process.env.WORDEDITOR_DESKTOP_VERSION ?? '',
});
