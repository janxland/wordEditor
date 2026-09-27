/**
 * 下载当前平台对应的 pandoc 到 resources/pandoc（做单台自带，安装机免装 pandoc）。
 * 跨平台：Windows 用 .exe，macOS/Linux 用同名可执行文件；解压只用手写 zip 解析（不依赖 unzip/tar）。
 *
 * 用法：node scripts/fetch-pandoc.mjs [版本号，默认 3.9]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] ?? '3.9';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'resources', 'pandoc');

const TARGETS = {
  'darwin-arm64': `pandoc-${VERSION}-arm64-macOS.zip`,
  'darwin-x64': `pandoc-${VERSION}-x86_64-macOS.zip`,
  'win32-x64': `pandoc-${VERSION}-windows-x86_64.zip`,
  'linux-x64': `pandoc-${VERSION}-linux-amd64.tar.gz`,
};

/** 极简 ZIP 解析：只处理 store/deflate 的本地文件头，够用于官方 pandoc 包 */
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset < buffer.length - 4) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const flag = buffer.readUInt16LE(offset + 6);
    let compSize = buffer.readUInt32LE(offset + 18);
    let uncompSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLen);
    if ((flag & 0x08) !== 0) {
      // 尺寸写在数据描述符里，退化为「读到下一个签名」
      compSize = buffer.length;
      uncompSize = buffer.length;
    }
    const dataStart = offset + 30 + nameLen + extraLen;
    const raw = buffer.subarray(dataStart, dataStart + compSize);
    let data;
    try {
      data = method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch {
      data = zlib.inflateRawSync(raw.subarray(0, Math.min(raw.length, uncompSize || raw.length)));
    }
    files.set(name, data);
    offset = dataStart + (method === 0 ? compSize : compSize);
    if (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50) offset += 46;
  }
  return files;
}

const key = `${process.platform}-${process.arch}`;
const file = TARGETS[key];
if (!file) throw new Error(`暂不支持的平台：${key}`);
const url = `https://github.com/jgm/pandoc/releases/download/${VERSION}/${file}`;
console.log('下载', url);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) throw new Error(`下载失败 ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (file.endsWith('.zip')) {
  const files = unzip(buf);
  for (const [name, data] of files) {
    const base = path.basename(name);
    if (!base || name.endsWith('/')) continue;
    const dest = path.join(outDir, base);
    fs.writeFileSync(dest, data);
    if (base === 'pandoc' || base === 'pandoc.exe') fs.chmodSync(dest, 0o755);
  }
} else {
  // tar.gz：官方包是 GNU tar，这里只取 pandoc 本体，跳过目录项
  const tar = zlib.gunzipSync(buf);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tar.toString('utf8', offset + 124, offset + 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = tar[offset + 156];
    const data = tar.subarray(offset + 512, offset + 512 + size);
    if (type === 0x30 || type === 0) {
      const base = path.basename(name);
      if (base.startsWith('pandoc')) {
        const dest = path.join(outDir, base);
        fs.writeFileSync(dest, data);
        fs.chmodSync(dest, 0o755);
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

const exe = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
if (!fs.existsSync(path.join(outDir, exe))) throw new Error(`解压后未找到 ${exe}`);
console.log('pandoc 已就位:', path.join(outDir, exe));
