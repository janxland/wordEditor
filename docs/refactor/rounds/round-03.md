# Round 03 — 扫描器误报修复 + OOXML 命名空间单例化

- 时间：2026-10-04 14:33–14:52
- 轮前 HEAD：`a2c7ab8`（round 02 回写）
- 缺陷：5 条（D12–D16），**5/5 闭环**
- 产物等价：**28/28 部件逐字节一致**
- 净行数：**+320 / −55**（本轮是净增，原因见 §净行数说明 —— 去重的收益不是行数）

---

## 判定口径

本轮两条主线，性质完全不同：

- **D12/D13 是「工具缺陷」**。量具坏了，量出来的数全是假的。第 02 轮发现
  `singleton-scan frontend` 报 A0=60 / A=34，连 `src/main.tsx` 都被判成孤岛 ——
  这不是前端有 60 个缺陷，是**扫描器不认识 Vite 的入口**。不修就照着删，
  第 04 轮会把整个前端删空。所以 D12 排在最前，且是唯一允许"改工具"的条目。
- **D14 是「事实常量多例」**。URI 字符串被抄了 8 份，改一处漏七处，
  症状是 `find()` 静默返回 None（格式没生效，不报错），极难定位。

---

## D12 · 扫描器不认 Vite 入口（P0，工具缺陷）

**判定依据**：`apps/wordEditor-frontend/src` 82 文件被判 A0=60 / A=34，
而 `src/main.tsx` 是 `index.html` 里 `<script type="module" src="/src/main.tsx">`
指向的真入口。老扫描器只认 `main.ts / index.ts / server.ts` 等文件名
（`main.tsx` 不在列），且依赖解析正则 `(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]`
只吃**相对 specifier**，对 `@/pages/XxxPage` 这种别名 + `lazy(() => import(...))`
这种动态导入一律失配 → 整棵依赖树从入口断掉。

**两份实现是否等价**：不适用（改的是检测工具本身，不是被测代码）。

**改动**（`tools/singleton-scan.py`）：

| # | 修复 | 实现 |
|---|---|---|
| 1 | 入口探测 | 新增 `load_project_config()`：① `index.html` 的 `<script src>`（Vite 默认入口）② `vite.config.*` 的 `build.rollupOptions.input` / `build.lib.entry` ③ `package.json` 的 `main`/`module`/`bin` ④ `ENTRY_PATTERNS` 文件名兜底 |
| 2 | 路径别名 | 解析 `vite.config.*` 的 `resolve.alias`（含 `path.resolve(__dirname,'src')` 形态）+ `tsconfig.json` 的 `compilerOptions.paths`（带 `baseUrl`），最长前缀优先匹配 |
| 3 | 动态 specifier | 依赖正则改为 `(?:from\|import\|require)\s*\(?\s*['"]([^'"]+)['"]`，覆盖 `import()` / `require()`；`_resolve_ts()` 支持相对 / 工程根绝对 / 别名 / ESM 的 `.js→.ts` 还原 |
| 4 | `.d.ts` 排除 | `.d.ts` 只有类型、无运行时实体，从扫描集合里剔除（前端 3 个：`vite-env.d.ts` / `types/*.d.ts`） |

**行为变更点**：
- 前端扫描文件数 82 → 79（剔 `.d.ts`）。
- 新增输出 `D.devtool`（见 D13），`dead_modules` 不再混入 devtool。
- 新增 `alias` / `entries` 两个 JSON 字段（`--json` 可消费），便于人工核对入口识别是否正确。
- **api-node / api-python 既有数字未变差**（见 E4）。

**交叉验证（不是"看着对"）**：把入口**只保留 index.html 探测出来的 `main.tsx` 一个**，
关掉 `index.ts` / `routes/` 等一切兜底规则，重跑 BFS → **0/79 不可达**。
这证明 A0=0 不是"把一堆文件划成入口"刷出来的，而是真从 main.tsx 走得到。

---

## D13 · devtool 白名单进扫描器（P1）

**判定依据**：`services/api-python/pipeline/tools/`（3 个脚本 + README.md）
每轮都被 A 口径命中，每轮都要人工重判一次「是有 README 的诊断工具，不是死代码」。
重复劳动且容易漏判。

