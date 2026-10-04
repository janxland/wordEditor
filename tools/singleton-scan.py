#!/usr/bin/env python3
"""单例扫描器 —— 去冗余迭代的唯一检测入口。

判定「一个功能多处重复实现（多例）」的三条机械口径：
  A. dead-module  : 模块存在，但没有任何其它模块 import 它（= 未接线的第二份实现）
  B. dup-symbol   : 同名导出符号（函数/类/常量）在 >= 2 个文件里各定义一份
  C. dup-const    : 同名 UPPER_SNAKE 常量在 >= 2 个文件里各赋值一份

用法：
    python tools/singleton-scan.py api-node     # 扫 services/api-node/src
    python tools/singleton-scan.py api-python   # 扫 services/api-python
    python tools/singleton-scan.py frontend     # 扫 apps/wordEditor-frontend/src
    python tools/singleton-scan.py desktop      # 扫 apps/wordeditor-desktop/src（第 05 轮补登记）
    python tools/singleton-scan.py all --json

退出码恒为 0（它是体检工具，不是卡口）。判定/取舍由人（或状态机）做。

────────────────────────────── 入口识别（第 03 轮修，D12）──────────────────────────────
Vite 前端的入口既不是 main.ts 也不是 index.ts，而是：
    index.html          <script type="module" src="/src/main.tsx">
    vite.config.ts      build.rollupOptions.input / build.lib.entry
    registerFeatures.ts lazy(() => import('@/pages/XxxPage'))   ← 动态 specifier
    tsconfig / vite     resolve.alias { '@': <root>/src }       ← 路径别名

老版本只认 `from './x'` 这类相对 specifier，于是整棵前端依赖树被判成孤岛
（A0=60 / A=34，连 src/main.tsx 都被判死）。现在的入口与依赖解析按下列顺序：
  1. index.html 的 <script src>            （Vite / 纯静态前端）
  2. vite.config.* 的 build input/entry
  3. package.json 的 main / module / bin
  4. ENTRY_PATTERNS 文件名兜底
依赖 specifier 支持：相对路径 / 绝对路径 / 路径别名 / import() / require()。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# target -> (扫描根, 后缀, 工程目录)。工程目录 = 放 package.json / vite.config / index.html 的那层，
# 入口与别名都从它这里探测。
TARGETS = {
    "api-node": ("services/api-node/src", (".ts",), "services/api-node"),
    "api-python": ("services/api-python", (".py",), "services/api-python"),
    "frontend": ("apps/wordEditor-frontend/src", (".ts", ".tsx"), "apps/wordEditor-frontend"),
    # 第 05 轮补：这个 target 前 4 轮从未被扫过（TARGETS 表漏登记），
    # 属 git 已跟踪的第一方源码（src/main.ts + src/preload.ts），不是打包产物。
    "desktop": ("apps/wordeditor-desktop/src", (".ts",), "apps/wordeditor-desktop"),
}

# 入口文件天然无人 import，不算 dead。
ENTRY_PATTERNS = (
    "main.ts",
    "main.tsx",
    "server.ts",
    "app.py",
    "mcp_server.py",
    "template_factory.py",
    "template_verify.py",
    "index.ts",
    "index.tsx",
    "route.ts",
    "routes.ts",
)

SKIP_DIRS = {"node_modules", "__pycache__", "dist", "build", ".git", "coverage"}

# 纯类型声明（.d.ts）不是运行时模块：没有人 import 它是正常的，不能算 dead / 孤岛。
DECL_SUFFIX = ".d.ts"

# ── D13：devtool 白名单 ──────────────────────────────────────────────────────
# 这些目录里的脚本是**给人用的诊断工具**（有 README 说明用法），不是未接线的第二份实现。
# 它们天然无人 import，A 口径每轮都会命中 —— 单列成「D.devtool（保留）」，不与缺陷数混算。
DEVTOOL_DIRS = (
    "services/api-python/pipeline/tools",
    "tools",
)


def is_devtool(rel_path: str) -> bool:
    """路径前缀白名单 + 目录内 README（或目录名就叫 tools）→ 判定为 devtool。"""
    d = os.path.dirname(rel_path)
    if d not in DEVTOOL_DIRS:
        return False
    if os.path.basename(d) == "tools":
        return True
    return os.path.isfile(os.path.join(REPO, d, "README.md"))


def collect(root: str, exts: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(exts):
                continue
            if f.endswith(DECL_SUFFIX):
                continue  # .d.ts 只有类型，无运行时实体
            out.append(os.path.join(dirpath, f))
    return sorted(out)


# ------------------------------------------------------- 工程配置：入口 + 别名

def _find_file(project: str, names: tuple[str, ...]) -> str | None:
    for n in names:
        p = os.path.join(project, n)
        if os.path.isfile(p):
            return p
    return None


def _strip_jsonc(text: str) -> str:
    """去掉 // 与 /* */ 注释，让 tsconfig.json（带注释）也能被 json.loads。"""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def load_project_config(project_dir: str) -> tuple[dict[str, str], list[str]]:
    """返回 (alias 前缀 -> 绝对目录, 额外入口绝对路径)。不抛异常，探测失败就退化。"""
    alias: dict[str, str] = {}
    entries: list[str] = []
    if not os.path.isdir(project_dir):
        return alias, entries

    # 1) index.html —— Vite 的默认入口
    html = _find_file(project_dir, ("index.html",))
    if html:
        try:
            for m in re.finditer(r"""<script[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]""",
                                 open(html, encoding="utf-8", errors="replace").read()):
                src = m.group(1)
                if src.startswith(("http://", "https://", "//")):
                    continue
                p = src[1:] if src.startswith("/") else src
                entries.append(os.path.normpath(os.path.join(project_dir, p)))
        except OSError:
            pass

    # 2) vite.config.* —— build.rollupOptions.input / build.lib.entry + resolve.alias
    vite = _find_file(project_dir, ("vite.config.ts", "vite.config.js",
                                    "vite.config.mts", "vite.config.mjs"))
    if vite:
        try:
            t = open(vite, encoding="utf-8", errors="replace").read()
            for m in re.finditer(r"""\b(?:input|entry)\s*:\s*['"]([^'"]+)['"]""", t):
                entries.append(os.path.normpath(os.path.join(project_dir, m.group(1))))
            m = re.search(r"\balias\s*:\s*\{(.*?)\n?\s*\}", t, re.S)
            if m:
                for k, v in re.findall(
                    r"""['"]([^'"]+)['"]\s*:\s*(?:path\.resolve\(\s*__dirname\s*,\s*)?['"]([^'"]+)['"]""",
                    m.group(1),
                ):
                    tgt = v if os.path.isabs(v) else os.path.normpath(os.path.join(project_dir, v))
                    alias[k.rstrip("/")] = tgt
        except OSError:
            pass

    # 3) tsconfig.json —— compilerOptions.paths（baseUrl 为基准）
    ts = _find_file(project_dir, ("tsconfig.json",))
    if ts:
        try:
            cfg = json.loads(_strip_jsonc(open(ts, encoding="utf-8", errors="replace").read()))
            co = cfg.get("compilerOptions", {}) or {}
            base = os.path.normpath(os.path.join(project_dir, co.get("baseUrl", ".")))
            for key, vals in (co.get("paths") or {}).items():
                if not vals:
                    continue
                pref = key.rstrip("/").replace("/*", "").replace("*", "")
                tgt = str(vals[0]).replace("/*", "").replace("*", "")
                if pref:
                    alias.setdefault(pref, tgt if os.path.isabs(tgt)
                                     else os.path.normpath(os.path.join(base, tgt)))
        except (OSError, ValueError):
            pass

    # 4) package.json —— main / module / bin（Node 侧入口兜底）
    pkg = _find_file(project_dir, ("package.json",))
    if pkg:
        try:
            j = json.loads(_strip_jsonc(open(pkg, encoding="utf-8", errors="replace").read()))
            for k in ("main", "module"):
                v = j.get(k)
                if isinstance(v, str):
                    entries.append(os.path.normpath(os.path.join(project_dir, v)))
            b = j.get("bin")
            if isinstance(b, str):
                entries.append(os.path.normpath(os.path.join(project_dir, b)))
            elif isinstance(b, dict):
                entries.extend(os.path.normpath(os.path.join(project_dir, v))
                               for v in b.values() if isinstance(v, str))
        except (OSError, ValueError):
            pass

    return alias, entries


