/** SSE 帧写出：与 app.py 的 _sse() 同格式。 */
import type { FastifyReply } from 'fastify';

/**
 * 心跳帧。一路构建可能几十秒不写字节，反代默认 read timeout（nginx 60s）会掐流。
 * 以 `:` 开头的行是 SSE 注释，前端的手写解析器（按 \n\n 切块、只认 event:/data:）会自然忽略。
 */
const HEARTBEAT = ':ping\n\n';
const HEARTBEAT_MS = 15_000;

/** 返回关闭函数：停心跳并结束响应。 */
export function beginSse(reply: FastifyReply): () => void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const timer = setInterval(() => reply.raw.write(HEARTBEAT), HEARTBEAT_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    reply.raw.end();
  };
}

export function writeSse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
