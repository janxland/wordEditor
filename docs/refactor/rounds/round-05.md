# Round 05 — 收敛判定（补全第 4 个扫描 target 后无多例可消）

- 时间：2026-10-04 15:36–15:52
- 轮前 HEAD：`1805a26`（round 04 回写）
- 结论：**判定收敛，停止建链**
- 代码改动：仅 `tools/singleton-scan.py`（**+32 / −1**），**产品代码零改动**
- 产物等价（E6）：**免做**，理由见 §E6 免做依据

---

## 结论先行

第 05 轮按 prompt 先跑三 target 复验 → **与第 04 轮后基线逐项一致，无新多例**。
但在结案前做了一次**覆盖边界核查**，发现一个前 4 轮都没人发现的洞：

> `apps/wordeditor-desktop`（Electron 桌面端）是 **git 已跟踪的第一方源码**
> （10 个 tracked 文件，其中 `src/main.ts` + `src/preload.ts`），
> **从未登记进扫描器的 `TARGETS` 表** —— 也就是说前 4 轮的「全 0」结论
> 有 **2 个文件从来没被扫过**。

所以本轮不是「什么都不做就宣布收敛」，而是：**把这个洞补上 → 修掉它暴露的
误报 → 重扫四个 target → 再把 192 个 git 跟踪源文件逐条对账确认没有第二个洞**，
之后才判收敛。

---

## D21 [新] · 扫描器漏登记 `desktop` target —— 已修

**判定依据**（不是猜的）：

| 检查 | 结果 |
|---|---|
| `git ls-files apps/wordeditor-desktop \| wc -l` | **10**（不是 untracked 产物，已入库） |
| 其中第一方源码 | `src/main.ts`、`src/preload.ts`、`scripts/deploy-releases.js` |
| 是否打包产物 | 否 —— `release/`、`resources/` 才是产物，源码在 `src/` |
| `TARGETS` 表（改前） | 只有 `api-node` / `api-python` / `frontend` 三个 |

**为什么前 4 轮没暴露**：三个既有 target 的输出数字一直很干净（0/0/0），
没人回头核对「TARGETS 表是否等于仓库实际源码树」。这是**工具覆盖盲区**，
不是代码缺陷 —— 性质和 D12（Vite 入口误报）同类，都是扫描器自身的问题。

**改动**：`TARGETS` 增补一项

```python
"desktop": ("apps/wordeditor-desktop/src", (".ts",), "apps/wordeditor-desktop"),
```

**补上之后立刻报出 1 条**（见 D22）。

---

## D22 [新] · `preload.ts` 被 A0/A 误报 —— 已修（Electron preload 入口识别）

**扫描器新报**：

```
A0. 入口不可达孤岛 (1): apps/wordeditor-desktop/src/preload.ts
A.  无人 import 的模块 (1): apps/wordeditor-desktop/src/preload.ts
```

**两份实现是否等价 / 是否真死代码**：**不是死代码，是误报。**

`src/main.ts:178` 以**运行时路径字符串**注入 preload：

```ts
preload: path.join(__dirname, 'preload.js'),
```

Electron 的 preload 不走 `import`，静态依赖图里永远看不到它。
这正是第 03 轮 D12 修过的同一类问题的**另一个宿主**（那次是 Vite 的
`index.html` script 入口，这次是 Electron 的 `webPreferences.preload`）。
且 `preload.ts` 有真实下游消费者：`apps/wordEditor-frontend/src/services/desktopBridge.ts`
依赖它注入的 `window.wordEditorDesktop`。

**改动（两处）**：

1. 新增 `electron_preload_entries()` —— 扫 `preload: … 'x.js'` 形式的字符串引用，
   把同源 `x.ts` 视为入口。
   > 坑：`path.join(__dirname, 'preload.js')` **自带逗号和括号**，
   > 第一版正则 `[^,\n)]*?` 在逗号处就断了、匹配不到；改成 `[^\n]*?` 才通。
2. `dead_modules()` 原来只按 `ENTRY_PATTERNS` 文件名兜底跳过入口，
   与 `reachable_from_entries()` 用的**完整入口集不一致** ——
   会出现「A0 说它可达、A 说它死了」的自相矛盾。改为共用 `entry_files()` 入口集。

**修后**：desktop `A0 1→0`、`A 1→0`、`B+C=0`。

**回归（改扫描器 = 改全仓判定，必须三 target 全跑）**：

| target | 文件 | A0 | A | D.devtool | B+C |
|---|---|---|---|---|---|
| api-node | 62 | 0 → **0** | 0 → **0** | 0 | 0 → **0** |
| api-python | 40 | 0 → **0** | 0 → **0** | 3 | 1 → **1**（D20 KEEP，未变差） |
| frontend | 79 | 0 → **0** | 0 → **0** | 0 | 0 → **0** |
| desktop | 2 | 1 → **0** | 1 → **0** | 0 | 0 → **0** |

`dead_modules()` 的入口集变更只会**减少** dead 判定，存在「误吞真死模块」的风险，
所以逐 target 对了改前/改后数字 —— **三个既有 target 全部数字不变**，
说明放宽没有掩盖任何东西。

---

## 收敛判定与依据

### 依据 1：四条机械口径在四个 target 上全 0

唯一剩下的两条命中都是**已判定保留**，不是缺陷：

| 命中 | 判定 |
|---|---|
| `DEFAULT_TEMPLATE_ID`（direct.py + pipeline/build.py） | **D20 KEEP** —— subprocess 边界，跨进程无法共享常量；故意不进 NOISE，保持可被报出 |
| `pipeline/tools/*` 3 个 | **D.devtool** —— 人工诊断脚本，有 README，第 03 轮起单列不计缺陷 |