# ---------------------------------------------------------------- A. dead module

TS_SPEC = re.compile(r"""(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]""")


def _resolve_ts(base: str, spec: str, alias: dict[str, str], project_dir: str) -> str | None:
    """把 import specifier 还原成磁盘上的模块文件。

    支持：相对（./x）、工程根绝对（/src/x）、路径别名（@/x）、ESM 的 .js → .ts/.tsx。
    """
    spec = spec.strip()
    # 1) 路径别名（最长前缀优先，@/ 与 @lib/ 共存时不会抢）
    for pref in sorted(alias, key=len, reverse=True):
        if spec == pref:
            cand = alias[pref]
            break
        if spec.startswith(pref + "/"):
            cand = os.path.join(alias[pref], spec[len(pref) + 1:])
            break
    else:
        if spec.startswith("."):
            cand = os.path.join(os.path.dirname(base), spec)
        elif spec.startswith("/"):
            cand = os.path.join(project_dir, spec.lstrip("/"))
        else:
            return None  # 裸包名（react / antd …）不属本 target

    cand = os.path.normpath(cand)
    if cand.endswith(".js"):
        cand = cand[:-3]  # ESM/NodeNext: 源码里写 .js，磁盘上是 .ts
    for c in (cand + ".ts", cand + ".tsx", cand + ".d.ts", os.path.join(cand, "index.ts"),
              os.path.join(cand, "index.tsx")):
        if os.path.exists(c):
            return c
    return None


