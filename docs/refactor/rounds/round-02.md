# Round 02 — 同名符号消歧 + 常量/辅助单例化

- 时间：2026-10-04 14:23–14:32
- 轮前 HEAD：`c223c20`（round 01）
- 缺陷：5 条（D07–D11），全部闭环
- 产物等价：**28/28 部件逐字节一致**

## 判定口径

本轮遇到的是「**同名不同义**」——名字撞车但实现根本不是一回事。这正是
「改错实例」的温床：AI（和人）按名字搜到其中一份，改完发现线上走的是另一份。
因此处置分两类：

- **真重复**（值/实现一致）→ 收敛成一份，删掉其余。
- **假重复**（同名不同义）→ **不合并**，改为**按职责重命名**并互留指向注释。

## D07 · `CODE_STYLE_IDS` 三份 → 一份（真重复）

| 位置 | 原形态 | 值 |
|---|---|---|
| `pipeline/ooxml_three_line_table.py:55` | `_CODE_STYLE_IDS = (...)` tuple | `SourceCode`, `VerbatimChar` |
| `pipeline/ooxml_verbatim_table.py:49` | `CODE_STYLE_IDS = {...}` set | 同上 |
| `pipeline/postprocess_document.py:41` | `CODE_STYLE_IDS = {...}` set | 同上 |

三份取值逐值相同 → 真重复。收敛到 `ooxml_util.CODE_STYLE_IDS`（`frozenset`），
三处改为 import。副作用：tuple→frozenset 只影响 `in` 判定，语义不变。

## D08 · `_set_wordwrap_zero` 两份 → 消歧而非合并（假重复 + 一个真陷阱）

| 位置 | XML 栈 | 返回 |
|---|---|---|
| `pipeline/postprocess_styles.py:168` | ElementTree | `bool`（是否真改了） |
| `tpl_factory/reference.py:126` | python-docx / lxml | `None` |

两栈元素类型不通用，**不能合并**。处置：

1. ET 版移入 `ooxml_util.set_wordwrap_zero()`（唯一 ET 实现），`postprocess_styles` 改为 import。
2. lxml 版改名 `_set_wordwrap_zero_docx()`，docstring 里写明孪生关系与「别误删另一份」。

**过程中发现的真陷阱（差点改变产物）**：`postprocess_styles` 原来的实现走
`_set_or_replace`（元素已存在就**就地改**），而共享层的 `replace_child` 是
**删掉重建并追加到末尾**。`w:wordWrap` 在 `w:pPr` 里有 ECMA-376 schema 顺序，
换位置会让 Word 判定结构异常。已把 `set_wordwrap_zero` 改成就地 set 语义
（缺失时才 `replace_child` 新建），与旧实现字节等价 —— E6 已验证。

## D09 · `patch_document` 两份 → 按职责改名（假重复）

| 位置 | 实际做的事 |
|---|---|
| `ooxml_three_line_table.py:119` | 遍历 `w:tbl`，把边框改成三线 |
| `ooxml_verbatim_table.py:195` | 把连续代码段包成三线表，返回 `(bytes, count, captions)` |

签名与语义完全不同，只是都叫 `patch_document`。已改名：
`patch_document_three_line` / `patch_document_verbatim`。两个都只在本文件的
`patch_docx` 与 `main` 内被调用，无外部引用（`git grep` 双证）。

## D10 · `patch_docx` 四份 → 全部按职责改名（假重复）

| 位置 | 签名 | 新名 |
|---|---|---|
| `ooxml_three_line_table.py:128` | `(path) -> int` | `patch_docx_three_line` |
| `ooxml_verbatim_table.py:228` | `(path, override) -> (int, list)` | `patch_docx_verbatim` |
| `postprocess_document.py:221` | keyword-only，`-> dict` | `patch_docx_document` |
| `postprocess_styles.py:633` | `(path, dsl) -> None` | `patch_docx_styles` |

四份参数与返回值全不同，属「各脚本自己的 CLI 出口」。改名即可消歧，不合并。
外部引用检查：`postprocess_pipeline.py` / `clone_core.py` / `style_core.py` 只
通过子进程或 `load_dsl` 使用，无一处 import 这四个函数 → 改名安全。

## D11 · 残留的 `W` / `NS` / `_q` 收敛到 `ooxml_util`

| 文件 | 删掉的定义 |
|---|---|
| `pipeline/apply_docx_header_footer.py` | `W` `XML` `NS` `register_namespace` `_q()` `_w_attr()` |
| `pipeline/list_reference_styles.py` | `W` `NS` `register_namespace` `_q()` |
| `pipeline/ooxml_three_line_table.py` | `W` `NS` `register_namespace` `q()` |
| `pipeline/ooxml_verbatim_table.py` | `W` `XML` `NS` `register_namespace` `q()` |

其中 `_w_attr()` 只是 `_q()` 的别名（一个文件内的第三份），已直接换成 `q()`。
`ooxml_util` 在 import 时就执行 `ET.register_namespace("w", W)`，所以调用侧
不再需要各自注册。

踩坑：`list_reference_styles.py` 原本就有自己的 `SCRIPT_DIR`/`sys.path` 前导，
但它在**所有 import 之后**才执行 —— 第一遍把 `from ooxml_util import ...` 插到了
import 区，导致 `ModuleNotFoundError`。已把该 import 移到 `sys.path` 之后并加注释。

## 证据

| # | 项 | 结果 |
|---|---|---|
| E1 | 轮前 HEAD | `c223c20` |
| E2 | `npx tsc --noEmit`（api-node） | 无输出 = 0 error（本轮未改 Node 侧） |
| E3 | `compileall` + 20 个模块 import 自检 | 全 OK（修完 list_reference_styles 后） |
| E4 | `singleton-scan api-python` | B/C **4 → 0**；A0=0；A=3（devtool，KEEP） |
| E4 | `singleton-scan api-node` | A0=0 / A=0 / B=0（62 文件） |
| E5 | `bin/we templates` | 正常输出 9 个模板 |
| E6 | 改前（HEAD worktree 独立构建）vs 改后 | **28/28 部件逐字节一致** |

## 顺带发现（未在本轮处置，已进 Backlog）

- 扫描器对 Vite 前端**大面积误报**：`singleton-scan frontend` 报 A0=60 / A=34，
  连 `src/main.tsx` 都被判成孤岛。原因是入口识别不认 Vite 的 `index.html`
  script 入口，也不认路由里的动态 `import()`。这是**工具缺陷**，不修会在后续
  轮次引发误删。→ D12
- 跨 XML 栈的命名空间常量仍有多份（`clone_core.py` / `tpl_factory/ooxml.py` /
  `template_verify.py` / `ooxml_schema_order.py` / `pipeline/tools/*`）。URI 字符串
  本身与栈无关，可以单独单例化。→ D14
