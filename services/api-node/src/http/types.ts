/**
 * /api/* 的响应体形状。
 * 请求体不在这里建模：运行时口径以 contracts/openapi.json 为准（两端共用那份），
 * 读取与校验走 http/params.ts 的取值口，处理函数只拿自己关心的字段。
 */
export interface DownloadPayload {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}