def deps_of(path: str, text: dict[str, str], lang: str, files: set[str],
            alias: dict[str, str], project_dir: str) -> set[str]:
    """一个模块直接 import 了哪些模块（只认本 target 内的文件）。"""
    out: set[str] = set()
    if lang == "ts":
        # 静态 import / 动态 import() / require() 一律算依赖边
        for m in TS_SPEC.finditer(text[path]):
            r = _resolve_ts(path, m.group(1), alias, project_dir)
            if r and r in files:
                out.add(r)
    else:
        for m in re.finditer(r"(?:from|import)\s+([A-Za-z_][\w.]*)", text[path]):
            mod = m.group(1)
            for cand in _py_module_paths(mod, files):
                out.add(cand)
    return out


def _py_module_paths(mod: str, files: set[str]) -> list[str]:
    """把 `pipeline.ooxml_util` / `ooxml_util` 之类还原成本 target 内的文件路径。"""
    hits = []
    tail = mod.split(".")[-1]
    for f in files:
        rel = os.path.relpath(f, os.path.join(REPO, TARGETS["api-python"][0]))[:-3]
        rel = rel.replace(os.sep, ".").replace(".__init__", "")
        if rel == mod or rel.endswith("." + mod) or rel.split(".")[-1] == tail:
            hits.append(f)
    return hits


def electron_preload_entries(files: list[str]) -> set[str]:
    """Electron 的 preload 是主进程**运行时按路径字符串**注入的
    （`new BrowserWindow({ webPreferences: { preload: path.join(__dirname,'preload.js') } })`），
    静态 import 图里永远看不到它 —— 不认就会被 A0/A 口径误报成孤岛/死模块。
    这里扫 `preload: … 'x.js'` 形式的字符串引用，把同源的 `x.ts` 视为入口。
    """
    out: set[str] = set()
    fset = set(files)
    # 注意：值里可能是 `path.join(__dirname, 'preload.js')`（自带逗号/括号），
    # 所以中间段只能排除换行，不能排除逗号。
    pat = re.compile(r"preload\s*:\s*[^\n]*?['\"]([^'\"]+)\.js['\"]")
    for p in files:
        try:
            txt = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for base in pat.findall(txt):
            cand = os.path.join(os.path.dirname(p), os.path.basename(base) + ".ts")
            if cand in fset:
                out.add(cand)
    return out