**改动**：`tools/singleton-scan.py` 新增 `DEVTOOL_DIRS` 白名单 +
`is_devtool(rel)`（路径前缀 + 目录内 README / 目录名 `tools`）。
命中的模块从 `dead_modules` / `orphan_cluster` 里**摘出来**，
单列成 `D.devtool 人工诊断脚本（保留，不计缺陷）`，**不与缺陷数混算**。

**行为变更点**：api-python 的 A 口径 3 → 0（那 3 条改记到 D.devtool）。
这是口径修正，不是"把缺陷抹掉"—— 它们本来就被判定 KEEP（Backlog D06），
现在只是不再占缺陷计数。

---

## D14 · OOXML 命名空间 URI 单例化（P1，真重复）

**判定依据**：同一个 URI 字符串被抄了 **8 份**（逐字相同，无一是第二语义）：

| 文件 | 原本地定义 |
|---|---|
| `clone_core.py` | `W` `R` `NS={"w","r"}` |
| `template_verify.py` | `W` |
| `tpl_factory/ooxml.py` | `W` |
| `tpl_factory/slices.py` | `W`（**bytes 字面量**，字节切片补 xmlns 用） |
| `pipeline/ooxml_util.py` | `W` `XML` `NS={"w"}` |
| `pipeline/ooxml_schema_order.py` | `W` `NS={"w"}` |
| `pipeline/ooxml_numbering.py` | `NS={"w"}` |
| `pipeline/ooxml_multilevel.py` | `W`（且已从 ooxml_util import 了一份，本地再覆盖） |
| `pipeline/ooxml_list_styles.py` | `W`（同上：import 了又覆盖） |
| `pipeline/extract_docx_to_md.py` | `W_NS` `R_NS` |
| `pipeline/tools/extract_list_styles.py` | `W` `NS` |
| `pipeline/tools/inspect_heading_numbering.py` | `NS` `W` |

**两份实现是否等价**：URI 字符串**与 XML 栈无关**（ET / lxml / python-docx 用同一批 URI），
所以可以安全合并。`q()` / `_q()` / `Q()` 这类**构造函数不合并** —— 第 02 轮已判定
（`_set_wordwrap_zero` 的 ET 版与 lxml 版元素类型不通用），本轮维持。

⚠️ **取值冲突**：`NS` 合并前存在两种值 —— `ooxml_util` 系 `{"w": W}`，
`clone_core` 系 `{"w": W, "r": R}`。取**超集** `{"w": W, "r": R}`。
依据：全仓 `NS` 的用法已逐处核对，**100% 是 `find`/`findall`/`xpath` 的前缀映射**，
ET 与 lxml 都只解析路径里实际出现的前缀，多给前缀不改变任何一次查找的结果；
无一处用于序列化。E6（28/28 逐字节一致）已实证。

**改动**：新建 `services/api-python/ooxml_ns.py`（唯一定义 `W` / `R` / `XML` / `NS`），
11 个模块改为 import，删掉本地定义。`pipeline/` 与 `pipeline/tools/` 下的模块
在既有 `sys.path` 前导里补一行把 api-python 根塞进去（`ooxml_ns.py` 在根，不在 pipeline/）。

**行为变更点**：
- `ooxml_util.NS` 从 `{"w": W}` 变 `{"w": W, "r": R}`（超集，查找结果不变）。
- `pipeline/extract_docx_to_md.py` 用 `from ooxml_ns import R as R_NS, W as W_NS`
  —— 该文件的 `W`/`R` 是带花括号的 `{uri}` 形态，不能与 URI 同名，故以别名引入。
- 全仓 `wordprocessingml` / `officeDocument/2006/relationships` / `XML/1998` 三个 URI
  的硬编码残留：**0**（`grep` 复验）。

---

## D15 · 用修好的扫描器重扫前端（P2）

**结果：前端 0 缺陷。**

```
=== frontend  (79 files, apps/wordEditor-frontend/src) ===
  入口/别名: @->apps/wordEditor-frontend/src
A0. 入口不可达孤岛 orphan-cluster (0):
A. 无人 import 的模块 dead-module (0):
D.devtool 人工诊断脚本（保留，不计缺陷）(0):
B/C. 同名符号/常量多份定义 (0):
```

改前 A0=60 / A=34 → 改后 **A0=0 / A=0**，B/C 前后都是 0。
文件数 82 → 79（剔 3 个 `.d.ts`）。

