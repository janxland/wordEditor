# 去冗余迭代 · 状态机

> **唯一状态源。** 每轮（round）由定时任务驱动，机器读本文件决定「这一轮做什么」，
> 完成后回写本文件 + 在 `rounds/round-NN.md` 留痕 + 创建下一轮定时任务。
> 用户喊停 = 在本目录建 `STOP` 文件（或在定时任务列表里暂停）。

---

## 0. 目标与判定口径

**目标：一个功能只有一份实现（单例），没有第二份（多例）。**

「多例」= 同一个功能在 ≥2 处各写了一遍。危害不是行数，是**改错实例**：
改了 A 没改 B，问题照旧，且后续每轮都在错误的那份上打补丁。

三条机械判定口径（由 `tools/singleton-scan.py` 输出，唯一检测入口，不要另写扫描脚本）：

| 口径 | 含义 | 典型形态 |
|---|---|---|
| A0 orphan-cluster | 入口不可达的模块孤岛（互相引用但整体没人用） | 一整套功能被复制进来却没接线 |
| A dead-module | 全仓无人引用的模块 | 上一代实现的残骸 |
| B/C dup-symbol | 同名函数/常量在 ≥2 个文件各定义一份 | 私有辅助函数被复制粘贴 |

**双后端不是冗余。** `services/api-node`（8787）与 `services/api-python`（8788）
是设计内的两套等价实现，**不要**把其中一套往另一套合并，也不要删其中一套。
要盯的是：每套**内部**有没有第二份；以及跨引擎共享的**事实**（常量、契约、
模板清单）有没有被各自硬编码一份。

**`pipeline/tools/*`、`tools/*` 是 devtool 不是死代码**：有 README 说明、
供人工诊断用，A 口径会命中，**已判定保留**，不要删。

---

## 1. 硬规则（违反即作废该轮改动，回滚重来）

1. **先备份再改。** 目标文件若在工作区里已是 `M` 状态（上一轮遗留未提交），
   先把 `git diff <file>` 存到 `rounds/round-NN/backup/<name>.patch` 再动手。
2. **只动本轮 5 个缺陷点涉及的文件。** 禁止顺手重构、禁止改样式数值、
   禁止改模板 `spec.yaml` / `styles.yaml` / `reference.docx`、禁止改业务逻辑语义。
3. **删除 = 删除零引用。** 删前必须双证：① `tools/singleton-scan.py` 命中
   ② `git grep -n "<symbol>"` 全仓（含 `apps/` `bin/` `docs/` `manual/`）零业务引用。
   只有注释/README 命中的可以删。
4. **合并 = 保留一份，另一份变 import。** 不允许两份都留、不允许加兼容层。
   真源判定顺序：**被入口实际调用的那份 > 有测试覆盖的那份 > 更完整的那份**。
   两份值不一致时**以被实际调用的那份为准**，并在 round 报告里标 `⚠️ 取值冲突`。
5. **每轮必须留可回滚点**：本轮结束后 `git add <本轮改到的具体文件> && git commit -m
   "refactor(dedup): round NN — <5 个缺陷一句话>"`。不要 `git add -A`（会夹带无关改动）。
6. **证据不闭环不算完成。** 每轮必须有下面 §3 的全套证据，写进 `rounds/round-NN.md`。
   "看着对 / 应该没问题" 一律作废。
7. **【第 05 轮新增】新增 app / 服务目录必须同步登记 `tools/singleton-scan.py` 的 `TARGETS`。**
   D21 的教训：`apps/wordeditor-desktop` 是 git 已跟踪的第一方源码，却**前 4 轮从没被扫过**，
   于是「三 target 全 0」一度是个**假象**。判收敛前必须先做覆盖对账：
   `git ls-files | grep -E "\.(ts|tsx|py)$"` 与 `TARGETS` 各扫描根求差集，
   差集里的每一个都要人工定性（构建配置 / devtool / 真源码）。

---

## 2. 每轮流程（机器照做）

```
1. 若 docs/refactor/STOP 存在 → 立即停止，不建下一轮，只回写本文件说明。
2. 读本文件 → 取 CURRENT_ROUND 与 Backlog 里 Status=OPEN 的前 5 条。
3. Backlog 不足 5 条 → 跑 tools/singleton-scan.py 补（新发现标 [新]）。
4. 逐条处置（改代码）→ 每条都跑证据 → 回写 Backlog 该行 Status。
5. 全量回归（§3）→ 写 rounds/round-NN.md → git commit。
6. 回写本文件：CURRENT_ROUND+1、更新 Backlog、更新「轮次台账」。
7. 创建下一轮定时任务（automation_update，once，scheduledAt = 现在 **+3 分钟**，
   用 `date -v+3M "+%Y-%m-%dT%H:%M"` 取真实时间），并把新 automation id 写进
   NEXT_AUTOMATION_ID。用户要求轮间隔 ≤5 分钟，不许排到几小时后。
8. Backlog 全空且扫描无新发现 → 标 STATUS=收敛，停止建链，向用户报告。
```