### 依据 2：192 个源文件逐条对账 —— 不存在第二个 coverage 洞

D21 的教训是「TARGETS 表 ≠ 源码树」，所以这次**穷举对账**而不是再靠印象：

| 项 | 数量 |
|---|---|
| git 跟踪的 `.ts/.tsx/.py` 总数 | **192** |
| 落在四个扫描根内 | **185**（frontend 82 / api-node 62 / api-python 40 / desktop 2） |
| 其中 `.d.ts`（设计内排除，第 03 轮 D12） | 3 → 实际分析 **182** |
| 扫描根之外 | **7** |

扫描根外的 7 个逐条人工定性（**全是构建配置 / devtool，不是可重复的业务模块**）：

| 文件 | 性质 |
|---|---|
| `apps/wordEditor-frontend/vite.config.ts` | 构建配置 |
| `services/api-node/tools/parity.ts` | CLI 回归工具（devtool） |
| `templates/apa7/build_reference.py` | 模板构建脚本 |
| `templates/hutb-guanke-xuenian/build_blocks.py` | 模板构建脚本 |
| `tools/singleton-scan.py` | 扫描器自身 |
| `manual/inject_toc.py` | 手册文档用脚本 |
| `bin/we` | CLI 唯一入口（无扩展名，不在上表 192 内） |

**结论：覆盖已穷尽，没有第二个未被扫描的第一方源码树。**

### 依据 3：Backlog 全空

最新 Backlog 里 `OPEN` 条目 **0**；D01–D18 全 DONE，D19 CLOSED（评估后不值得做），
D20 KEEP。

---

## 为什么不建第 06 轮

prompt 的收敛条件是「无新多例可消」。本轮确实有新发现（D21/D22），
但**两条都落在扫描器工具本身**，且已在本轮修完；修完之后
**产品代码里没有任何一处多例待消**。

继续建链只会有两种结果，都违反硬规则：

1. 为凑 5 条去动**设计内双引擎**（Node/Python 两套等价实现）—— 明令禁止；
2. 做**顺手重构** —— 硬规则 2 明令禁止。

所以按 prompt §2 第 8 条「Backlog 全空且扫描无新发现 → 标 STATUS=收敛，停止建链」执行。

**剩余已知项（不是缺陷，是账）**：

- **D20**：改默认模板改 `config/templates.json:default_template`；
  万一要改兜底值，`direct.py` 与 `pipeline/build.py` 必须一起改（已互留注释）。
- **跨语言兜底值同步**：Node 侧 `pipeline/templates.ts:13 FALLBACK_TEMPLATE_ID`
  与 Python 侧兜底值分属两个引擎，**不合并**（设计内），但改值时需两侧同步。
- **D19**：函数体相似度口径经评估不值得做（42 个非导出函数 0 组跨文件重复）。
- **B/C 口径只扫 `export` 符号**，非导出的私有函数重复扫不到 —— 已知局限，
  D19 已评估该量级为 0，风险已量化。

---

## 证据

| # | 项 | 结果 |
|---|---|---|
| E1 | 轮前 HEAD / 工作区 | `1805a26`；`.gitignore` `README.md` `bin/we` `docs/blog-project-details.md` `services/api-node/src/docorder/auth.ts` `services/api-python/{README,mcp_server,preview_images,tpl_factory/assets,tpl_factory/workflow}` 等 12 项轮前已脏 —— **本轮一个没碰**（commit 只 add 本轮 3 个文件） |
| E2 | `cd services/api-node && npx tsc --noEmit` | **0 error**（无输出，exit 0） |
| E3 | `compileall -q services/api-python` | exit 0，无输出 |
| E3b | venv 全模块 import 自检（10 个） | 全 OK：`direct` `mcp_server` `clone_core` `style_core` `template_factory` `template_verify` `ooxml_ns` `pipeline.build` `ooxml_util` `ooxml_schema_order` |
| E3c | 扫描器自身 | `-m py_compile` OK；`all --json` 四 target 全跑通、exit 0 |
| E4 | 单例扫描（**四个** target，改前→改后） | 见 §D22 回归表：**无任何一项变差**，desktop 2→0 |
| E5 | `bin/we templates` | 正常输出 10 个模板，`hutb-guanke *默认` |
| E6 | 产物等价 | **免做**，依据见下 |

### E6 免做依据

本轮唯一改动文件是 `tools/singleton-scan.py`。全仓 grep 确认它**不在构建管线内**：
除 `.workbuddy/memory/*` 与 `docs/refactor/*` 外**无任何引用**，
`api-node` / `api-python` / `bin/we` 均不加载它。
**未触碰任何管线代码 → docx 产物不可能变化 → E6 免做。**

---

## 提交范围

只 `git add` 本轮改到/新增的 3 个文件：

```
tools/singleton-scan.py
docs/refactor/rounds/round-05.md
docs/refactor/ITERATION-STATE.md
```

轮前已脏的 12 个文件（含 `mcp_server.py` 等）**一律没碰、没入库**。

---

## 风险与遗留

- **扫描器语义变更**：`dead_modules()` 现在按完整入口集跳过入口，
  比改前**更宽松**。已用三 target 改前/改后数字逐项比对证明没吞掉真死模块，
  但今后每轮基线仍以本轮数字为准（api-node 62/0/0/0、api-python 40/0/0/1+3、
  frontend 79/0/0/0、desktop 2/0/0/0）。
- **desktop 只有 2 个源文件**，B/C 口径在这个体量上基本没有检出能力 ——
  它入库的意义是「覆盖完整」，不是「能查出东西」。
- 若日后新增 app/服务目录，**必须同步登记 `TARGETS`**，
  否则会重演 D21 的静默盲区（已写进 ITERATION-STATE.md 硬规则）。
