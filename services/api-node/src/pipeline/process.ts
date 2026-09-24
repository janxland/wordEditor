/** 子进程封装：所有外部工具（Pandoc / 备用 Python 引擎）都走这里。 */
import { spawn } from 'node:child_process';

export type LineHandler = (stream: 'stdout' | 'stderr', line: string) => void;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: string; onLine?: LineHandler },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env });
    const result: RunResult = { code: 1, stdout: '', stderr: '' };
    const buffers = { stdout: '', stderr: '' };

    const push = (stream: 'stdout' | 'stderr', chunk: string): void => {
      const lines = (buffers[stream] + chunk).split(/\r?\n/);
      buffers[stream] = lines.pop() ?? '';
      for (const line of lines) {
        if (stream === 'stdout') result.stdout += `${line}\n`;
        else result.stderr += `${line}\n`;
        options.onLine?.(stream, line);
      }
    };

    child.stdout.on('data', (d: Buffer) => push('stdout', d.toString()));
    child.stderr.on('data', (d: Buffer) => push('stderr', d.toString()));
    child.on('error', (err) => {
      result.stderr += `${err.message}\n`;
      options.onLine?.('stderr', `无法启动 ${command}: ${err.message}`);
      resolve(result);
    });
    child.on('close', (code) => {
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = buffers[stream].trim();
        if (!rest) continue;
        if (stream === 'stderr') result.stderr += `${rest}\n`;
        options.onLine?.(stream, rest);
      }
      result.code = code ?? 1;
      resolve(result);
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

/** 需要拿到 stdout 文本（如 --json 输出）时使用。 */
export async function runJson<T>(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<T> {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `exit ${result.code}`);
  return JSON.parse(result.stdout) as T;
}
