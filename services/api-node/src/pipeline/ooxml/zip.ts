/** docx 部件级改写：等价于 pipeline/ooxml_util.py:patch_docx_parts。 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import type JSZip from 'jszip';

/** 入参为该部件原文（部件不存在时为 null）；返回 null 表示不改动该部件。 */
export type PartPatch = (source: string | null) => string | null;

type JsZipCtor = typeof import('jszip');
let jszipCtor: JsZipCtor | null = null;

/**
 * 首次真要开包时才 import jszip。摊薄后它只占约 1 MB，但「用不到的模块不常驻」
 * 是本服务的部署前提：只查模板/健康/契约的进程不该为 docx 引擎付钱。
 */
async function jszip(): Promise<JsZipCtor> {
  return (jszipCtor ??= (await import('jszip')).default);
}

/**
 * 一次构建共用一个已载入的包：部件读改写全在内存里，磁盘只在 flush 时写一次。
 * 旧写法每阶段各自 load→改→DEFLATE 整包（读 13 遍、重压缩 7 遍，word/media 跟着白压），
 * 实测每多一个阶段峰值 RSS 多 11~15 MB。
 */
export interface DocxSession {
  listParts(): Promise<string[]>;
  readPart(part: string): Promise<string | null>;
  /** 一次读取多个部件；不存在的部件为 null。 */
  readParts(parts: string[]): Promise<Map<string, string | null>>;
  /** 一次改写多个部件；新部件（如缺失的 numbering.xml）会被创建。 */
  patch(patches: Record<string, PartPatch>): Promise<void>;
  /**
   * 单张读取二进制部件（word/media/*）：不缓存——调用方都是「读一张落一张」，
   * 批量版会把全部媒体原始字节同时按住到函数结束，峰值 = 媒体总体积。
   */
  readPartBytes(part: string): Promise<Buffer | null>;
  /** 写入二进制部件（word/media/*）：封面块搬运图片时用。 */
  writePartBytes(part: string, data: Buffer): Promise<void>;
  /** 有改动才落盘；无改动时连读入都省掉。 */
  flush(): Promise<void>;
}

export async function openDocxSession(docxPath: string): Promise<DocxSession> {
  let loading: Promise<JSZip> | null = null;
  let dirty = false;
  /**
   * 文本部件解码缓存：document.xml 在一次构建里被 4 个阶段读、又被 patch 为做
   * 「改没改」比较回读同样多次，旧写法每个版本都要重新 inflate + utf8 解码整段。
   * patch 写入时同步作废/更新，读到的永远是当前版本；媒体二进制不走这里（一张一次，缓存只会占内存）。
   */
  const textCache = new Map<string, string>();
  /** 惰性载入 + 只载一次：并发调用共享同一个载入 Promise，不会各解一遍整包。 */
  const open = (): Promise<JSZip> =>
    (loading ??= jszip().then((ctor) => ctor.loadAsync(fs.readFileSync(docxPath))));

  const readParts = async (parts: string[]): Promise<Map<string, string | null>> => {
    const z = await open();
    const out = new Map<string, string | null>();
    for (const part of parts) {
      if (textCache.has(part)) {
        out.set(part, textCache.get(part)!);
        continue;
      }
      const file = z.file(part);
      const value: string | null = file ? await file.async('string') : null;
      if (value !== null) textCache.set(part, value);
      out.set(part, value);
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

    async readPartBytes(part) {
      const z = await open();
      const file = z.file(part);
      // async('nodebuffer') 本身就产出新 Buffer，无需再 Buffer.from 复制一张。
      return file && !file.dir ? file.async('nodebuffer') : null;
    },

    async writePartBytes(part, data) {
      const z = await open();
      // createFolders:false —— 否则 jszip 会额外塞一个 'word/media/' 目录条目进包。
      z.file(part, data, { createFolders: false });
      textCache.delete(part);
      dirty = true;
    },

    async patch(patches) {
      const z = await open();
      const sources = await readParts(Object.keys(patches));
      for (const [part, patch] of Object.entries(patches)) {
        const source = sources.get(part) ?? null;
        const next = patch(source);
        if (next === null || next === undefined) continue;
        if (next === source) continue;
        z.file(part, next);
        textCache.set(part, next);
        dirty = true;
      }
    },

    async flush() {
      if (!dirty || !loading) return;
      dirty = false;
      const zip = await loading;
      // 流式落盘：generateAsync 会先把整包（含全部媒体）物化成一个大 buffer 再写盘，
      // streamFiles:false 的节点流按部件产出，峰值只剩最大单个部件。
      // 两者的字节输出实测逐字节相同（同输入 sha1 比对过）。
      await pipeline(
        zip.generateNodeStream({
          type: 'nodebuffer',
          streamFiles: false,
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
        }),
        fs.createWriteStream(docxPath),
      );
    },
  };
  return session;
}