**没有追加 D17+**，因为修完误报后没有一条是真缺陷（交叉验证见 D12 末尾的
"只留 main.tsx 单入口"复跑）。

**扫描器残余局限（如实记录）**：B/C 口径对 TS 只扫 `export` 符号，
**非导出的重复私有函数扫不到**；前端的重复更可能藏在那里。要覆盖需另加一条
"函数体相似度"口径，不在本轮范围。

---

## D16 · 跨引擎共享事实体检（P2，只判定与记录）

**结论：两处共享事实都已是单一来源，未发现真重复，本轮不改代码。**

### ① `contracts/openapi.json` vs 两侧路由注册 —— 一致，单一来源

契约实际是 **11 个 path / 12 个 operation**（`/api/file` 有 `get`+`put`）。

| path | openapi.json | Node 注册 | Python 注册 |
|---|:-:|:-:|:-:|
| `/` | ✓ | `http/routes/system.ts:11` | `app.py:566` |
| `/api/health` | ✓ | `system.ts:32` | `app.py:296` |
| `/api/tools` | ✓ | `system.ts:35` | `app.py:301` |
| `/api/templates` | ✓ | `templates.ts:14` | `app.py:316` |
| `/api/templates/reference-styles` | ✓ | `templates.ts:21` | `app.py:328` |
| `/api/docs` | ✓ | `files.ts:20` | `app.py:342` |
| `/api/file` get+put | ✓ | `files.ts:26,31` | `app.py:352,360` |
| `/api/build/stream` | ✓ | `build.ts:41` | `app.py:448` |
| `/api/build/download` | ✓ | `build.ts:109` | `app.py:462` |
| `/api/preview/styles` | ✓ | `build.ts:133` | `app.py:374` |
| `/api/import/docx` | ✓ | `import.ts:15` | `app.py:481` |

两侧都**不是各自抄一份契约**：Node `http/contract.ts:18` 与 Python `app.py:558`
读的是同一个 `contracts/openapi.json`。**判定：单一来源，无重复。**

> 附注：Node 另有 `docorder/routes.ts`（10 条 `/api/auth/*`、`/api/doc-orders/*`）
> 与 `downloads.ts`（2 条），不在契约内 —— 这是**独立的业务模块**，不是契约的第二份实现，
> 不属去冗余口径（Python 侧没有对应实现，不构成多例）。

### ② `config/templates.json` 是否被硬编码 —— 清单本身单一，但「默认模板 id」有 4 处事实源

`config/templates.json` 是唯一清单（10 个模板，`hutb-guanke` 标 `default: true`），
两侧都读它，**清单本身没有被抄第二份**。

但「默认模板是 `hutb-guanke`」这个**事实**散在 4 处：

| 位置 | 形态 |
|---|---|
| `config/templates.json` | `"default": true` |
| `pipeline/build.py:33` | `DEFAULT_TEMPLATE_ID = "hutb-guanke"` |
| `direct.py:73` | 函数签名默认参数 `template_id: str = "hutb-guanke"` |
| `mcp_server.py:75` / `:84` | MCP 工具签名默认值 + `template_id or "hutb-guanke"` 兜底 |
| `api-node/src/pipeline/templates.ts:13` | `FALLBACK_TEMPLATE_ID = 'hutb-guanke'`（+ `:10` 别名表） |

**本轮判定：不改，记为 D18。** 理由：
1. 它们分属**三个进程边界** —— `build.py` 是被 `direct.py` 以 **subprocess**
   调用的（`direct.py:104`），不可能与调用方共享一个 Python 常量；
2. MCP 工具签名里的默认值是**对外发布的 schema 的一部分**，agent 能看到，
   改成"从别处 import 的常量"会让 schema 的默认值来源变隐晦；
3. 改动会触及 `direct.py` / `mcp_server.py` 两个**轮前就已脏**（含 10-03 未提交改动）
   的公开接口文件，违反硬规则 2「只动本轮 5 个缺陷点涉及的文件」与"改动范围最小化"。

→ 已按 D16 要求**记录**为 Backlog D18，附上面这张表，下一轮可直接凭此决策。

---

## 净行数说明（本轮是净增，不是净删）

