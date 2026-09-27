/**
 * 封面 / 尾页评分表「整页搬运」阶段。
 *
 * 与 Python 侧 `clone_core._inject_block` 同源同口径：模板块文件里存的是**从源 docx
 * 直接切下的原始 XML 字节**（根元素 `<w:blocks>`），注入时只做三件事——
 *   1. 把块用到的 xmlns 前缀补进产物 `<w:document>` 根（否则 unbound prefix，Word 报损坏）
 *   2. 重映射 rId 避开与产物已有关系冲突
 *   3. 在 `<w:body>` 开头（封面）/ `</w:body>` 前（尾表）做**字符串插入**
 * 产物 document.xml 除插入点外一个字节都不改，块内容也不解析不重排 —— 所以字体、
 * 行高、单元格边框、合并、校徽图全部与源模板逐字节一致。
 *
 * 不做的事：不分析块里的表格有几行几列、不读单元格文本、不重画任何东西。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { StageRun } from './context.js';

const RELS_PART = 'word/_rels/document.xml.rels';
const DOC_PART = 'word/document.xml';
const CT_PART = '[Content_Types].xml';

const CT_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.tif': 'image/tiff',
  '.tiff': 'image/tiff', '.emf': 'image/x-emf', '.wmf': 'image/x-wmf',
};

/** 块里出现的 rId 引用属性：r:embed / r:id / r:link / … 以及 w:data。 */
const RID_ATTR = /(r:(?:embed|link|id|pict|dm|lo|qs|cs)|w:data)="(rId\d+)"/g;
const XMLNS_DECL = /xmlns:[A-Za-z0-9_.-]+="[^"]*"/g;

interface RelInfo {
  type: string;
  target: string;
  external?: boolean;
}

/**
 * 定位块根元素的开标签：跳过 XML 声明 / 注释。
 * 用 indexOf('>') 直取会命中 `<?xml …?>` 里的 '>'，导致抽不到 xmlns → unbound prefix。
 */
function rootOpen(blockXml: string): { open: number; gt: number } {
  let i = 0;
  while (i < blockXml.length) {
    if (blockXml.startsWith('<?', i)) { i = blockXml.indexOf('?>', i) + 2; continue; }
    if (blockXml.startsWith('<!--', i)) { i = blockXml.indexOf('-->', i) + 3; continue; }
    break;
  }
  const gt = blockXml.indexOf('>', i);
  if (gt === -1) throw new Error('块文件缺少根元素');
  return { open: i, gt };
}

/** 块根元素上的 xmlns 声明（前缀绑定的唯一来源）。 */
function blockNsDecls(blockXml: string): string[] {
  const { open, gt } = rootOpen(blockXml);
  return blockXml.slice(open, gt + 1).match(XMLNS_DECL) ?? [];
}

/**
 * 取出块根元素的内部原始片段。
 * 兼容两种根：<w:blocks>（template_factory 新产出的原始字节切片）与
 * <cover> / <tail>（历史模板）。二者内容都是已就绪的 body 元素片段。
 */
function blockInner(blockXml: string): string {
  const { gt } = rootOpen(blockXml);
  const end = blockXml.lastIndexOf('</');
  if (end === -1) throw new Error('块文件不完整：缺少根元素闭合标签');
  return blockXml.slice(gt + 1, end);
}

const PAGE_BREAK =
  '<w:p><w:pPr><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr></w:pPr>' +
  '<w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr><w:br w:type="page"/></w:r></w:p>';

function injectOne(
  docXml: string,
  inner: string,
  at: 'start' | 'end',
  ridMap: Map<string, string>,
  nsDecls: string[],
): string {
  // 1) 补前缀声明到产物根元素（缺哪个补哪个）
  const rs = docXml.indexOf('<w:document');
  if (rs !== -1) {
    const re = docXml.indexOf('>', rs);
    const have = new Set((docXml.slice(rs, re + 1).match(XMLNS_DECL) ?? []).map((d) => d.split('=')[0]));
    const add = nsDecls.filter((d) => !have.has(d.split('=')[0]));
    if (add.length) docXml = `${docXml.slice(0, re)} ${add.join(' ')}${docXml.slice(re)}`;
  }
  // 2) 重映射 rId
  const mapped = inner.replace(RID_ATTR, (m, attr: string, rid: string) =>
    ridMap.has(rid) ? `${attr}="${ridMap.get(rid)}"` : m);

  if (at === 'start') {
    const bodyStart = docXml.indexOf('>', docXml.indexOf('<w:body')) + 1;
    const hasBreak = /<w:br\b[^>]*w:type="page"/.test(mapped);
    return docXml.slice(0, bodyStart) + (hasBreak ? mapped : mapped + PAGE_BREAK) + docXml.slice(bodyStart);
  }
  const bodyEnd = docXml.lastIndexOf('</w:body>');
  return docXml.slice(0, bodyEnd) + PAGE_BREAK + mapped + docXml.slice(bodyEnd);
}

