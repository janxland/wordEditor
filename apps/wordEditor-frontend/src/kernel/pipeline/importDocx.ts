/** DOCX → Markdown 还原管线（对接 dev-api /import/docx） */

export interface ImportDocxRequest {
  filename: string;
  /** docx 文件二进制 base64（不含 data: 前缀） */
  contentBase64: string;
  /** 可选：图片输出 slug，默认按文件名生成 */
  imageSlug?: string;
}

export interface ImportDocxEntry {
  /** POSIX 风格相对路径（含 'images/<slug>/x.png' 或入口 .md） */
  relPath: string;
  /** 二进制 base64 */
  contentBase64: string;
  /** 字节大小，便于 UI 展示 */
  size: number;
}

export interface ImportDocxResult {
  jobId: string;
  /** 入口 .md 文件名（已剥离 .docx 扩展） */
  fileName: string;
  /** 入口 md 在 entries 中的相对路径，可直接喂给 /build/stream */
  mdRelPath: string;
  /** 还原后的 Markdown 全文 */
  markdown: string;
  /** 所有产物（含 md 自身 + 图片），按出现顺序 */
  entries: ImportDocxEntry[];
  /** Python 端 stderr/stdout 截断日志，便于排查丢内容场景 */
  log?: string;
}

export async function importDocx(
  request: ImportDocxRequest,
  baseUrl = '/api',
): Promise<ImportDocxResult> {
  const res = await fetch(`${baseUrl}/import/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      msg = [j.error, j.detail].filter(Boolean).join('\n') || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as ImportDocxResult;
}
