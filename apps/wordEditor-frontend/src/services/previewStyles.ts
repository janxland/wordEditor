import { fetchAsBlob } from './download';

export interface StylePreviewRequest {
  templateId: string;
  stylesYaml: string;
}

interface StylePreviewMeta {
  jobId: string;
  fileName: string;
  downloadUrl: string;
}

async function requestStylePreview(
  req: StylePreviewRequest,
  baseUrl = '/api',
): Promise<StylePreviewMeta> {
  const res = await fetch(`${baseUrl}/preview/styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const data = (await res.json()) as StylePreviewMeta & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error([data.error, data.detail].filter(Boolean).join('\n') || `HTTP ${res.status}`);
  }
  return data;
}

/** 生成样式预览 docx 并返回二进制（供在线渲染） */
export async function fetchStylePreviewBlob(
  req: StylePreviewRequest,
  baseUrl = '/api',
): Promise<{ blob: Blob; fileName: string; downloadUrl: string }> {
  const meta = await requestStylePreview(req, baseUrl);
  const blob = await fetchAsBlob(meta.downloadUrl);
  return { blob, fileName: meta.fileName, downloadUrl: meta.downloadUrl };
}