---

## 3. 证据清单（每轮都要，缺一项就不许 commit）

| # | 证据 | 命令 |
|---|---|---|
| E1 | 改动前基线 | `git rev-parse HEAD` + `git status --porcelain` 存进 round 文件 |
| E2 | TS 类型 | `cd services/api-node && npx tsc --noEmit`（须 0 error） |
| E3 | Python 语法 | `python -m compileall -q services/api-python` |
| E4 | 单例扫描 | `python tools/singleton-scan.py api-node` / `api-python`（对比轮前后数字） |
| E5 | CLI 冒烟 | `bin/we templates` 与 `bin/we --help` 有正常输出 |
| E6 | 产物等价（只在动到管线时做） | 同一输入构建两次，docx 按部件解 zip 后逐字节一致（strip `dcterms` 时间戳） |

`python` 用托管版：`/Users/Admin1/.workbuddy/binaries/python/versions/3.13.12/bin/python3`
（`python3` 基础版没装 pyyaml/uvicorn）。

---

## 4. 状态机

| 字段 | 值 |
|---|---|
| STATUS | **`收敛`**（第 05 轮判定，2026-10-04 15:52；**链条已停止，不再建第 06 轮**） |
| CURRENT_ROUND | `05`（终轮） |
| NEXT_AUTOMATION_ID | **无 —— 已收敛停链** |

> ## ✅ 收敛判定（第 05 轮）
>
> 1. **四条机械口径 × 四个 target 全 0**：api-node 62/0/0/0、api-python 40/0/0、
>    frontend 79/0/0/0、desktop 2/0/0/0。剩余命中仅两类已判保留项：
>    **D20**（`DEFAULT_TEMPLATE_ID`，subprocess 边界）与 **D.devtool=3**（人工诊断脚本）。
> 2. **覆盖已穷尽**：192 个 git 跟踪 `.ts/.tsx/.py` 逐条对账 —— 182 个在扫描根内被分析，
>    3 个 `.d.ts` 设计内排除，扫描根外 7 个全为构建配置/devtool 并已逐条定性。
>    **不存在第二个未被扫描的第一方源码树。**
> 3. **Backlog OPEN = 0**（D01–D18 DONE / D19 CLOSED / D20 KEEP）。
>
> 第 05 轮唯一改动是**扫描器自身**（补登记 desktop target + 修 Electron preload 入口误报），
> **产品代码零改动**。继续建链只会导致动设计内双引擎或顺手重构，均违反硬规则 → **停链**。

> **节奏（用户 2026-10-04 14:23 明确要求）**：轮间隔 **≤5 分钟**，不许排到几小时后。
> 每轮最后一步用 `date -v+3M "+%Y-%m-%dT%H:%M"` 取真实时间建下一轮。
| STOP 条件 | `docs/refactor/STOP` 存在 / 用户手动暂停 / Backlog 收敛 |

> 链条机制：每轮定时任务跑完，自己在最后一步创建下一轮（+2h，once），
> 并把新 id 回写本文件。要停就在本目录建 `STOP` 文件，或在定时任务列表暂停/删除。

**已完成轮次**

| 轮 | 主题 | 缺陷数 | 报告 |
|---|---|---|---|
| 01 | Node 工厂整簇删除 + Python OOXML 辅助/常量收敛 | 5/5 闭环 | [round-01.md](rounds/round-01.md) |
| 02 | 同名符号消歧（patch_docx×4 / patch_document×2）+ CODE_STYLE_IDS·wordwrap·W/NS/q 单例化 | 5/5 闭环 | [round-02.md](rounds/round-02.md) |
| 03 | 扫描器 Vite 入口/别名/动态 import 误报修复 + devtool 单列；OOXML 命名空间 URI → `ooxml_ns` 单一定义 | 5/5 闭环 | [round-03.md](rounds/round-03.md) |
| 04 | 默认模板兜底值 → `direct.DEFAULT_TEMPLATE_ID`（mcp_server 5 处字面量→0）；D19 深水口径评估后判定不值得做；双引擎 schema 顺序表逐项比对 | 3 条实质 + 1 项比对（扫描补不满 5 条） | [round-04.md](rounds/round-04.md) |
| 05 | **收敛轮**：补登记第 4 个扫描 target `desktop`（前 4 轮从没扫过）+ 修 Electron preload 入口误报；192 文件逐条对账确认无 coverage 洞 | 2 条（**均为扫描器工具缺陷**，产品代码零改动） | [round-05.md](rounds/round-05.md) |

