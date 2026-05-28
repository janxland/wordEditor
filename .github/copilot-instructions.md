# Copilot Instructions — wordEditor

本仓库为 **湖南工商大学** Word 导出管线（`hutb-guanke` 管科 / `hutb-gongke` 工科）。

## 构建

```powershell
py scripts/build.py -i input/carbon-neutral-renewable.md -t hutb-guanke
```

## 管线

MD → Pandoc（`reference.docx` + Lua）→ DOCX → `postprocess_document.py`（标题/引用）→ `postprocess_styles.py`（`styles.yaml`）。

## 关键路径

| 用途 | 路径 |
|------|------|
| 模板注册 | `config/templates.json` |
| 样式 DSL 基库 | `templates/_shared/hutb-base.yaml` + `templates/_shared/list-style-library.yaml` |
| 各模板样式覆盖 | `templates/hutb-{guanke,gongke,xingce,math-modeling}/styles.yaml` |
| 共享 reference + Lua | `templates/hutb-shared/`（reference.docx 需自行放入）|
| 语义 Lua | `templates/hutb-shared/zhengwen-style.lua` |
| MD 约定 | `docs/markdown-conventions.md` |

## 注意

- 后处理无需 Word；仅需 Pandoc + Python + PyYAML
- `reference.docx` 需用户自行放入学校官方模板
- 前端（`apps/wordEditor-frontend`）为可选工作台
