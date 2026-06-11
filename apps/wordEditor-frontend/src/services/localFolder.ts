import type { BuildUploadEntry } from '@/kernel/pipeline';

const ALLOWED_EXT = /\.(md|png|jpg|jpeg|gif|webp|svg|bmp|tiff?)$/i;

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(bin);
}

async function* walkDirectory(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ relPath: string; file: File }> {
  for await (const [name, entry] of dir.entries()) {
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'file') {
      yield { relPath, file: await (entry as FileSystemFileHandle).getFile() };
    } else if (entry.kind === 'directory') {
      yield* walkDirectory(entry as FileSystemDirectoryHandle, relPath);
    }
  }
}

export interface WorkspaceFolderLoadResult {
  handle: FileSystemDirectoryHandle;
  entries: BuildUploadEntry[];
  mdRelPath: string;
  mdText: string;
  label: string;
  skipped: number;
}

/** 通过 File System Access API 选择可读写的工作区文件夹并读取稿件 */
export async function loadWorkspaceFolder(
  handle: FileSystemDirectoryHandle,
): Promise<WorkspaceFolderLoadResult> {
  const all: { relPath: string; file: File }[] = [];
  for await (const item of walkDirectory(handle)) {
    all.push(item);
  }

  const filtered = all.filter(({ relPath }) => ALLOWED_EXT.test(relPath));
  const mdFiles = all.filter(({ relPath }) => /\.md$/i.test(relPath));
  if (mdFiles.length === 0) {
    throw new Error('文件夹中未找到 .md');
  }

  const md = mdFiles.slice().sort((a, b) => a.relPath.length - b.relPath.length)[0];
  const mdText = await md.file.text();

  const entries: BuildUploadEntry[] = [];
  for (const { relPath, file } of filtered) {
    const buf = await file.arrayBuffer();
    entries.push({ relPath, contentBase64: arrayBufferToBase64(buf) });
  }

  const totalBytes = filtered.reduce((s, { file }) => s + file.size, 0);
  const sizeLabel =
    totalBytes > 1024 * 1024
      ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.round(totalBytes / 1024)} KB`;
  const skipped = all.length - filtered.length;

  return {
    handle,
    entries,
    mdRelPath: md.relPath,
    mdText,
    label: `${md.file.name} · ${all.length} 个文件 · ${sizeLabel}`,
    skipped,
  };
}

/** 将 Blob 写入已授权的工作区文件夹 */
export async function saveBlobToWorkspaceFolder(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob,
): Promise<void> {
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('未获得文件夹写入权限');
  }

  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => undefined);
    throw e;
  }
}