def entry_files(files: list[str], project_dir: str) -> set[str]:
    """工程真实入口（文件名兜底 + index.html / vite / package.json 探测）。"""
    _alias, extra = load_project_config(project_dir)
    fset = set(files)
    out = {
        p
        for p in files
        if p.endswith(ENTRY_PATTERNS) or "/routes/" in p or p.endswith("stages/index.ts")
    }
    out |= electron_preload_entries(files)
    for e in extra:
        if e in fset:
            out.add(e)
        else:
            # 入口可能指到 src/x.js（ESM 写法）或目录
            for c in (e, e[:-3] + ".ts" if e.endswith(".js") else e,
                      e[:-4] + ".tsx" if e.endswith(".jsx") else e,
                      os.path.join(e, "index.ts")):
                if c in fset:
                    out.add(c)
                    break
    return out


def reachable_from_entries(files: list[str], lang: str, project_dir: str) -> set[str]:
    """从入口文件出发做 BFS —— 不可达的模块 = 整簇未接线（含互相引用但整体没人用的孤岛）。"""
    fset = set(files)
    text = {p: open(p, encoding="utf-8", errors="replace").read() for p in files}
    alias, _ = load_project_config(project_dir)
    seen: set[str] = set()
    stack = list(entry_files(files, project_dir))
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        stack.extend(deps_of(p, text, lang, fset, alias, project_dir) - seen)
    return seen


def dead_modules(files: list[str], lang: str, project_dir: str
                 ) -> tuple[list[str], list[str]]:
    """没有任何其它模块 import 它的模块。返回 (真 dead, devtool 保留)。"""
    text = {p: open(p, encoding="utf-8", errors="replace").read() for p in files}
    alias, _ = load_project_config(project_dir)
    dead: list[str] = []
    devtool: list[str] = []
    # 与 A0 口径共用同一套入口集（index.html / vite / package.json / Electron preload …），
    # 否则「入口探测认得出、dead 判定认不出」会对同一个文件给出自相矛盾的结果。
    entries = entry_files(files, project_dir)
    for p in files:
        if p in entries:
            continue
        rel_p = os.path.relpath(p, REPO)
        if lang == "ts":
            hit = False
            for q in files:
                if q == p:
                    continue
                for m in TS_SPEC.finditer(text[q]):
                    if _resolve_ts(q, m.group(1), alias, project_dir) == p:
                        hit = True
                        break
                if hit:
                    break
        else:
            rel = os.path.relpath(p, os.path.join(REPO, TARGETS["api-python"][0]))[:-3]
            rel = rel.replace(os.sep, ".").replace(".__init__", "")
            cands = {rel, ".".join(rel.split(".")[-2:]), rel.split(".")[-1]}
            hit = any(
                re.search(r"(?<![\w.])" + re.escape(c) + r"(?![\w])", text[q])
                for q in files
                if q != p
                for c in cands
            )
        if not hit:
            (devtool if is_devtool(rel_p) else dead).append(rel_p)
    return dead, devtool


# ---------------------------------------------------------------- B/C. duplicate symbols

TS_EXPORT = re.compile(
    r"export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)"
)
PY_TOP = re.compile(r"^(?:def|class)\s+([A-Za-z_][\w]*)", re.M)
PY_CONST = re.compile(r"^([A-Z][A-Z0-9_]{2,})\s*[=:]", re.M)


def symbols(files: list[str], lang: str) -> dict[str, list[str]]:
    """symbol -> 定义它的文件列表。"""
    table: dict[str, list[str]] = {}
    for p in files:
        text = open(p, encoding="utf-8", errors="replace").read()
        names: set[str] = set()
        if lang == "ts":
            names |= set(TS_EXPORT.findall(text))
        else:
            names |= set(PY_TOP.findall(text))
            names |= set(PY_CONST.findall(text))
        for n in names:
            table.setdefault(n, []).append(os.path.relpath(p, REPO))
    return table