> **注**：上表 5 轮的代码改动已归到一个 `refactor(dedup)` 提交、台账与规约归到一个 `docs` 提交，
> 各轮正文里的「轮前 HEAD」是当时的真实历史记录，保留原值不必改写。
> 如需回溯逐轮的原始 commit，见备份 tag **`backup/pre-squash-20261004`**。

**下一轮**：**无 —— 已收敛，链条已停止。**
> 若要重启迭代：删掉本文件的收敛段落、把 STATUS 改回 `RUNNING`、CURRENT_ROUND 设为下一轮号，
> 再手动建一条定时任务即可。重启前建议先确认是否有**新写的**第一方源码目录（见下方新增硬规则）。

**基线（第 05 轮后 · 收敛基线，今后每轮以此为准）**

| target | 文件 | A0 | A | D.devtool | B+C |
|---|---|---|---|---|---|
| api-node | 62 | 0 | 0 | 0 | 0 |
| api-python | 40 | 0 | 0 | 3 | 1（D20 KEEP） |
| frontend | 79 | 0 | 0 | 0 | 0 |
| desktop | 2 | 0 | 0 | 0 | 0 |

---

## 5. Backlog（待处置池）

> Status: `OPEN` 待做 / `DOING` / `DONE` / `KEEP` 已判定保留（非缺陷）
> 每条 `文件` 列必须写到可 grep 的路径。

