/** docx 部件级改写：等价于 pipeline/ooxml_util.py:patch_docx_parts。 */
import fs from 'node:fs';

import JSZip from 'jszip';

/** 入参为该部件原文（部件不存在时为 null）；返回 null 表示不改动该部件。 */
export type PartPatch = (source: string | null) => string | null;

async function loadZip(docxPath: string): Promise<JSZip> {
  return JSZip.loadAsync(fs.readFileSync(docxPath));
}

/** 部件名清单，用于页眉/页脚这类动态命名的部件。 */
export async function listParts(docxPath: string): Promise<string[]> {
  const names: string[] = [];
  const zip = await loadZip(docxPath);
  zip.forEach((name) => {
    names.push(name);
  });
  return names;
}

/** 一次打开读取多个部件；不存在的部件为 null。 */
export async function readParts(
  docxPath: string,
  parts: string[],
): Promise<Map<string, string | null>> {
  const zip = await loadZip(docxPath);
  const out = new Map<string, string | null>();
  for (const part of parts) {
    const file = zip.file(part);
    out.set(part, file ? await file.async('string') : null);
  }
  return out;
}

export async function readPart(docxPath: string, part: string): Promise<string | null> {
  return (await readParts(docxPath, [part])).get(part) ?? null;
}

/** 一次打开读取多个二进制部件（word/media/*）；不存在的部件为 null。 */
export async function readPartsBytes(
  docxPath: string,
  parts: string[],
): Promise<Map<string, Buffer | null>> {
  const zip = await loadZip(docxPath);
  const out = new Map<string, Buffer | null>();
  for (const part of parts) {
    const file = zip.file(part);
    out.set(part, file && !file.dir ? Buffer.from(await file.async('nodebuffer')) : null);
  }
  return out;
}

/** 一次性改写多个部件；新部件（如缺失的 numbering.xml）会被创建。 */
export async function patchDocxParts(
  docxPath: string,
  patches: Record<string, PartPatch>,
): Promise<void> {
  const zip = await loadZip(docxPath);
  let touched = false;

  for (const [part, patch] of Object.entries(patches)) {
    const file = zip.file(part);
    const source = file ? await file.async('string') : null;
    const next = patch(source);
    if (next === null || next === undefined) continue;
    if (next === source) continue;
    zip.file(part, next);
    touched = true;
  }

  if (!touched) return;
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(docxPath, buffer);
}
