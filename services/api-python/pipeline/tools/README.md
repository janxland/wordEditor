# scripts/tools — 辅助/调试脚本

非主构建链工具，**手动按需调用**，不被 `build.py` / `postprocess_pipeline.py` 引用。

| 脚本 | 用途 |
|------|------|
| `_repair_math_inline.py` | 修复个别 MD 中行内公式格式问题（如数学建模 2013A 示例） |
| `extract_list_styles.py` | 从参考 docx 提取列表样式，生成 `list-style-library.yaml` 候选条目 |
| `inspect_heading_numbering.py` | 反查 docx 标题多级编号（用于编写 `hutb-base.yaml` 时参考） |

主管线脚本仍位于 `scripts/`。
