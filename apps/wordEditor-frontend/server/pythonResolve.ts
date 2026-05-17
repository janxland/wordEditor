import { execSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface PythonLauncher {
  command: string;
  prefixArgs: string[];
}

let cached: PythonLauncher | null = null;

function isStoreStub(filePath: string): boolean {
  return /WindowsApps[\\/]+python/i.test(filePath);
}

function canRun(bin: string, prefixArgs: string[] = []): boolean {
  try {
    execSync([bin, ...prefixArgs, '--version'].join(' '), {
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** 解析可用的 Python（Conda / where python / python / py），结果缓存 */
export function resolvePython(): PythonLauncher {
  if (cached) return cached;

  const candidates: PythonLauncher[] = [];

  if (process.env.WORDEDITOR_PYTHON) {
    candidates.push({ command: process.env.WORDEDITOR_PYTHON, prefixArgs: [] });
  }

  if (process.env.CONDA_PREFIX) {
    const condaPy = path.join(
      process.env.CONDA_PREFIX,
      process.platform === 'win32' ? 'python.exe' : 'bin/python',
    );
    candidates.push({ command: condaPy, prefixArgs: [] });
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where.exe python' : 'which python3';
    const lines = execSync(whichCmd, { encoding: 'utf-8', env: process.env })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !isStoreStub(l));
    for (const line of lines) {
      candidates.push({ command: line, prefixArgs: [] });
    }
  } catch {
    /* where/which 不可用 */
  }

  if (process.platform === 'win32') {
    candidates.push({ command: 'python', prefixArgs: [] });
    candidates.push({ command: 'py', prefixArgs: ['-3'] });
  } else {
    candidates.push({ command: 'python3', prefixArgs: [] });
  }

  for (const c of candidates) {
    if (!c.command) continue;
    if (c.command.includes(path.sep) && !fs.existsSync(c.command)) continue;
    if (canRun(c.command, c.prefixArgs)) {
      cached = c;
      return c;
    }
  }

  cached = { command: process.platform === 'win32' ? 'python' : 'python3', prefixArgs: [] };
  return cached;
}

export function pythonSpawnArgs(scriptArgs: string[]): { command: string; args: string[] } {
  const { command, prefixArgs } = resolvePython();
  return { command, args: [...prefixArgs, ...scriptArgs] };
}

export function spawnPython(
  scriptArgs: string[],
  options: SpawnOptions,
): ChildProcess {
  const { command, args } = pythonSpawnArgs(scriptArgs);
  const child = spawn(command, args, options);
  return child;
}
