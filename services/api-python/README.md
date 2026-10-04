# api-python

Python 能力实现层：CLI（MCP 的实现底座）、FastAPI 后端、构建与 OOXML 后处理、模板工厂。

## 定位

- `services/api-node`：Node 后端（Fastify，前端可切换接入）
- `services/api-python`：Python 后端（FastAPI）+ **CLI / MCP 的实现底座**
- `services/api-python/pipeline`：构建与 OOXML 后处理实现
- `services/api-python/tpl_factory`：模板反向复刻工厂（`spec.yaml` 是唯一数据源）
- `bin/we`：**唯一 CLI 入口**，与 MCP 共用 `direct.py` / `mcp_server.py` 里的同一批函数

## 调用链路

三条入口，同一个内核，**不是三套实现**：

```
前端 → /api → services/api-python/app.py ┐
CI   → bin/we ─────────────────────────┤→ direct.py / mcp_server.py → pipeline/*
Agent→ MCP (mcp_server.py, stdio) ─────┘
```

## 运行 FastAPI

```bash
/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python -m uvicorn app:app --app-dir services/api-python --port 8787
```

> 必须用托管 venv：系统 `python3`（3.13.12 基础版）**没装 uvicorn 与 lxml**，直接跑会 ImportError。

## 常用命令（全部经bin/we）

```bash
# 列模板
./bin/we templates

# 导出文稿（默认模板 hutb-guanke，产物回写 MD 所在目录）
./bin/we build input/碳中和风光储优化.md

# 换模板 + 写元数据 / 页眉页脚 / 修改密码
./bin/we build 报告.md -t hutb-gongke --author "你的名字" --header-text "湖南工商大学"
WPW=xxx ./bin/we build 报告.md --password-env WPW

# docx 反提取 markdown（含图片）
./bin/we extract input/示例.docx -o output/示例.md

# 查看 reference.docx 样式清单
./bin/we ref-styles -t hutb-guanke --json
```

**接入一所新学校**（唯一推荐路径，不要手写 reference.docx / styles.yaml）：

```bash
./bin/we analyze "学校官方格式规范.docx" --text        # 只读：页面/正文逐段实测/封面尾表边界
./bin/we clone   "学校官方格式规范.docx" my-univ --name "某大学 · 学位论文" --marker 摘要
./bin/we verify  templates/my-univ/spec.yaml output/my-univ-sample.docx   # 0 退出码 = 全通过
```

`we clone` 内部自动跑工厂全链路并做 0 FAIL 机械验收；`ok: true` 才算模板可用，
未通过时退出码非 0（CI 可直接卡口）。

## 维护约定

- **`bin/we` 是唯一 CLI 入口**；新 Python 工具先放进 `pipeline/`，再由 `bin/we` 暴露子命令。
  参数解析**转发**给 `pipeline/` 下的脚本，不要在 `bin/we` 里复述一份参数表。
- **stdout 只放结果**（可被 `jq` / `json.load` 消费），进度与提示一律 `print(..., file=sys.stderr)`。
- 新增 MCP 工具改 `mcp_server.py`，函数直接调 `direct.py` / `tpl_factory`，
  **不要另起一套实现**。
- `spec.yaml` 里有铁律注释（如 `hutb-shehui-diaocha/spec.yaml` 顶部），
  改它必须**文本级定点替换**，禁止 `yaml.safe_dump` 往返 —— 往返会洗掉全部注释。
