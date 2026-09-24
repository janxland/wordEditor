/**
 * 预览样例图：把 Markdown 里的图片 URL 落到工作目录，保证 Pandoc 与前端预览都能嵌入。
 * 等价于 pipeline/preview_images.py。
 */
import fs from 'node:fs';
import path from 'node:path';

import { parseCached } from './file-cache.js';

const IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 预览图配置：只用到 images 表（CDN 相对路径清单，供下载失败时回退本地同名文件）。 */
interface CdnConfig {
  images?: Record<string, string>;
}

function loadCdnConfig(repoRoot: string): CdnConfig {
  const file = path.join(repoRoot, 'config', 'preview-cdn.json');
  return fs.existsSync(file)
    ? parseCached(file, (f) => JSON.parse(fs.readFileSync(f, 'utf-8')) as CdnConfig)
    : {};
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'wordEditor-preview/1.0' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return false;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 图片 URL → work_dir/preview-media/ 下的本地相对路径；
 * CDN 失败时回退仓库内 input/images/ 的同名文件。
 */
export async function materializeMarkdownImages(
  repoRoot: string,
  mdText: string,
  workDir: string,
): Promise<string> {
  const mediaDir = path.join(workDir, 'preview-media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const cfg = loadCdnConfig(repoRoot);
  const images = Object.values(cfg.images ?? {});

  const matches = [...mdText.matchAll(IMG_MD_RE)];
  let out = mdText;
  for (const match of matches.reverse()) {
    const [whole, alt, rawTarget] = match;
    const target = rawTarget.trim();
    if (!target || target.startsWith('data:')) continue;

    let localPath: string | null = null;
    if (/^https?:\/\//.test(target)) {
      const name = path.basename(target.split('?')[0]) || 'image.png';
      const dest = path.join(mediaDir, name);
      if (await download(target, dest)) {
        localPath = dest;
      } else {
        const fallbackRel = images.find((rel) => rel.endsWith(name) || rel.includes(name));
        const fallback = fallbackRel ? path.join(repoRoot, fallbackRel.replace(/^\/+/, '')) : null;
        if (fallback && fs.existsSync(fallback)) {
          fs.mkdirSync(mediaDir, { recursive: true });
          fs.copyFileSync(fallback, dest);
          localPath = dest;
        }
      }
    } else {
      const source = path.join(repoRoot, target.replace(/^\/+/, ''));
      if (fs.existsSync(source)) {
        const dest = path.join(mediaDir, path.basename(source));
        fs.copyFileSync(source, dest);
        localPath = dest;
      }
    }
    if (!localPath) continue;
    const rel = path.relative(workDir, localPath).split(path.sep).join('/');
    out = `${out.slice(0, match.index!)}![${alt}](${rel})${out.slice(match.index! + whole.length)}`;
  }
  return out;
}
