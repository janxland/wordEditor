# api-python

Python 能力统一入口（收束层）。

## 定位

- `services/api-node`：Node 后端（前端可切换接入）
- `services/api-python`：Python 后端（FastAPI + 统一入口）
- `services/api-python/pipeline`：Python 构建与 OOXML 后处理实现

## 调用链路

- 前端 + Python：`apps/wordEditor-frontend` -> `/api` -> `services/api-python/app.py` -> `services/api-python/pipeline/*`
- 前端 + Node：`apps/wordEditor-frontend` -> `/api` -> `services/api-node`
- Python 离线：命令行/任务 -> `services/api-python/run.py` -> `services/api-python/pipeline/*`

## 运行 FastAPI

```powershell
py -m uvicorn app:app --app-dir services/api-python --reload --port 8787
```

## 常用命令

```powershell
# 列模板
py services/api-python/run.py build --list-templates

# 导出文稿
py services/api-python/run.py build -i input/碳中和风光储优化.md -t hutb-guanke

# 样式预览
py services/api-python/run.py preview-styles -t hutb-guanke -o output/preview.docx --styles templates/hutb-guanke/styles.yaml

# docx 反提取 markdown
py services/api-python/run.py extract-docx -i input/示例.docx -o output/示例.md

# 查看 reference.docx 样式
py services/api-python/run.py ref-styles -t hutb-guanke --json
```

## 维护约定

- `run.py` 是稳定入口，供前后端统一依赖。
- 新增 Python 工具优先放入 `services/api-python/pipeline`，再由 `run.py` 暴露子命令。
