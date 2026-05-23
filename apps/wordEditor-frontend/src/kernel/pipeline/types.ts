/** MD → Word 管线请求/响应（与 dev-api /build/stream 对齐） */

export interface BuildOptions {
  noHtmlPipe?: boolean;
  noPostprocess?: boolean;
}

export interface BuildRequest {
  markdown: string;
  templateId: string;
  fileName?: string;
  options?: BuildOptions;
}

export interface BuildSuccess {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}

export interface PipelineStepMeta {
  id: string;
  label: string;
  description?: string;
}