| ID | Prio | 口径 | 缺陷（多例在哪） | 文件 | 处置方向 | Status |
|---|---|---|---|---|---|---|
| D01 | P0 | A0 | Node 侧 `src/pipeline/factory/**` 共 8 个模块（1955 行）**整簇入口不可达**：模板工厂的第二份实现，从未接线。 | `services/api-node/src/pipeline/factory/*.ts` | 已删除整簇（备份在 `rounds/round-01/backup/`，未入库） | **DONE** |
| D02 | P0 | B | `_ensure_ppr` / `_ensure_rpr` / `_replace_child` / `_line_spacing_attrs` + `_q`/`W`/`NS` 在 `ooxml_multilevel.py` 与 `postprocess_styles.py` **各写一份** | `ooxml_util.py`（新唯一层）<br>`ooxml_multilevel.py`<br>`postprocess_styles.py`<br>`ooxml_list_styles.py` | 已抽到 `ooxml_util`，140 处 `_q(` 改调 `q(` | **DONE** |
| D03 | P1 | B | `_max_abstract_id` 在 `ooxml_list_styles.py` 与 `ooxml_multilevel.py` 各一份（逐字相同） | `ooxml_numbering.py`<br>`ooxml_list_styles.py`<br>`ooxml_multilevel.py` | 已收敛为 `ooxml_numbering.max_abstract_id` | **DONE** |
| D04 | P1 | C | `TAIL_MARKERS` 两份：clone_core 窄 4 词 vs detect 宽 9 词（超集） | `clone_core.py`<br>`tpl_factory/detect.py` | 已取并集落 `clone_core`，detect import。⚠️ legacy `extract_tail` 命中变宽 | **DONE** |
| D05 | P1 | C | `WORDEDITOR_ROOT` 两份（一份硬编码本机绝对路径）；`_para_text`/`_style_names` 两份 | `clone_core.py`<br>`style_core.py`<br>`tpl_factory/ooxml.py` | 已合并为 `env > __file__ 推导` 放 clone_core，消掉硬编码 | **DONE** |
| D06 | KEEP | A | `pipeline/tools/*`（3 个脚本）被 A 口径命中，但有 README、供人工诊断 → 非缺陷 | `services/api-python/pipeline/tools/` | 保留，不删 | KEEP |
| D07 | P1 | C | `CODE_STYLE_IDS` 三份（third_line_table 的 `_CODE_STYLE_IDS` tuple + verbatim/postprocess_document 的 set），取值逐值相同 | `ooxml_util.py`<br>`ooxml_three_line_table.py`<br>`ooxml_verbatim_table.py`<br>`postprocess_document.py` | 已收敛为 `ooxml_util.CODE_STYLE_IDS`（frozenset） | **DONE** |
| D08 | P1 | B | `_set_wordwrap_zero` 两份：**假重复**（ET 栈 vs python-docx/lxml 栈，元素类型不通用） | `ooxml_util.py`<br>`postprocess_styles.py`<br>`tpl_factory/reference.py` | 不合并；ET 版入 `ooxml_util.set_wordwrap_zero`，lxml 版改名 `_set_wordwrap_zero_docx` 并互留注释。⚠️ 发现 `_set_or_replace` 与 `replace_child` 语义不同（就地改 vs 重建追加），会挪动 `w:wordWrap` 在 pPr 的位置 → 共享版改成就地 set 保字节等价 | **DONE** |
| D09 | P1 | B | `patch_document` 两份：**假重复**（一个改表格边框，一个把代码段包成表，签名不同） | `ooxml_three_line_table.py`<br>`ooxml_verbatim_table.py` | 按职责改名 `patch_document_three_line` / `patch_document_verbatim`，不合并 | **DONE** |
| D10 | P1 | B | `patch_docx` **四份**：**假重复**（各脚本自己的 CLI 出口，签名/返回值全不同） | 三/verbatim/postprocess_document/postprocess_styles | 全部改名：`patch_docx_three_line` / `_verbatim` / `_document` / `_styles` | **DONE** |
| D11 | P2 | B/C | `_q`/`W`/`NS`/`XML` + `_w_attr`（`_q` 的别名）在 apply_docx_header_footer、list_reference_styles、ooxml_three_line_table、ooxml_verbatim_table 各一份 | 同上 4 个文件 | 已全部收敛到 `ooxml_util`；`_w_attr` 直接换 `q()` | **DONE** |
| D12 | **P0** | 工具 | **扫描器自身缺陷**：`singleton-scan frontend` 报 A0=60 / A=34，连 `src/main.tsx` 都被判孤岛。入口识别不认 Vite 的 `index.html` script 入口、不认路由动态 `import()`；`.d.ts` 也被算成 dead-module。**工具缺陷不修会在后续轮次误删前端** | `tools/singleton-scan.py` | **DONE**：入口探测（index.html / vite config / package.json）+ 别名解析（vite alias + tsconfig paths）+ 动态 `import()`/`require` + 排除 `.d.ts`。前端 A0 60→0 / A 34→0；api-node、api-python 数字未变差。交叉验证：只留 `main.tsx` 单入口重跑 BFS → 0/79 不可达 | **DONE** |
| D13 | P1 | A | `pipeline/tools/*`（3 个 devtool）每轮都被 A 口径命中、每轮人工重判一次 | `tools/singleton-scan.py` | **DONE**：`DEVTOOL_DIRS` + `is_devtool()` 写进扫描器，输出单列 `D.devtool（保留，不计缺陷）`。api-python A 口径 3→0（3 条改记 D.devtool） | **DONE** |
| D14 | P1 | C | OOXML 命名空间 URI 仍在 8+ 处各写一份 | `services/api-python/**` | **DONE**：新建 `ooxml_ns.py`（W/R/XML/NS），11 个模块改为 import。⚠️ `NS` 取超集 `{"w","r"}`（原有两种值）。全仓 URI 硬编码残留 **0**。`q()`/`_q()` 仍按 ET/lxml 分栈各留一份 | **DONE** |
| D15 | P2 | — | 用修好的扫描器重扫前端，收录**修完仍为真**的缺陷 | `apps/wordEditor-frontend/src` | **DONE**：**前端 0 缺陷**（79 文件 A0=0 / A=0 / B+C=0）。未追加 D17+。残余局限：B/C 只扫 `export` 符号 → D19 | **DONE** |
| D16 | P2 | — | 跨引擎共享事实体检：`contracts/openapi.json` 12 接口 vs 两侧路由实际注册；`config/templates.json` 是否被任一侧又硬编码一份 | `contracts/openapi.json`<br>`config/templates.json` | **DONE（只判定，未改代码）**：① 契约 11 path/12 op，两侧注册逐条对齐，且两侧都读同一个 `contracts/openapi.json` → 单一来源，无重复 ② 模板清单单一，但**默认模板 id 有 4 处事实源** → 判定为跨进程边界的默认值，不改，转 D18 | **DONE** |
| D18 | P2 | C | 「默认模板是 `hutb-guanke`」这个事实散在 4 处 | `pipeline/build.py`<br>`direct.py`<br>`mcp_server.py`<br>`config/templates.json` | **DONE**（第 04 轮推翻第 03 轮的"不改"判定）：实测 `mcp_server.py` 是 **5 处**不是 2 处；且 `config/templates.json` 顶层 `default_template` 才是主数据源（两侧引擎都已在读），硬编码的是兜底。已收敛为 `direct.DEFAULT_TEMPLATE_ID`，mcp_server 5 处字面量→0，build.py 那份因 subprocess 边界保留并互指。签名默认值实测不变 | **DONE** |
| D19 | P2 | 工具 | 扫描器 B/C 口径对 TS **只扫 `export` 符号**，非导出的重复私有函数扫不到 | `tools/singleton-scan.py` | **CLOSED（判定不值得做）**：只读评估 42 个非导出函数 → 跨文件函数体相同 **0 组**、非导出同名 **1 个**（`patch`，经核是假重复：一个改整份 DSL，一个改单字段）。投入产出比不成立，不加这条口径 | **CLOSED** |
| D20 | KEEP | C | `DEFAULT_TEMPLATE_ID` 两份：`direct.py`（定义）与 `pipeline/build.py`（subprocess 边界） | `direct.py`<br>`pipeline/build.py` | **KEEP**：`build.py` 被 `direct.py` 以 subprocess 调用，跨进程无法共享常量。**故意不加进扫描器 NOISE** —— 保持可报出，将来第 N 份出现时能被发现。改默认模板请改 `config/templates.json:default_template` | **KEEP** |
| D21 | P1 | 工具 | **扫描器 `TARGETS` 漏登记 `apps/wordeditor-desktop`**：该目录 git 已跟踪（10 文件，含 `src/main.ts`+`src/preload.ts`），前 4 轮从未被扫描 → 「全 0」结论存在盲区 | `tools/singleton-scan.py` | **DONE**：`TARGETS` 增补 `desktop` 项。补后立刻暴露 D22 | **DONE** |
| D22 | P1 | 工具 | `preload.ts` 被 A0/A 误报为孤岛/死模块 —— Electron 的 preload 由 `main.ts:178` 以**运行时路径字符串**注入（`preload: path.join(__dirname,'preload.js')`），静态 import 图看不到；且 `dead_modules()` 只按文件名兜底跳过入口，与 A0 用的完整入口集不一致 | `tools/singleton-scan.py` | **DONE**：新增 `electron_preload_entries()`（扫 `preload: … 'x.js'` 字符串引用，正则中间段须用 `[^\n]*?` 否则被 `path.join` 的逗号截断）；`dead_modules()` 改为共用 `entry_files()` 入口集。desktop A0 1→0 / A 1→0；三既有 target 数字全不变（证明放宽没吞掉真死模块） | **DONE** |

