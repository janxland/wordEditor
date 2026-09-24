/**
 * Pandoc 调用：等价于 pipeline/build.py 的 run_pandoc + restore_image_paths。
 *
 * 默认走 HTML 管道（md → standalone html → docx），因为 Markdown 里的 HTML 片段
 * 只有经 HTML 解析才能保留；直连模式更快但 HTML 支持较弱。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { walkFiles } from '../fs-utils.js';
import { run, type LineHandler } from './process.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;

/**
 * `--embed-resources` 会把 <img src> 变成 data URI，HTML→DOCX 阶段无法把它转成
 * 真正的 OOXML 图片关系（Word 里只剩一个空 drawing 框）。按内容反查原始文件，
 * 把 src 换回本地路径，配合 --resource-path 即可正常嵌入。
 *
 * 索引键用 sha256 而不是 base64：后者要让整目录的图片编码后常驻（峰值 ≈ 体积 ×1.37），
 * 逐张「读→哈希→释放」后只剩最大一张的体积。
 */
function digestIndex(mdDir: string): Map<string, string> {
  const digest = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
  const byDigest = new Map<string, string>();
  for (const file of walkFiles(mdDir)) {
    if (!IMAGE_EXT.test(file)) continue;
    try {
      byDigest.set(digest(fs.readFileSync(file)), file);
    } catch {
      /* 读不到的文件跳过 */
    }
  }
  return byDigest;
}

/** 按分支复刻 Python 的大小写口径：header 用 IGNORECASE，data-uri 严格小写（pandoc 输出恒定）。 */
const anyCase = (literal: string): string =>
  literal
    .split('')
    .map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c))
    .join('');

const DATA_URI_SRC = 'src="data:image/[^;]+;base64,([A-Za-z0-9+/=]+)"';
const TITLE_HEADER_RE = new RegExp(
  `${anyCase('<header')}[^>]*${anyCase('id')}=["']${anyCase('title-block-header')}["'][^>]*>` +
    `[\\s\\S]*?<\\/${anyCase('header')}>` +
    `|${DATA_URI_SRC}`,
  'g',
);
const DATA_URI_PROBE = /src="data:image\/[^;]+;base64,[A-Za-z0-9+/=]+"/;

/**
 * standalone HTML 的两处修正合成单趟替换：title-block header（与 <head><title> 重复，须删）
 * 与 data-URI 图片还原。两个分支互不重叠，合成一趟少产生一次全尺寸中间串——
 * 带图文档的 HTML 里内嵌 base64，可达几十 MB。
 * header 只删第一个（对齐 Python count=1）；图片索引没有可还原对象时整趟自然 no-op。
 */
export function normalizeStandaloneHtml(
  html: string,
  mdDir: string,
  onLog?: (line: string) => void,
): string {
  const byDigest = DATA_URI_PROBE.test(html) ? digestIndex(mdDir) : null;
  const digestOf = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
  let headerRemoved = false;
  let restored = 0;
  const next = html.replace(TITLE_HEADER_RE, (whole, encoded?: string) => {
    if (encoded === undefined) {
      if (headerRemoved) return whole;
      headerRemoved = true;
      return '';
    }
    const target = byDigest?.get(digestOf(Buffer.from(encoded, 'base64')));
    if (!target) return whole;
    restored += 1;
    return `src="${target}"`;
  });
  if (restored) onLog?.(`[图片] 已还原 ${restored} 张内联图片为本地文件引用`);
  return next;
}

export interface PandocRunInput {
  repoRoot: string;
  pandoc: string;
  inputMd: string;
  outputDocx: string;
  referenceDoc: string;
  luaFilters: string[];
  useHtmlPipe: boolean;
  onLine?: LineHandler;
}

export async function markdownToDocx(input: PandocRunInput): Promise<{ code: number; stderr: string }> {
  const mdDir = path.dirname(input.inputMd);
  const luaArgs = input.luaFilters.flatMap((f) => ['--lua-filter', f]);
  const base = {
    cwd: input.repoRoot,
    onLine: input.onLine,
  };

  if (!input.useHtmlPipe) {
    const result = await run(
      input.pandoc,
      [
        input.inputMd,
        '-o',
        input.outputDocx,
        '--reference-doc',
        input.referenceDoc,
        '--syntax-highlighting=none',
        ...luaArgs,
      ],
      base,
    );
    return { code: result.code, stderr: result.stderr };
  }

  // 中间 HTML 只作为下一个 Pandoc 的 stdin，不能进日志（Python 侧同样是 check_output 捕获）。
  const html = await run(
    input.pandoc,
    [
      input.inputMd,
      '-f',
      'markdown+tex_math_single_backslash',
      '-t',
      'html',
      '--mathjax',
      '--embed-resources',
      '--standalone',
      `--resource-path=${mdDir}`,
    ],
    {
      cwd: input.repoRoot,
      onLine: (stream, line) => {
        if (stream === 'stderr') input.onLine?.(stream, line);
      },
    },
  );
  if (html.code !== 0) return { code: html.code, stderr: html.stderr };

  const body = normalizeStandaloneHtml(html.stdout, mdDir, (line) =>
    input.onLine?.('stdout', line),
  );

  const docx = await run(
    input.pandoc,
    [
      '-f',
      'html+tex_math_dollars+tex_math_single_backslash',
      '-o',
      input.outputDocx,
      '--reference-doc',
      input.referenceDoc,
      '--syntax-highlighting=none',
      `--resource-path=${mdDir}`,
      ...luaArgs,
    ],
    { ...base, stdin: body },
  );
  return { code: docx.code, stderr: docx.stderr };
}
