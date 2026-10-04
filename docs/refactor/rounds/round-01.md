# Round 01 · 去冗余（2026-10-04）

基线：`git rev-parse HEAD` = `85d4996c0c94694cf22c20b5d906a9db3a93b09e`
（工作区在轮前已脏：10-03 那批改动未提交，见 E1）

## E1 改动前状态

```
 M .gitignore / README.md / bin/we / docs/blog-project-details.md
 M services/api-node/src/docorder/auth.ts
 M services/api-python/{README.md,clone_core.py,direct.py,mcp_server.py,
   pipeline/ooxml_numbering.py,pipeline/preview_images.py,
   tpl_factory/assets.py,tpl_factory/workflow.py}
D  services/api-python/run.py
?? services/api-node/src/pipeline/factory/   ← D01 目标（从未提交过）
```

## 缺陷处置

### D01 · Node 侧模板工厂整簇未接线（P0，A0 口径）

- **判定**：`tools/singleton-scan.py api-node` 报 A0=8，整簇
  `src/pipeline/factory/{detect,spec,reference,reference-from-scratch,slices,ooxml,types,zip-writer}.ts`
  从任何入口做 BFS 都不可达。双证：`git grep "pipeline/factory"` 全仓 0 命中；
  `contracts/openapi.json` 11 个 path 无 analyze/clone；
  `http/routes/index.ts` 只注册 system/docorder/downloads/templates/files/build/import/web。
- **结论**：这是模板工厂在 Node 侧的第二份实现，Python 的 `tpl_factory/` 才是唯一在用实现
  （MCP + `bin/we` 都走它）。改 Node 这份永远不生效 —— 典型的「改错实例」。
- **改动**：整簇删除，8 文件 / 1955 行。未提交入 git（`??` 状态），
  本地备份留 `docs/refactor/rounds/round-01/backup/pipeline-factory/`（不入库）。
- **证据**：`npx tsc --noEmit` 0 error。

### D02 · 四个 OOXML 属性辅助两份实现（P0，B 口径）

`_ensure_ppr` / `_ensure_rpr` / `_replace_child` / `_line_spacing_attrs` 在
`ooxml_multilevel.py` 与 `postprocess_styles.py` 各写一份。

逐函数比对结果：

| 函数 | 两份是否等价 | 处置 |
|---|---|---|
| `_ensure_ppr` | ✅ 等价（都是 `insert(0, ppr)`） | 抽到 `ooxml_util.ensure_ppr` |
| `_ensure_rpr` | ✅ 等价（都是追加到末尾） | 抽到 `ooxml_util.ensure_rpr` |
| `_replace_child` | ✅ 等价（删同名 + 新建 + str() 化属性） | 抽到 `ooxml_util.replace_child` |
| `_line_spacing_attrs` | **⚠️ 取值冲突** | 见下 |

- **⚠️ 取值冲突**：multilevel 版未知值 `return {}`（静默忽略）；postprocess_styles 版
  `raise ValueError`。**合并取 raise 版**（配置写错就该炸，不该静默）。
- **冲突影响面实测为 0**：全仓 `templates/**/styles.yaml` 的 `line_spacing` 取值只有
  `single / 1.5 / double / "22pt"` 四种，全部合法 → 走不到 raise 分支。
- 顺带把这 3 个文件里各自重复的 `_q` / `W` / `NS` 定义（140 处 `_q(` 调用）也收敛到
  `ooxml_util.q` / `W` / `NS`。

### D03 · `_max_abstract_id` 两份（P1，B 口径）

`ooxml_list_styles.py` 与 `ooxml_multilevel.py` 各一份，**实现逐字相同**。
收敛进编号共享层 `ooxml_numbering.max_abstract_id`（该文件原本只放一个常量，
现在名副其实是「编号共享层」）。

### D04 · `TAIL_MARKERS` 两份（P1，C 口径）

- `clone_core.py`: `("评审表","评分表","成绩","评阅")` — 窄
- `tpl_factory/detect.py`: `("评审","评分","成绩","评阅","评定","评语","打分","打分表","教师签名")` — 宽（是超集）

**⚠️ 取值冲突 + 依赖方向约束**：`tpl_factory/ooxml.py` import `clone_core`
（依赖单向 tpl_factory → clone_core），所以常量物理上必须落在 `clone_core`，
不能反过来让 clone_core import detect（会成环）。

