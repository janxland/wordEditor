/**
 * HTTP 错误出口：与 FastAPI HTTPException 同构，即 {"detail": msg}。
 * 全服务只有 fail() 这一处写错误体，其余地方一律抛 HttpError。
 */
import type { FastifyReply } from 'fastify';

import { HttpError } from './params.js';

export function fail(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ detail: message });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 500 的文案口径同 Python：「<标签>\n<详情>」，详情为空时只留标签。 */
export function serverError(label: string, e: unknown): HttpError {
  return new HttpError(500, `${label}\n${errorMessage(e)}`.trim());
}
