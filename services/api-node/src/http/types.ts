/**
 * /api/* 请求体的编译期视图。
 * 运行时契约与对外文档以 contracts/openapi.json 为准（两端共用那份）；这里只给处理函数做类型提示。
 */
import type { DocxProvenance } from '../pipeline/metadata.js';
import type { BuildOptions } from '../pipeline/types.js';

export interface UploadEntry {
  relPath: string;
  contentBase64: string;
}

export interface BuildRequestBody {
  markdown?: string;
  entries?: UploadEntry[];
  mdRelPath?: string;
  templateId?: string;
  fileName?: string;
  options?: BuildOptions;
  provenance?: DocxProvenance;
}

export interface ImportDocxRequestBody {
  filename?: string;
  contentBase64?: string;
  imageSlug?: string;
}

export interface PreviewStylesRequestBody {
  templateId?: string;
  stylesYaml?: string;
}

export interface DownloadPayload {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}
