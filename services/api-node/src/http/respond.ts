/** HTTP 错误体：与 FastAPI HTTPException 同构，即 {"detail": msg}。 */
import type { FastifyReply } from 'fastify';

export function fail(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ detail: message });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
