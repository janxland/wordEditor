#!/usr/bin/env tsx
/**
 * Python / Node 引擎产物对比：验证「同一输入 → 同一 docx」。
 *
 *   npx tsx tools/parity.ts pandoc -i input/x.md -t hutb-guanke
 *   npx tsx tools/parity.ts stage document -i input/x.md -t hutb-guanke
 *   npx tsx tools/parity.ts full    -i input/x.md -t hutb-guanke
 *
 * pandoc：两边都只跑 Pandoc，隔离出管道差异。
 * stage ：两边都只跑到指定后处理阶段（document|styles|threeLine|verbatim），
 *         Python 侧直接调用对应脚本，从而逐阶段定位差异。
 * full  ：完整链路对比。
 *
 * XML 部件按「命名空间规范化」后的语义比较：Python 的 ElementTree 会把前缀重写成
 * ns1/ns2，Node 保留原始前缀，字节不同而语义相同，不该算差异。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { findPandoc, resolveRepoRoot } from '../src/config.js';
import { runBuild } from '../src/pipeline/build.js';
import {
  findTemplate,
  loadTemplatesConfig,
  resolveTemplate,
  type ResolvedTemplate,
} from '../src/pipeline/templates.js';
import type { StageName } from '../src/pipeline/stages/context.js';
import type { BuildOptions } from '../src/pipeline/types.js';


const argv = process.argv.slice(2);
const mode = argv[0];
/** opt('--upto') / opt('-i') —— 取下一个位置参数。 */
function opt(name: string, fallback = ''): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const repoRoot = resolveRepoRoot();
const outDir = path.join(repoRoot, '.cache', 'parity');
fs.mkdirSync(outDir, { recursive: true });

async function parts(docx: string): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(fs.readFileSync(docx));
  const out = new Map<string, Buffer>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    out.set(name, Buffer.from(await file.async('arraybuffer')));
  }
  return out;
}

/** 时间戳一类的写入差异不参与语义比较。 */
function preStrip(text: string): string {
  return text
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<dcterms:(created|modified)\b[^>]*>[^<]*<\/dcterms:\1>/g, '');
}

/**
 * 语义规范化：限定名写成 `<按 URI 首次出现顺序分配的 nsK>:local`，丢弃 xmlns 声明本身，
 * 折叠标签间纯空白。前缀重写与序列化风格因此不再被当成差异。
 */
function canonicalXml(buf: Buffer): string | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(preStrip(buf.toString('utf-8')), 'application/xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root) return null;
  const uriToPrefix = new Map<string, string>();

  const qname = (name: string, scopes: Map<string, string>[], isAttr: boolean): string => {
    const colon = name.indexOf(':');
    const prefix = colon >= 0 ? name.slice(0, colon) : '';
    const local = colon >= 0 ? name.slice(colon + 1) : name;
    let uri = '';
    // 无前缀属性按 XML 规范不属于任何命名空间
    if (prefix || !isAttr) {
      for (let s = scopes.length - 1; s >= 0 && !uri; s -= 1) uri = scopes[s].get(prefix) ?? '';
    }
    if (!uri) return local;
    let assigned = uriToPrefix.get(uri);
    if (!assigned) {
      assigned = `ns${uriToPrefix.size}`;
      uriToPrefix.set(uri, assigned);
    }
    return `${assigned}:${local}`;
  };

  const walk = (el: Element, scopes: Map<string, string>[]): string => {
    const local = new Map<string, string>();
    for (let i = 0; i < el.attributes.length; i += 1) {
      const a = el.attributes.item(i)!;
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
        local.set(a.name === 'xmlns' ? '' : a.name.slice(6), a.value);
      }
    }
    const scopes2 = local.size ? [...scopes, local] : scopes;
    const tag = qname(el.nodeName, scopes2, false);

    const attrs: string[] = [];
    for (let i = 0; i < el.attributes.length; i += 1) {
      const a = el.attributes.item(i)!;
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
      attrs.push(`${qname(a.name, scopes2, true)}=${JSON.stringify(a.value)}`);
    }

    let inner = '';
    for (let i = 0; i < el.childNodes.length; i += 1) {
      const node = el.childNodes.item(i);
      if (!node) continue;
      if (node.nodeType === 1) inner += walk(node as Element, scopes2);
      else if (node.nodeType === 3 || node.nodeType === 4) inner += node.nodeValue ?? '';
    }
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner.replace(/\s+/g, ' ').trim()}</${tag}>`;
  };

  return walk(root, []).replace(/\s+</g, '<');
}

function firstDiff(a: string, b: string): string {
  const la = a.split(/(?=>)/);
  const lb = b.split(/(?=>)/);
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
    if (la[i] !== lb[i]) {
      return `#${i}\n  py  : ${(la[i] ?? '').slice(0, 200)}\n  node: ${(lb[i] ?? '').slice(0, 200)}`;
    }
  }
  return '';
}

async function compare(pyDocx: string, nodeDocx: string): Promise<boolean> {
  const [a, b] = await Promise.all([parts(pyDocx), parts(nodeDocx)]);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  let same = true;

  for (const name of names) {
    const pa = a.get(name);
    const pb = b.get(name);
    if (!pa || !pb) {
      console.log(`  ${name.padEnd(34)} ${pa ? '仅 Node 有' : '仅 Python 有'}`);
      same = false;
      continue;
    }
    if (pa.equals(pb)) continue;
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) {
      console.log(`  ${name.padEnd(34)} 二进制差异 ${pa.length} vs ${pb.length}`);
      same = false;
      continue;
    }
    const na = canonicalXml(pa);
    const nb = canonicalXml(pb);
    if (na === null || nb === null) {
      console.log(`  ${name.padEnd(34)} 无法解析，按差异处理`);
      same = false;
      continue;
    }
    if (na === nb) {
      console.log(`  ${name.padEnd(34)} 语义一致（仅前缀/序列化差异）`);
      continue;
    }
    same = false;
    console.log(`  ${name.padEnd(34)} 语义差异 len ${na.length} vs ${nb.length}`);
    console.log(`    ${firstDiff(na, nb).split('\n').join('\n    ')}`);
  }
  console.log(same ? '\n一致 ✅' : '\n存在差异 ❌');
  return same;
}

