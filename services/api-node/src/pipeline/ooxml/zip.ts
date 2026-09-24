/** docx 部件级改写：等价于 pipeline/ooxml_util.py:patch_docx_parts。 */
import fs from 'node:fs';

import type JSZip from 'jszip';

/** 入参为该部件原文（部件不存在时为 null）；返回 null 表示不改动该部件。 */
export type PartPatch = (source: string | null) => string | null;

type JsZipCtor = typeof import('jszip');
let jszipCtor: JsZipCtor | null = null;

/**
 * 只有真要开包时才 import jszip：它是全服务里最重的第三方模块（实测单独 import 就多
 * 占 ~10 MB RSS，而启动 63 MB 里约 1/6）。只查模板/健康/契约的部署因此不必为它买单。
 */
async function jszip(): Promise<JsZipCtor> {
  return (jszipCtor ??= (await import('jszip')).default);
}

/**
 * 一次构建共用一个已载入的包：部件读改写全在内存里，磁盘只在 flush 时写一次。
 * 旧写法是每个阶段各自 load→改→DEFLATE 整包，一次构建要读 13 遍、重压缩 7 遍
 * （word/media 跟着白压 7 次），实测每多一个阶段峰值 RSS 就多 11~15 MB。
 */
export interface DocxSession {
  listParts(): Promise<string[]>;
  readPart(part: string): Promise<string | null>;
  /** 一次读取多个部件；不存在的部件为 null。 */
  readParts(parts: string[]): Promise<Map<string, string | null>>;
  /** 一次读取多个二进制部件（word/media/*）；不存在的部件为 null。 */
  readPartsBytes(parts: string[]): Promise<Map<string, Buffer | null>>;
  /** 一次性改写多个部件；新部件（如缺失的 numbering.xml）会被创建。 */
  patch(patches: Record<string, PartPatch>): Promise<void>;
  /** 有改动才落盘；无改动时连读入都省掉。 */
  flush(): Promise<void>;
}

export async function openDocxSession(docxPath: string): Promise<DocxSession> {
  let loading: Promise<JSZip> | null = null;
  let dirty = false;
  /** 惰性载入 + 只载一次：并发调用共享同一个载入 Promise，不会各解一遍整包。 */
  const open = (): Promise<JSZip> =>
    (loading ??= jszip().then((ctor) => ctor.loadAsync(fs.readFileSync(docxPath))));

  const readParts = async (parts: string[]): Promise<Map<string, string | null>> => {
    const z = await open();
    const out = new Map<string, string | null>();
    for (const part of parts) {
      const file = z.file(part);
      out.set(part, file ? await file.async('string') : null);
    }
    return out;
  };

  const session: DocxSession = {
    async listParts() {
      const names: string[] = [];
      const z = await open();
      z.forEach((name) => names.push(name));
      return names;
    },

    async readPart(part) {
      return (await readParts([part])).get(part) ?? null;
    },

    readParts,

    async readPartsBytes(parts) {
      const z = await open();
      const out = new Map<string, Buffer | null>();
      for (const part of parts) {
        const file = z.file(part);
        out.set(part, file && !file.dir ? Buffer.from(await file.async('nodebuffer')) : null);
      }
      return out;
    },

    async patch(patches) {
      const z = await open();
      for (const [part, patch] of Object.entries(patches)) {
        const file = z.file(part);
        const source = file ? await file.async('string') : null;
        const next = patch(source);
        if (next === null || next === undefined) continue;
        if (next === source) continue;
        z.file(part, next);
        dirty = true;
      }
    },

    async flush() {
      if (!dirty || !loading) return;
      dirty = false;
      const zip = await loading;
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      fs.writeFileSync(docxPath, buffer);
    },
  };
  return session;
}

/** 以下一次性入口保持原契约：自行开关会话，供单次读写的调用方（extract / reference-styles）使用。 */
export async function listParts(docxPath: string): Promise<string[]> {
  return openDocxSession(docxPath).then((s) => s.listParts());
}

export async function readParts(
  docxPath: string,
  parts: string[],
): Promise<Map<string, string | null>> {
  return openDocxSession(docxPath).then((s) => s.readParts(parts));
}

export async function readPart(docxPath: string, part: string): Promise<string | null> {
  return (await readParts(docxPath, [part])).get(part) ?? null;
}

export async function readPartsBytes(
  docxPath: string,
  parts: string[],
): Promise<Map<string, Buffer | null>> {
  return openDocxSession(docxPath).then((s) => s.readPartsBytes(parts));
}

export async function patchDocxParts(
  docxPath: string,
  patches: Record<string, PartPatch>,
): Promise<void> {
  const session = await openDocxSession(docxPath);
  await session.patch(patches);
  await session.flush();
}
