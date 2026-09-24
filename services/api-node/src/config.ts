/** 进程级配置：仓库根、端口、任务缓存目录、外部工具探测。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_BODY_BYTES = 96 * 1024 * 1024;

/** 单个上传条目的上限（base64 长度 ≈ 原始体积 × 1.37） */
export const MAX_ENTRY_B64_CHARS = Math.round(20 * 1024 * 1024 * 1.37);

/** 从本文件位置上溯找仓库根（以 config/templates.json 为标记），src 与 dist 两种落点都适用。 */
export function resolveRepoRoot(): string {
  if (process.env.WORDEDITOR_REPO_ROOT) {
    const root = path.resolve(process.env.WORDEDITOR_REPO_ROOT);
    if (!fs.existsSync(path.join(root, 'config', 'templates.json'))) {
      throw new Error(`WORDEDITOR_REPO_ROOT 无效: ${root} 缺少 config/templates.json`);
    }
    return root;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(dir, 'config', 'templates.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('无法定位仓库根：请设置 WORDEDITOR_REPO_ROOT');
}

export function resolvePort(): number {
  return Number(process.env.WORDEDITOR_PORT || process.env.WORDEDITOR_PY_PORT || 8787);
}

export function resolveCacheDir(repoRoot: string): string {
  return path.join(repoRoot, '.cache', 'wordeditor-api-node');
}

/** 存在且是普通文件（Python 侧 `Path.is_file()` 口径，目录不算命中）。 */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function which(bin: string): string | null {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const out = spawnSync(probe, [bin], { encoding: 'utf-8' });
  if (out.status !== 0) return null;
  return (
    out.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function walkFor(dir: string, fileName: RegExp): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && fileName.test(entry.name)) return full;
    if (entry.isDirectory()) {
      const nested = walkFor(full, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

/** 与 pipeline/tool_paths.py 等价的 Pandoc 定位。 */
function probePandoc(repoRoot: string): string | null {
  const envPath = process.env.PANDOC;
  if (envPath && isFile(envPath)) return envPath;

  const onPath = which('pandoc');
  if (onPath) return onPath;

  const exe = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  const toolsDir = path.join(repoRoot, '.tools');
  if (fs.existsSync(toolsDir)) {
    for (const pkg of fs.readdirSync(toolsDir).sort()) {
      if (!/pandoc/i.test(pkg)) continue;
      const base = path.join(toolsDir, pkg);
      for (const rel of [['bin', exe], [exe], ['bin', 'pandoc.exe'], ['bin', 'pandoc']]) {
        const candidate = path.join(base, ...rel);
        if (isFile(candidate)) return candidate;
      }
    }
  }

  const home = os.homedir();
  const fixed = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files (x86)', 'Pandoc', 'pandoc.exe'),
    path.join(home, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
    path.join(home, 'homebrew/bin/pandoc'),
    path.join(home, '.linuxbrew/bin/pandoc'),
    '/opt/homebrew/bin/pandoc',
    '/usr/local/bin/pandoc',
    '/usr/bin/pandoc',
  ];
  for (const candidate of fixed) {
    if (isFile(candidate)) return candidate;
  }

  const winGet = path.join(home, 'AppData', 'Local/Microsoft/WinGet/Packages');
  if (fs.existsSync(winGet)) {
    for (const pkg of fs.readdirSync(winGet).sort()) {
      if (!/pandoc/i.test(pkg)) continue;
      const found = walkFor(path.join(winGet, pkg), /^pandoc\.exe$/i);
      if (found) return found;
    }
  }

  for (const candidate of [
    path.join(home, 'scoop/apps/pandoc/current/pandoc.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\pandoc.exe',
  ]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** 供子进程（Pandoc / 备用 Python）使用的环境变量。 */
export function childEnv(repoRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  const pandoc = findPandoc(repoRoot);
  if (pandoc) {
    env.PATH = `${path.dirname(pandoc)}${path.delimiter}${env.PATH ?? ''}`;
    env.PANDOC ||= pandoc;
  }
  return env;
}

let pandocHit: string | null = null;

/** 探测是 `which` + 文件系统遍历，每次构建跑一遍纯属浪费；命中即记住。 */
export function findPandoc(repoRoot: string): string | null {
  if (pandocHit && isFile(pandocHit)) return pandocHit;
  const found = probePandoc(repoRoot);
  if (found) pandocHit = found;
  return found;
}
