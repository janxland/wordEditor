# Round 04 — 默认模板兜底值单例化 + 深水口径评估

- 时间：2026-10-04 15:27–15:40
- 轮前 HEAD：`c2e3bd1`（round 03 回写）
- 缺陷：**3 条实质条目 + 1 项跨引擎比对**（扫描补不满 5 条，见 §为什么没凑满 5 条）
- 产物等价：**28/28 部件逐字节一致**
- 净行数：本轮自身 **+24 / −7**；**夹带轮前未提交改动 +346 / −8**（原因见 §提交范围）

---

## 为什么没凑满 5 条（先说清楚）

第 04 轮 prompt 要求 5 条，实际只有 D18、D19 两条 OPEN。按规则先跑扫描补位：

```
api-node   62 文件  A0=0 / A=0 / B+C=0
api-python 40 文件  A0=0 / A=0 / B+C=0（改后出现 1 条，即 D20）+ D.devtool=3
frontend   79 文件  A0=0 / A=0 / B+C=0
```

三个 target **全 0**，扫描一条新的真缺陷都没补出来。所以第 3–5 条改用 prompt 授权的
两条替代路径：D20（扫描在本轮**改完之后**新报出的那条）+ 跨引擎共享事实第二批
（schema 顺序表逐项比对）。

**这本身是个结论**：在第 03 轮修好扫描器（前端误报从 A0=60 降到 0）之后，
三条机械口径在当前代码上已经**探不到**多例。剩下的都是需要人判断的东西。

---

## D18 · 默认模板兜底值（第 03 轮判定不改 → 本轮改）

**第 03 轮的理由是错的，本轮有新证据推翻它。**

第 03 轮说「`mcp_server.py:75/84` 两处」。**实际是 5 处**：
`build_docx`(75)、`build_docx` 内的 `template_id or "hutb-guanke"`(84)、
`apply_style`(91)、`save_style`(103)、`save_template` 的 `base`(119)。
**同一个文件内 5 次抄同一个字符串** —— 这是真重复，不是"分层默认值"，
第 03 轮漏数了 3 处。

**同时发现一个第 03 轮没查到的事实**：`config/templates.json` 有顶层字段
`default_template: "hutb-guanke"`，且**两侧引擎都已经在读它**：

| 位置 | 用法 |
|---|---|
| `direct.py:36` | `t["id"] == cfg.get("default_template")` |
| `pipeline/build.py:88` | `cfg.get("default_template") or DEFAULT_TEMPLATE_ID` |
| `api-node/src/pipeline/templates.ts:53` | `cfg.default_template \|\| FALLBACK_TEMPLATE_ID` |

所以硬编码的那几份**不是主数据源，是 `default_template` 读不到时的兜底**。
主数据源一直是单一的 —— 第 03 轮把它误判成了"4 个并列的事实源"。

**改法（只动同一进程内的那份）**：

| 文件 | 改动 |
|---|---|
| `direct.py` | 新增 `DEFAULT_TEMPLATE_ID = "hutb-guanke"`，注释写明「它是 `config/templates.json:default_template` 的兜底，改模板改 JSON 不要改这里」；`build_to_workspace` 签名默认值改用它 |
| `mcp_server.py` | import 改 `from direct import DEFAULT_TEMPLATE_ID, build_to_workspace, list_templates`；**5 处字面量全换**（5 → 0） |
| `pipeline/build.py` | 字面量保留（subprocess 边界），加注释互指 `direct.py` 的同名常量 |

**行为变更点**：无。实测四个签名的默认值仍解析为 `hutb-guanke`：

```
direct.DEFAULT_TEMPLATE_ID            = hutb-guanke
direct.build_to_workspace 签名默认     = hutb-guanke
mcp build_docx 默认                    = hutb-guanke
mcp save_template base 默认            = hutb-guanke
list_templates() 里 default=True 的    = ['hutb-guanke']
```

**硬编码份数变化**：`mcp_server.py` 5 → 0；api-python 内剩余 2 份
（`direct.DEFAULT_TEMPLATE_ID` 定义 + `build.py` 的 subprocess 那份），
且两份之间**有注释互指**。第 03 轮时的"4 处散落"已收敛为「1 个定义 + 1 个边界副本」。

---

## D19 · 深水口径（函数体相似度）—— **评估结论：不值得做，关闭**

**只读评估**（一次性脚本，未入库），扫描 `apps/wordEditor-frontend/src` 与
`services/api-node/src` 两个 TS target：

| 指标 | 结果 |
|---|---|
| 非导出函数总数 | **42** |
| 跨文件「函数体完全相同」组数 | **0** |
| 非导出同名（跨文件）符号数 | **1** |

唯一命中的同名符号是 `patch`，人工核了 —— **假重复**，两处签名与语义完全不同：

| 位置 | 签名 | 实际做的事 |
|---|---|---|
| `DslVisualEditor.tsx:71` | `(updater: (d: DslDocument) => DslDocument) => void` | 整份 DSL 文档的更新器 |
| `StyleFieldsForm.tsx:78` | `(key: string, val: unknown) => void` | 表单单字段 key/val 打补丁 |

（其余出现的 `patch` 全是**参数名**，不是函数定义。）

**结论：不加这条口径。** 42 个非导出函数里 0 组跨文件重复、唯一同名是假重复 ——
为这个量级去实现并常驻一条「函数体相似度」口径，投入产出比不成立，
还会给每轮基线引入需要人工重判的噪声。**D19 关闭**（不是 DONE，是判定为不值得做）。

