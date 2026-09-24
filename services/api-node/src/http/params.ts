/**
 * 入参读取与校验的唯一口径：取值 → 收窄 → 判空/判形状，端点不各写一套。
 * 校验失败抛 HttpError：REST 端点直接抛给 server.ts 的中央错误处理发 {"detail": …}，
 * SSE 端点由自己的 catch 转成 error 帧——同一份校验，两种投递方式。
 *
 * 是否 strip 逐字段照抄 api-python：有的字段 strip 后才用，有的只判空白而把原值往下传。
 */
type Source = Record<string, unknown>;

/**
 * statusCode 这个属性名是给 Fastify 错误处理读的（`err.statusCode ?? 500`）。
 * 文案与 api-python 的 HTTPException 逐字对齐，两引擎互换时前端不用改。
 */
export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, message);

/** 两路入参的统一视图：Fastify 已把 query 拆成扁平对象，值都是字符串。 */
export const fromQuery = (req: { query: unknown }): Source => req.query as Source;
export const fromBody = (req: { body: unknown }): Source => (req.body ?? {}) as Source;

/** 可选值：只收窄成字符串，假值一律空串（`str(d.get(k) or "")`）。 */
export function strOf(source: Source, key: string): string {
  return String(source[key] || '');
}

/** 可选值 + 去空白：Python 侧 strip 之后才使用的字段（mdRelPath、template 查询参数）。 */
export function trimOf(source: Source, key: string): string {
  return strOf(source, key).trim();
}

/** 必填且以 strip 后的值继续（templateId：Python `str(...).strip()` 再判空）。 */
export function mustTrim(source: Source, key: string): string {
  const value = trimOf(source, key);
  if (!value) throw badRequest(`${key} is required`);
  return value;
}

/** 必填但原值下传（contentBase64、stylesYaml：Python 判的是 strip 后为空，用的却是不 trim 的原值）。 */
export function mustStr(source: Source, key: string): string {
  const value = strOf(source, key);
  if (!value.trim()) throw badRequest(`${key} is required`);
  return value;
}

/**
 * 值级形状校验（id / 文档名）：调用方自己决定进来前是否 strip——
 * /api/templates/reference-styles 会 strip，/api/docs 与 /api/build/download 不会。
 */
export function mustMatch(value: string, pattern: RegExp, message: string): string {
  if (!pattern.test(value)) throw badRequest(message);
  return value;
}
