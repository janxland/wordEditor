/** 附件上传：与后端 docorder/routes.ts 的限制对齐（单文件 50MB、单次 ≤5 个） */
import { docOrderApi } from '@/services/docOrder';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface PendingAttachment {
  name: string;
  url: string;
  size?: number;
}

/**
 * 逐个上传（后端一次只收一个文件），返回可回填进 create / submit 的附件列表。
 * onStep 用于把「第几个 / 叫什么」显示到界面上 —— fetch 本身拿不到字节级进度。
 */
export async function uploadAll(
  files: File[],
  onStep?: (done: number, total: number, name: string) => void,
): Promise<PendingAttachment[]> {
  const out: PendingAttachment[] = [];
  for (let i = 0; i < files.length; i += 1) {
    onStep?.(i + 1, files.length, files[i].name);
    const r = await docOrderApi.upload(files[i]);
    out.push({ name: r.name, url: r.url, size: r.size });
  }
  return out;
}