---

## D20 [新] · `DEFAULT_TEMPLATE_ID` 两份 —— **KEEP，不合并**

**这是本轮改完之后扫描器新报出来的一条**（B/C 口径 0 → 1）：

```
B/C. 同名符号/常量多份定义 (1):
   - DEFAULT_TEMPLATE_ID  ->  services/api-python/direct.py, services/api-python/pipeline/build.py
```

**为什么是 KEEP 而不是缺陷**：`build.py` 是被 `direct.py` 以 **subprocess** 调用的
（`direct.py:104`：`sys.executable, str(PIPELINE / "build.py")`），
跨进程没法共享 Python 常量。这是**两个进程各自需要的兜底值**，
不是"同一进程内的第二份实现"。

**为什么不塞进扫描器的 NOISE 白名单**：塞进去就再也扫不到了 ——
将来若有人在第 5 个文件又抄一份，信号会被静默吞掉。
保持它能被报出来，每轮由状态机按 KEEP 处置，更安全。

**代价**：api-python 的 B/C 从 0 变 1。这是**真信号**不是退化，
且已被判定保留，不占缺陷计数。

---

## 跨引擎共享事实第二批 · schema 顺序表逐项比对（无缺陷）

按 prompt 授权的第 5 条，比对**设计内双引擎**的顺序表（只比对一致，不许合并）：

| 表 | Node `schema-order.ts` | Python `ooxml_schema_order.py` | 判定 |
|---|---|---|---|
| `TBLPR_ORDER` | 17 项 | 17 项 | ✅ 逐项一致 |
| `TCPR_ORDER` | 15 项 | 15 项 | ✅ 逐项一致 |
| `PPR_ORDER` | 36 项 | 36 项 | ✅ 逐项一致 |

三张表**顺序与取值逐项相同**，无一侧独有的表。
这两张表决定了 `w:tblPr`/`w:tcPr`/`w:pPr` 的子元素写入位置，
不一致会直接导致双引擎产物结构分叉 —— 目前是一致的。

---

## 证据

| # | 项 | 结果 |
|---|---|---|
| E1 | 轮前 HEAD / 工作区 | `c2e3bd1`；`direct.py` / `mcp_server.py` 轮前已脏（diff 已备份到 `rounds/round-04/backup/`，**未入库**，与 round-01 口径一致） |
| E2 | `cd services/api-node && npx tsc --noEmit` | **0 error**（无输出） |
| E3 | `compileall -q services/api-python` + 8 模块 import 自检 | 全 OK：`direct` `mcp_server` `clone_core` `style_core` `template_factory` `template_verify` `ooxml_ns` `pipeline.build` |
| E3b | 默认值实测（不是"看着对"） | 四个签名默认值实测均为 `hutb-guanke`，`list_templates()` 返回的 default 仍是 `hutb-guanke` |
| E4 | 单例扫描（三个 target） | api-node 62 文件 **A0=0/A=0/B=0**（持平）<br>api-python 40 文件 **A0=0/A=0** / D.devtool=3 / **B+C: 0→1（D20，已判定 KEEP）**<br>frontend 79 文件 **A0=0/A=0/B+C=0**（持平） |
| E5 | `bin/we templates` | 正常输出 10 个模板，`hutb-guanke *默认` |
| E6 | 产物等价（`hutb-guanke`，`input/暑假社会调查报告-样例.md`） | **28/28 部件逐字节一致**（worktree 独立构建，已 `remove --force`） |

---

## 提交范围

只 `git add` 本轮改到的 **5 个文件**：

```
services/api-python/direct.py
services/api-python/mcp_server.py
services/api-python/pipeline/build.py
docs/refactor/rounds/round-04.md
docs/refactor/ITERATION-STATE.md
```

⚠️ **夹带说明**：`direct.py`（+22/−6）与 `mcp_server.py`（+342/−9）轮前就已脏，
git 无法只提交文件的一部分。扣掉轮前基线（`direct.py 14/5`、`mcp_server.py 332/3`）后，
**本轮自身改动是 +24/−7**。轮前 diff 已存 `rounds/round-04/backup/*.patch`（未入库）。

其余轮前脏文件（`preview_images.py` / `tpl_factory/assets.py` / `tpl_factory/workflow.py` /
`bin/we` / `README.md` / `.workbuddy/memory/MEMORY.md` / `docs/blog-project-details.md` /
`api-node/src/docorder/auth.ts`）**一律没碰**。

---

## 风险与遗留

- **D18 的"两份"没有彻底消灭**：`build.py` 那份因 subprocess 边界留着。
  改默认模板的正确姿势是改 `config/templates.json` 的 `default_template`；
  万一要改兜底值，`direct.py` 和 `build.py` 必须一起改（已互留注释）。
- **Node 侧 `pipeline/templates.ts:13 FALLBACK_TEMPLATE_ID`** 是另一侧引擎的对应兜底，
  属设计内双引擎，**不合并**；但同样的"改了要同步"问题存在于跨语言两侧。
- **B/C 口径从本轮起会稳定报 1 条 D20**。后续每轮都要认它（已标 KEEP）。
- **收敛信号**：三条机械口径在三个 target 上已全部探不到多例（除已判 KEEP 的 D20）。
  若第 05 轮扫描仍无新发现，建议把 STATUS 改为「收敛」并停止建链。
