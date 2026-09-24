/** 子进程封装：所有外部工具（Pandoc / 备用 Python 引擎）都走这里。 */
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
    const streams = ['stdout', 'stderr'] as const;
    type Stream = (typeof streams)[number];
    /** 逐块 toString 会把跨块的 UTF-8 序列解成 U+FFFD，必须用 StringDecoder 接续半个字符。 */
    const decoders: Record<Stream, StringDecoder> = {
      stdout: new StringDecoder('utf8'),
      stderr: new StringDecoder('utf8'),
    };
    const text: Record<Stream, string> = { stdout: '', stderr: '' };
    const partial: Record<Stream, string> = { stdout: '', stderr: '' };

    const push = (stream: Stream, chunk: string): void => {
      text[stream] += chunk;
      const lines = (partial[stream] + chunk).split(/\r?\n/);
      partial[stream] = lines.pop() ?? '';
      for (const line of lines) options.onLine?.(stream, line);
    };

    for (const stream of streams) {
      child[stream].on('data', (d: Buffer) => push(stream, decoders[stream].write(d)));
    }
    child.on('error', (err) => {
      text.stderr += `${err.message}\n`;
      options.onLine?.('stderr', `无法启动 ${command}: ${err.message}`);
      resolve({ code: 1, stdout: text.stdout, stderr: text.stderr });
    });
    child.on('close', (code) => {
      for (const stream of streams) {
        push(stream, decoders[stream].end());
        // 末行没有换行也要回报一次，与逐行日志的既有口径一致。
        const rest = partial[stream];
        partial[stream] = '';
        if (rest.trim()) options.onLine?.(stream, rest);
      }
      resolve({ code: code ?? 1, stdout: text.stdout, stderr: text.stderr });
    });

    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}
