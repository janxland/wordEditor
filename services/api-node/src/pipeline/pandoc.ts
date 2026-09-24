/**
 * Pandoc 调用：等价于 pipeline/build.py 的 run_pandoc + restore_image_paths。
 *
 * 默认走 HTML 管道（md → standalone html → docx），因为 Markdown 里的 HTML 片段
 * 只有经 HTML 解析才能保留；直连模式更快但 HTML 支持较弱。
 */
import fs from 'node:fs';
import path from 'node:path';

import { run, type LineHandler } from './process.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;

function listFilesRecursive(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

/**
 * `--embed-resources` 会把 <img src> 变成 data URI，HTML→DOCX 阶段无法把它转成
 * 真正的 OOXML 图片关系（Word 里只剩一个空 drawing 框）。按 base64 反查原始文件，
 * 把 src 换回本地路径，配合 --resource-path 即可正常嵌入。
 */
export function restoreImagePaths(
  html: string,
  mdDir: string,
  onLog?: (line: string) => void,
): string {
  const byBase64 = new Map<string, string>();
  for (const file of listFilesRecursive(mdDir)) {
    if (!IMAGE_EXT.test(file)) continue;
    try {
      byBase64.set(fs.readFileSync(file).toString('base64'), file);
    } catch {
      /* 读不到的文件跳过 */
    }
  }
  if (byBase64.size === 0) return html;

  let restored = 0;
  const next = html.replace(
    /src="data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)"/g,
    (whole, encoded: string) => {
      const target = byBase64.get(encoded);
      if (!target) return whole;
      restored += 1;
      return `src="${target}"`;
    },
  );
  if (restored) onLog?.(`[图片] 已还原 ${restored} 张内联图片为本地文件引用`);
  return next;
}

/** standalone HTML 的 <header id="title-block-header"> 会与 <head><title> 一起被读入，产生两次 Title 段。 */
export function stripTitleBlockHeader(html: string): string {
  return html.replace(
    /<header[^>]*id=["']title-block-header["'][^>]*>[\s\S]*?<\/header>/i,
    '',
  );
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

  const body = restoreImagePaths(stripTitleBlockHeader(html.stdout), mdDir, (line) =>
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