| 分组 | + | − | 说明 |
|---|---:|---:|---|
| `tools/singleton-scan.py` | 237 | 34 | D12+D13：入口/别名/动态导入/`.d.ts` 四套新逻辑 + devtool 白名单 |
| `ooxml_ns.py`（新文件） | 31 | 0 | D14：唯一命名空间定义 |
| D14 各模块 import 替换 | 52 | 21 | 11 个模块删本地定义、加 import + sys.path 前导 |
| **合计** | **320** | **55** | **净 +265** |

去重的收益**不体现在行数上**：`wordprocessingml` / `relationships` / `XML` 三个 URI
在 api-python 全仓的硬编码份数 **8+ → 1**（`grep` 复验残留 0）。本轮轮前工作区已有一批
未提交改动（`direct.py` / `mcp_server.py` / `preview_images.py` / `tpl_factory/assets.py` 等），
**均未纳入本轮提交**（见 §提交范围）。

---

## 证据

| # | 项 | 结果 |
|---|---|---|
| E1 | 轮前 HEAD / 工作区 | `a2c7ab8`；`git status --porcelain` 见下（10 个 M 为轮前遗留，未纳入本轮） |
| E2 | `cd services/api-node && npx tsc --noEmit` | **0 error**（无输出） |
| E3 | `compileall -q services/api-python` + 16 个模块 import 自检 | 全 OK：`ooxml_ns` `clone_core` `style_core` `template_factory` `template_verify` `mcp_server` `direct` `pipeline.ooxml_util` `ooxml_schema_order` `ooxml_numbering` `ooxml_multilevel` `ooxml_list_styles` `extract_docx_to_md` `build` `tpl_factory.ooxml` `tpl_factory.reference`；另 `tpl_factory` 全包（slices/reference/workflow/detect/assets）import OK；两个 devtool 脚本 `--help` 独立运行 OK |
| E4 | 单例扫描（三个 target） | api-node 62 文件 **A0=0/A=0/B=0**（与第 02 轮持平）<br>api-python 40 文件 **A0=0/A: 3→0（3 条改记 D.devtool）/B+C=0**（持平）<br>frontend **79 文件 A0: 60→0 / A: 34→0 / B+C=0** |
| E5 | `bin/we templates` | 正常输出 10 个模板（含 `hutb-shehui-diaocha`） |
| E6 | 产物等价（`hutb-guanke`，`input/暑假社会调查报告-样例.md`） | **28/28 部件逐字节一致**（strip `dcterms` 时间戳 + rsid + 任务路径；改前用 `git worktree add /tmp/r3base HEAD --detach` 独立构建，跑完 `git worktree remove --force` 已清理；改 `slices.py` 后**重跑过一次**，仍 28/28） |

---

## 提交范围

只 `git add` 本轮改到的 **14 个文件**（无 `git add -A`）：

```
tools/singleton-scan.py
services/api-python/ooxml_ns.py                     (新增)
services/api-python/clone_core.py
services/api-python/template_verify.py
services/api-python/pipeline/ooxml_util.py
services/api-python/pipeline/ooxml_schema_order.py
services/api-python/pipeline/ooxml_numbering.py
services/api-python/pipeline/ooxml_multilevel.py
services/api-python/pipeline/ooxml_list_styles.py
services/api-python/pipeline/extract_docx_to_md.py
services/api-python/pipeline/tools/extract_list_styles.py
services/api-python/pipeline/tools/inspect_heading_numbering.py
services/api-python/tpl_factory/ooxml.py
services/api-python/tpl_factory/slices.py
```

轮前已脏的 `direct.py` / `mcp_server.py` / `preview_images.py` / `tpl_factory/assets.py` /
`tpl_factory/workflow.py` / `README.md` / `bin/we` 等**一律不碰**。

---

## 风险与遗留

- **扫描器 B/C 口径不覆盖非导出符号**（TS 只看 `export`），前端若藏重复更可能在那里 → 记为 D19。
- `ooxml_util.NS` 由 `{"w"}` 变 `{"w","r"}` 超集：当前全仓用法都是 find/findall/xpath，
  **若将来有人把 `NS` 拿去当序列化前缀表用，多出来的 `r` 会被写进产物** —— 已在
  `ooxml_ns.py` 注释里写明这条约束。
- D16 的「默认模板 id 4 处事实源」未收敛 → D18（附决策表）。
- `api-node` 的 `docorder/` 与 `downloads.ts` 路由不在 `contracts/openapi.json` 内，
  属契约**覆盖不全**（不是重复），是否补契约由用户决定。