function runPythonScript(script: string, args: string[]): void {
  const res = spawnSync(
    'python3',
    [path.join(repoRoot, 'services', 'api-python', 'pipeline', script), ...args],
    { cwd: repoRoot, encoding: 'utf-8' },
  );
  if (res.status !== 0) {
    console.error(res.stdout, res.stderr);
    throw new Error(`python ${script} failed: ${res.status}`);
  }
}

function runPythonBuild(inputMd: string, templateId: string, output: string): void {
  runPythonScript('build.py', ['-i', inputMd, '-o', output, '-t', templateId, '--no-postprocess']);
}

/** 可按阶段重放的结构性阶段（其余阶段由入参驱动，走 full 模式）。 */
const REPLAY_STAGES: StageName[] = ['document', 'styles', 'threeLine', 'verbatim'];

/** 按 build.py 的顺序单独重放 Python 后处理脚本，只跑到 upto（含）。 */
function runPythonStages(output: string, template: ResolvedTemplate, upto: StageName): void {
  for (const stage of REPLAY_STAGES.slice(0, REPLAY_STAGES.indexOf(upto) + 1)) {
    if (stage === 'document') {
      runPythonScript('postprocess_document.py', [
        output,
        '--heading-scheme',
        template.def.heading_numbering ?? 'guanke',
      ]);
    }
    if (stage === 'styles' && template.stylesYaml) {
      runPythonScript('postprocess_styles.py', [output, '--styles', template.stylesYaml]);
    }
    if (stage === 'threeLine' && template.def.three_line_tables) {
      runPythonScript('ooxml_three_line_table.py', [output]);
    }
    if (stage === 'verbatim' && template.def.three_line_tables) {
      runPythonScript('ooxml_verbatim_table.py', [output]);
    }
  }
}

async function nodeBuild(
  inputMd: string,
  template: ResolvedTemplate,
  output: string,
  postprocess: boolean,
  uptoStage?: StageName,
): Promise<void> {
  const pandoc = findPandoc(repoRoot);
  if (!pandoc) throw new Error('未检测到 Pandoc');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await runBuild({
    repoRoot,
    pandoc,
    template,
    inputMd,
    outputDocx: output,
    options: { ...(postprocess ? {} : { noPostprocess: true }), ...headerFooter },
    uptoStage,
    emit: (e) => {
      if (e.type === 'log' && process.env.PARITY_VERBOSE) console.log(`  [node] ${e.line}`);
    },
  });
}

const inputMd = path.resolve(repoRoot, opt('-i', 'input/碳中和风光储优化.md'));
const templateId = opt('-t', 'hutb-guanke');
const pyDocx = path.join(outDir, 'python.docx');
const nodeDocx = path.join(outDir, 'node.docx');

if (!fs.existsSync(inputMd)) throw new Error(`输入不存在: ${inputMd}`);

const cfg = loadTemplatesConfig(repoRoot);
const template = resolveTemplate(repoRoot, findTemplate(cfg, templateId));
const stage = opt('--upto') as StageName;

/** 页眉页脚由入参驱动，只有 full 模式会真正跑到：同名透传给两条链路。 */
const HEADER_FOOTER_FLAGS: Array<[string, keyof BuildOptions]> = [
  ['--header-text', 'headerText'],
  ['--footer-text', 'footerText'],
  ['--header-align', 'headerAlign'],
  ['--header-vertical-align', 'headerVerticalAlign'],
  ['--footer-align', 'footerAlign'],
  ['--footer-vertical-align', 'footerVerticalAlign'],
];
const headerFooter: BuildOptions = {};
const headerFooterArgs: string[] = [];
for (const [flag, key] of HEADER_FOOTER_FLAGS) {
  const value = opt(flag);
  if (!value) continue;
  headerFooter[key] = value;
  headerFooterArgs.push(flag, value);
}

switch (mode) {
  case 'pandoc':
    runPythonBuild(inputMd, templateId, pyDocx);
    await nodeBuild(inputMd, template, nodeDocx, false);
    break;
  case 'stage':
    if (!REPLAY_STAGES.includes(stage)) {
      throw new Error(`--upto 需要是: ${REPLAY_STAGES.join('|')}`);
    }
    runPythonBuild(inputMd, templateId, pyDocx);
    runPythonStages(pyDocx, template, stage);
    await nodeBuild(inputMd, template, nodeDocx, true, stage);
    break;
  case 'full':
    runPythonScript('build.py', ['-i', inputMd, '-o', pyDocx, '-t', templateId, ...headerFooterArgs]);
    await nodeBuild(inputMd, template, nodeDocx, true);
    break;
  default:
    console.log('用法: parity.ts pandoc|stage --upto <stage>|full -i <md> -t <template>');
    process.exit(0);
}

console.log(`\n对比 ${path.relative(repoRoot, pyDocx)} vs ${path.relative(repoRoot, nodeDocx)}`);
const ok = await compare(pyDocx, nodeDocx);
process.exit(ok ? 0 : 1);