> 基线（2026-10-04 13:20）：api-node 70 文件 A0=8/A=4/B=0；api-python 39 文件 A=3/B+C=13。
> **第 01 轮后（13:40）**：api-node 62 文件 **A0=0 / A=0 / B=0**；api-python **B+C 13→4**（剩 3 条 A = devtool KEEP）。
> **第 02 轮后（14:32）**：api-node 62 文件 **A0=0 / A=0 / B=0**；api-python **A0=0 / A=3(devtool) / B+C 4→0**。
> **第 04 轮后（15:40）**：api-node 62 文件 **A0=0 / A=0 / B=0**（持平）；
> api-python 40 文件 **A0=0 / A=0 / B+C: 0→1**（新报 `DEFAULT_TEMPLATE_ID` = D20，**已判 KEEP**，
> 属 subprocess 边界的两份兜底，不是缺陷）；frontend 79 文件 **A0=0 / A=0 / B+C=0**（持平）。
> **第 05 轮后（15:52，收敛基线）**：四个 target —— api-node 62 **0/0/0**；
> api-python 40 **0/0** + D.devtool=3 + **B+C=1（D20 KEEP）**；frontend 79 **0/0/0**；
> **desktop 2 0/0/0（新登记 target）**。192 个 git 跟踪源文件穷举对账，无 coverage 洞。
> 产物证据：第 01–04 轮改前/改后 `hutb-guanke` 构建均 **28/28 部件逐字节一致**；
> 第 05 轮**产品代码零改动**，E6 免做。
>
> **口径补充（第 02 轮确立）**：同名 ≠ 重复。判定为「假重复」时不合并，改为**按职责重命名**
> 并在两处互留指向注释 —— 名字撞车本身就是「改错实例」的温床。
