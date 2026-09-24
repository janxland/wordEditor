/** /api/* 请求体契约（与 app.py 一致）。 */
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
