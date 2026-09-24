/**
 * SSE 通道层：心跳、帧字节、step/log/done/error 的字段名都归这里，
 * 与 app.py 的 `_sse()` 逐字节一致；路由只做编排，不再手拼帧。
 */
import type { FastifyReply } from 'fastify';

import type { PipelineEvent, StepId, StepStatus } from '../pipeline/types.js';

/**
 * 心跳帧。一路构建可能几十秒不写字节，反代默认 read timeout（nginx 60s）会掐流。
 * 以 `:` 开头的行是 SSE 注释，前端的手写解析器（按 \n\n 切块、只认 event:/data:）会自然忽略。
 */
const HEARTBEAT = ':ping\n\n';
const HEARTBEAT_MS = 15_000;

export interface SseChannel {
  /** 管线事件（step/log）按字段名转帧。 */
  emit(event: PipelineEvent): void;
  /** 路由自己阶段的 step 帧（如写输入的 prepare）。 */
  step(id: StepId, status: StepStatus, message?: string): void;
  done(payload: unknown): void;
  fail(message: string): void;
  /** 停心跳并结束响应。 */
  close(): void;
}

export function openSse(reply: FastifyReply): SseChannel {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const timer = setInterval(() => reply.raw.write(HEARTBEAT), HEARTBEAT_MS);
  timer.unref();

  const write = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端断开后 socket 已死：心跳照发就是每 15s 一次无效写（Node 对坏管道
  // 每次报一个 ERR_STREAM_WRITE_AFTER_END 进日志）。构建本身的语义不动——
  // Python 生成器同样会把产物做完，这里只止住纯粹的僵尸心跳。
  reply.raw.on('close', () => clearInterval(timer));

  return {
    emit: (event) =>
      event.type === 'step'
        ? write('step', { id: event.id, status: event.status, message: event.message })
        : write('log', { line: event.line, stream: event.stream }),
    step: (id, status, message) => write('step', { id, status, message }),
    done: (payload) => write('done', payload),
    fail: (message) => write('error', { error: message }),
    close: () => {
      clearInterval(timer);
      reply.raw.end();
    },
  };
}
