import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_ALIASES: Record<string, string> = {
  'hutb-shared': 'hutb-guanke',
};

export const MAX_BODY_BYTES = 96 * 1024 * 1024;

export function resolveRepoRoot(): string {
  const envRoot = process.env.WORDEDITOR_REPO_ROOT;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const root = envRoot ? path.resolve(envRoot) : path.resolve(currentDir, '../../../..');
  const cfg = path.join(root, 'config', 'templates.json');
  if (!fs.existsSync(cfg)) {
    throw new Error(`Invalid repo root: ${root}, missing config/templates.json`);
  }
  return root;
}

export function resolvePort(): number {
  return Number(process.env.WORDEDITOR_PORT || 8787);
}

export function cacheDir(repoRoot: string): string {
  return path.join(repoRoot, '.cache', 'wordeditor-api-node');
}

export function findPandoc(): string | null {
  if (process.env.PANDOC && fs.existsSync(process.env.PANDOC)) return process.env.PANDOC;

  const whereCmd = process.platform === 'win32' ? 'where' : 'which';
  const whereArgs = ['pandoc'];
  try {
    const cp = require('node:child_process') as typeof import('node:child_process');
    const out = cp.spawnSync(whereCmd, whereArgs, { encoding: 'utf-8' });
    if (out.status === 0) {
      const first = out.stdout
        .split(/\r?\n/)
        .map((v: string) => v.trim())
        .find(Boolean);
      if (first) return first;
    }
  } catch {
    // ignore
  }

  const home = process.env.USERPROFILE || os.homedir();
  const fixed = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
    path.join(home, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
  ];

  for (const p of fixed) {
    if (fs.existsSync(p)) return p;
  }

  const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(winget)) return null;

  const stack = [winget];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.toLowerCase() === 'pandoc.exe') return full;
    }
  }
  return null;
}