async function applyBlock(ctx: StageRun, blockPath: string, at: 'start' | 'end'): Promise<boolean> {
  const dir = path.dirname(blockPath);
  const prefix = path.basename(blockPath).replace(/_block\.xml$/, '');
  if (!fs.existsSync(blockPath)) return false;
  const blockXml = fs.readFileSync(blockPath, 'utf8');
  const relsFile = path.join(dir, `${prefix}_rels.json`);
  const relsInfo: Record<string, RelInfo> = fs.existsSync(relsFile)
    ? JSON.parse(fs.readFileSync(relsFile, 'utf8')) : {};

  const inner = blockInner(blockXml);
  const parts = await ctx.zip.listParts();
  const existingMedia = new Set(parts.filter((n) => n.startsWith('word/media/')).map((n) => path.basename(n)));
  const relsXml = (await ctx.zip.readPart(RELS_PART)) ?? '';
  const usedIds = new Set([...relsXml.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));

  // rId 避冲突 + 拷贝 media
  const ridMap = new Map<string, string>();
  const newRels: string[] = [];
  for (const [old, info] of Object.entries(relsInfo)) {
    let next = old;
    while (usedIds.has(next)) next += 'x';
    usedIds.add(next);
    ridMap.set(old, next);
    if (info.external) {
      newRels.push(`<Relationship Id="${next}" Type="${info.type}" Target="${info.target}" TargetMode="External"/>`);
      continue;
    }
    const ext = path.extname(info.target);
    const src = path.join(dir, `${prefix}_media`, `${old}${ext}`);
    if (!fs.existsSync(src)) continue;
    let fname = `${prefix}_${path.basename(info.target)}`;
    while (existingMedia.has(fname)) fname = `${prefix}_${fname}`;
    existingMedia.add(fname);
    await ctx.zip.writePartBytes(`word/media/${fname}`, fs.readFileSync(src));
    newRels.push(`<Relationship Id="${next}" Type="${info.type}" Target="media/${fname}"/>`);
  }

  if (newRels.length && relsXml) {
    const at2 = relsXml.lastIndexOf('</Relationships>');
    await ctx.zip.patch({
      [RELS_PART]: () => relsXml.slice(0, at2) + newRels.join('') + relsXml.slice(at2),
    });
  }

  // 补 Content-Type（首次引入某图片格式时）
  const exts = new Set([...newRels].map((r) => path.extname(r.match(/Target="media\/([^"]+)"/)?.[1] ?? '')).filter(Boolean));
  if (exts.size) {
    await ctx.zip.patch({
      [CT_PART]: (src) => {
        if (!src) return null;
        const have = new Set([...src.matchAll(/Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
        const add = [...exts]
          .filter((e) => !have.has(e.slice(1).toLowerCase()) && CT_MAP[e.toLowerCase()])
          .map((e) => `<Default Extension="${e.slice(1)}" ContentType="${CT_MAP[e.toLowerCase()]}"/>`);
        if (!add.length) return null;
        const i = src.lastIndexOf('</Types>');
        return src.slice(0, i) + add.join('') + src.slice(i);
      },
    });
  }

  await ctx.zip.patch({
    [DOC_PART]: (src) => {
      if (!src) return null;
      return injectOne(src, inner, at, ridMap, blockNsDecls(blockXml));
    },
  });
  ctx.log(`[blocks] 已注入 ${prefix} 块（${inner.length} 字节，${ridMap.size} 个关系）`);
  return true;
}

/** 先尾表后封面：封面插到 body 开头，会改变后面所有字节的下标（此处用字符串插入，无下标依赖）。 */
export async function applyBlocksStage(ctx: StageRun): Promise<void> {
  const { coverBlock, tailBlock } = ctx.template;
  if (tailBlock) await applyBlock(ctx, tailBlock, 'end');
  if (coverBlock) await applyBlock(ctx, coverBlock, 'start');
}
