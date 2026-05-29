import { create } from 'zustand';
import { notification } from 'antd';
import { importDocx, type ImportDocxEntry, type ImportDocxResult } from '@/kernel/pipeline';

interface ImportState {
  /** 上传中的源 docx 名 */
  sourceName: string;
  sourceSize: number;
  busy: boolean;
  lastError: string | null;

  result: ImportDocxResult | null;
  /** 用户在编辑器中修改后的 MD（与 result.markdown 解耦，便于二次编辑） */
  markdown: string;

  setMarkdown: (v: string) => void;
  reset: () => void;
  /** 将选择的 docx 文件提交给后端还原 */
  runImport: (file: File) => Promise<boolean>;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

export const useImportStore = create<ImportState>((set) => ({
  sourceName: '',
  sourceSize: 0,
  busy: false,
  lastError: null,
  result: null,
  markdown: '',

  setMarkdown: (markdown) => set({ markdown }),
  reset: () =>
    set({
      sourceName: '',
      sourceSize: 0,
      busy: false,
      lastError: null,
      result: null,
      markdown: '',
    }),

  runImport: async (file) => {
    if (!/\.docx$/i.test(file.name)) {
      notification.error({
        message: '只支持 .docx',
        placement: 'bottomRight',
      });
      return false;
    }
    set({ busy: true, lastError: null, result: null, markdown: '', sourceName: file.name, sourceSize: file.size });
    try {
      const buf = await file.arrayBuffer();
      const result = await importDocx({
        filename: file.name,
        contentBase64: arrayBufferToBase64(buf),
      });
      set({ result, markdown: result.markdown, busy: false });
      notification.success({
        message: '还原完成',
        description: `${result.fileName} · ${result.entries.length - 1} 张图片`,
        placement: 'bottomRight',
        duration: 3,
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ busy: false, lastError: msg });
      notification.error({
        message: '还原失败',
        description: msg,
        placement: 'bottomRight',
      });
      return false;
    }
  },
}));

/** 把 base64 转为 Blob URL（供图片预览/下载） */
export function entryToObjectUrl(entry: ImportDocxEntry, mime = 'application/octet-stream'): string {
  const bin = atob(entry.contentBase64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

export function guessMimeByExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'md':
      return 'text/markdown; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
