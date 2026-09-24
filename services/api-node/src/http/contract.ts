/**
 * 接口契约层：contracts/openapi.json 是两个引擎共用的单一接口来源。
 *
 * 同一份文件既原样对外发布（AI Agent / Swagger UI 直接读），又给 Fastify 内置的 ajv
 * 当请求体校验规则用；契约一改，文档与校验同时跟着变。
 */
import fs from 'node:fs';
import path from 'node:path';

import { parseCached } from '../pipeline/file-cache.js';

interface Contract {
  /** 对外发布用的原始字节。 */
  bytes: Buffer;
  /** 请求体校验规则的来源。 */
  schemas: Record<string, object>;
}

function contract(repoRoot: string): Contract {
  return parseCached(path.join(repoRoot, 'contracts', 'openapi.json'), (file) => {
    const bytes = fs.readFileSync(file);
    const doc = JSON.parse(bytes.toString('utf-8')) as {
      components: { schemas: Record<string, object> };
    };
    return { bytes, schemas: doc.components.schemas };
  });
}

export function openapiBytes(repoRoot: string): Buffer {
  return contract(repoRoot).bytes;
}

export function bodySchema(repoRoot: string, name: string): object {
  return contract(repoRoot).schemas[name];
}

/**
 * 只把契约里的必填项交给 ajv（Fastify 内置校验器）：
 * 类型强转会把数字塞成字符串、空串与缺省也要分开判，这些语义留在处理函数里，
 * 框架只负责「字段在不在」，错误文案与 api-python 的手写检查同字。
 */
export function requiredSchema(
  repoRoot: string,
  name: string,
): { type: 'object'; required: string[] } {
  const { required } = bodySchema(repoRoot, name) as { required?: string[] };
  return { type: 'object', required: required ?? [] };
}

/** 契约目录下的其它静态发布物（人读的接口页）。 */
export function contractFile(repoRoot: string, name: string): Buffer {
  return parseCached(path.join(repoRoot, 'contracts', name), (file) => fs.readFileSync(file));
}
