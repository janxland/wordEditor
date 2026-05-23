import type { BuildRequest, BuildSuccess } from './types';

export interface BuildStreamStepEvent {
  id: string;
  status: 'wait' | 'process' | 'finish' | 'error';
  message?: string;
}

export interface BuildStreamHandlers {
  onStep?: (event: BuildStreamStepEvent) => void;
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
}

function parseSseBlock(block: string, handlers: BuildStreamHandlers): BuildSuccess | null | 'error' {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;

  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (event === 'step' && handlers.onStep) {
      handlers.onStep(payload as unknown as BuildStreamStepEvent);
    } else if (event === 'log' && handlers.onLog) {
      const line = String(payload.line ?? '');
      const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout';
      handlers.onLog(line, stream);
    } else if (event === 'done') {
      return payload as unknown as BuildSuccess;
    } else if (event === 'error') {
      const err = new Error(String(payload.error ?? 'build failed'));
      (err as Error & { detail?: string; jobId?: string }).detail = payload.detail as
        | string
        | undefined;
      (err as Error & { jobId?: string }).jobId = payload.jobId as string | undefined;
      throw err;
    }
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
  return null;
}

/** 通过 SSE 流式构建，实时推送步骤与日志 */
export async function streamBuild(
  baseUrl: string,
  request: BuildRequest,
  handlers: BuildStreamHandlers = {},
): Promise<BuildSuccess> {
  const res = await fetch(`${baseUrl}/build/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      msg = [j.error, j.detail].filter(Boolean).join('\n') || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: BuildSuccess | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const parsed = parseSseBlock(chunk.trim(), handlers);
      if (parsed && typeof parsed === 'object' && 'downloadUrl' in parsed) {
        result = parsed;
      }
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer.trim(), handlers);
    if (parsed && typeof parsed === 'object' && 'downloadUrl' in parsed) result = parsed;
  }

  if (!result) throw new Error('构建流意外结束，未收到完成事件');
  return result;
}