- 处置：真值取**并集 = detect 的宽集合**，物理位置放 `clone_core`，detect 改为 import。
- **行为变更点**：`clone_core.extract_tail`（legacy `clone_template` 路径）命中范围变宽，
  新增 评定/评语/打分/打分表/教师签名 五个词。工厂路径（detect）取值一字未变。
- 影响面：只有 legacy `clone_core.clone_template` 用到 `extract_tail`（`clone_core.py:448`），
  MCP/CLI 的 `clone_template` 走工厂，不受影响。

### D05 · `WORDEDITOR_ROOT` 两份 + `_para_text`/`_style_names` 两份（P1，C 口径）

- `clone_core.py`: `Path(__file__).resolve().parents[2]` —— 机器无关，但不支持 env 覆盖
- `style_core.py`: `Path(os.environ.get("WORDEDITOR_ROOT", "<硬编码的本机绝对路径>"))` —— 支持 env，但默认值写死了开发机路径（换机器就是错的）

**处置：取两家能力并集，消掉硬编码**
```python
WORDEDITOR_ROOT = Path(os.environ.get("WORDEDITOR_ROOT", Path(__file__).resolve().parents[2]))
```
放 `clone_core`（底座），`style_core` 改为 import。
- **行为变更点**：`style_core` 在无 env 时，从「硬编码绝对路径」变为「按 `__file__` 推导」。
  本机两者结果相同；换机器后反而变正确。
- `_para_text` / `_style_names`：两份实现语义等价（`findall(".//w:t")` ≡ `iter("{w}t")`），
  差异只在 `_style_names` 是否跳过缺 `styleId` 的样式 → 取**更严格的 tpl_factory 版**，
  落到 `clone_core`，`tpl_factory/ooxml.py` 改为 import。

## 证据

| # | 项 | 结果 |
|---|---|---|
| E2 | `cd services/api-node && npx tsc --noEmit` | **0 error**（删 1955 行后） |
| E3 | `python -m compileall -q services/api-python` | OK |
| — | 全模块 import 自检（venv python，含 lxml/yaml） | clone_core / style_core / tpl_factory.* / template_factory / template_verify / mcp_server / direct 全 OK |
| E4 | `tools/singleton-scan.py` | api-node **A0 8→0、A 4→0、B 0**；api-python **B+C 13→4**（剩 3 条 A 是 devtool，已判 KEEP） |
| E5 | `bin/we templates` / `bin/we --help` | 正常输出 9 个模板 |
| E6 | 产物等价（hutb-guanke，`input/暑假社会调查报告-样例.md`） | **28/28 部件逐字节一致**（改前用 `git worktree` 在 HEAD 上独立构建，改后构建，strip `dcterms` 时间戳 + rsid + 任务路径后比对） |
| E6b | 同代码构建两次 | 28/28 一致（可复现） |

> E6 的 A/B 用 `git worktree add /tmp/r1base HEAD --detach` 建独立目录，**没有** `cp` 覆盖
> 任何源文件，跑完 `git worktree remove --force` 清理。

## 风险与遗留

- `clone_core.py` 本轮提交里同时包含 10-03 那批未提交的改动（轮前就脏，无法拆分）。
- `line_spacing_attrs` 未知值从"静默"变"抛错"：现有模板全合法 → 0 影响；
  但**今后写 styles.yaml 时非法 line_spacing 会让构建直接失败**（这是期望行为）。
- `TAIL_MARKERS` 变宽只影响 legacy clone 路径，未做真机回归（无源 docx 样本）。
- 删掉的 Node factory 备份在 `docs/refactor/rounds/round-01/backup/`（**未入库**）。

## 下一轮种子（扫描器新暴露）

- `CODE_STYLE_IDS`：`ooxml_verbatim_table.py` × `postprocess_document.py`
- `_set_wordwrap_zero`：`postprocess_styles.py` × `tpl_factory/reference.py`
- `patch_document`：`ooxml_three_line_table.py` × `ooxml_verbatim_table.py`
- `patch_docx`：4 个文件各一份（需先判定是不是各脚本的独立 CLI 入口）
- `_q` / `W` / `NS`：本轮只清了 3 个文件，其余 `apply_docx_header_footer` /
  `list_reference_styles` / `ooxml_three_line_table` / `ooxml_verbatim_table` 仍各有一份
- 前端 `apps/wordEditor-frontend/src` 尚未扫描
