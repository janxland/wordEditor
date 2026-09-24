/** docx 部件级改写：等价于 pipeline/ooxml_util.py:patch_docx_parts。 */
import fs from 'node:fs';

import JSZip from 'jszip';

/** 入参为该部件原文（部件不存在时为 null）；返回 null 表示不改动该部件。 */
export type PartPatch = (source: string | null) => string | null;

export async function readPart(docxPath: string, part: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const file = zip.file(part);
  return file ? file.async('string') : null;
}

/** 一次性改写多个部件；新部件（如缺失的 numbering.xml）会被创建。 */
export async function patchDocxParts(
  docxPath: string,
  patches: Record<string, PartPatch>,
): Promise<void> {
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  let touched = false;

  for (const [part, patch] of Object.entries(patches)) {
    const source = zip.file(part) ? await zip.file(part)!.async('string') : null;
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