# 天然同名、不构成「重复实现」的样板符号 / 入口包装层。
NOISE = {
    "main", "ROOT", "SCRIPT_DIR", "_q", "q", "_val", "CONFIG", "CONFIG_PATH",
    "XML", "PIPELINE", "check", "templates", "list_templates",
    # MCP 工具面是 style_core / clone_core 的薄包装，单一职责，不是第二份实现
    "list_styles", "save_style", "save_template", "remove_template",
    "analyze_docx", "clone_template",
}


def duplicates(table: dict[str, list[str]], min_files: int = 2) -> list[dict]:
    out = []
    for name, where in sorted(table.items()):
        if name in NOISE:
            continue
        uniq = sorted(set(where))
        if len(uniq) >= min_files:
            out.append({"symbol": name, "files": uniq})
    return out


# ---------------------------------------------------------------- main

def scan(target: str) -> dict:
    rel_root, exts, rel_project = TARGETS[target]
    root = os.path.join(REPO, rel_root)
    project_dir = os.path.join(REPO, rel_project)
    if not os.path.isdir(root):
        return {"target": target, "error": f"missing {rel_root}"}
    files = collect(root, exts)
    lang = "ts" if ".py" not in exts else "py"
    fileset = set(files)
    alias, _ = load_project_config(project_dir)
    # A0（入口可达性）只对 TS 成立：python 侧大量模块是 subprocess 调用而非 import，
    # 可达性会误报。python 侧一律看 A（全仓无人引用）。
    orphans: list[str] = []
    devtool_orphans: list[str] = []
    if lang == "ts":
        live = reachable_from_entries(files, lang, project_dir)
        for p in sorted(fileset - live):
            if p.endswith(ENTRY_PATTERNS):
                continue
            rel_p = os.path.relpath(p, REPO)
            (devtool_orphans if is_devtool(rel_p) else orphans).append(rel_p)
    dead, devtool = dead_modules(files, lang, project_dir)
    return {
        "target": target,
        "root": rel_root,
        "files": len(files),
        "alias": {k: os.path.relpath(v, REPO) for k, v in sorted(alias.items())},
        "entries": sorted(os.path.relpath(p, REPO) for p in entry_files(files, project_dir)),
        "dead_modules": dead,
        "devtool_modules": sorted(set(devtool) | set(devtool_orphans)),
        "orphan_cluster": orphans,
        "dup_symbols": duplicates(symbols(files, lang)),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="单例扫描器：找出重复实现 / 未接线的第二份实现")
    ap.add_argument("target", choices=[*TARGETS, "all"])
    ap.add_argument("--json", action="store_true", help="输出 JSON 供脚本消费")
    args = ap.parse_args()

    targets = list(TARGETS) if args.target == "all" else [args.target]
    reports = [scan(t) for t in targets]

    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0

    for r in reports:
        print(f"\n=== {r['target']}  ({r.get('files', 0)} files, {r.get('root','')}) ===")
        if r.get("error"):
            print("  !!", r["error"])
            continue
        if r.get("alias"):
            print("  入口/别名: " + ", ".join(f"{k}->{v}" for k, v in r["alias"].items()))
        print(f"A0. 入口不可达孤岛 orphan-cluster ({len(r['orphan_cluster'])}):")
        for d in r["orphan_cluster"]:
            print(f"   - {d}")
        print(f"A. 无人 import 的模块 dead-module ({len(r['dead_modules'])}):")
        for d in r["dead_modules"]:
            print(f"   - {d}")
        dt = r.get("devtool_modules", [])
        print(f"D.devtool 人工诊断脚本（保留，不计缺陷）({len(dt)}):")
        for d in dt:
            print(f"   - {d}")
        ds = r["dup_symbols"]
        print(f"B/C. 同名符号/常量多份定义 ({len(ds)}):")
        for d in ds[:40]:
            print(f"   - {d['symbol']}  ->  {', '.join(d['files'])}")
        if len(ds) > 40:
            print(f"   ... 另有 {len(ds)-40} 条，用 --json 取全量")
    return 0


if __name__ == "__main__":
    sys.exit(main())
