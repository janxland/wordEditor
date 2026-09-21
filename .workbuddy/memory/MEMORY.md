# wordEditor · 项目长期记忆

## 项目定位

湖南工商大学论文导出工具：Markdown → docx。链路
`apps/wordEditor-frontend → /api → services/api-python（或 api-node）`；
离线能力走 `services/api-python/run.py` / `pipeline/build.py`
（Pandoc + reference.docx + Lua 过滤器链 + OOXML 后处理 + styles.yaml DSL）。
**单一连接器是 MCP `wordeditor`**（`services/api-python/mcp_server.py`），
CLI 与 MCP 共用 `direct.py`，不要绕开它直写 OOXML。

## 硬约定

- 模板注册在 `config/templates.json`；`build.py` 只认已注册的 id。
- 工作区 = MD 所在目录；`images/` `media/` `charts/` 随 MD 打包；产物默认回写工作区。
- 每个模板三件套：`reference_doc` + `lua_filter` + `styles_yaml`。
  `resolve_lua_filters` 要求 `lua_filter` 非空（`extra_lua_filters` 可选）。
- **第一段管道（md→html）不加载任何 Lua 过滤器**，所以 docx 专属的
  `custom-style` 属性在 Markdown 里写了也会被丢掉；要指定段样式只能
  在 MD 里写 HTML class，再用第二段管道（html→docx）的 Lua 过滤器补回
  `custom-style`。见 `templates/apa7/apa7-style.lua`。
- `postprocess_styles.py` 的 DSL 单位是**中文排版口径**（字号用 half-pt、缩进用字符）。
  按英寸设计的英文版式一律固化进 reference.docx，**不要**在 styles.yaml 里用
  `custom_styles` 重建，否则会被字符缩进覆盖。

## 可用模板

中文：`hutb-gongke` / `hutb-guanke`（默认）/ `hutb-xingce` / `hutb-math-modeling` /
`hutb-gongke-fengmian` / `hutb-guanke-fengmian` / `hutb-guanke-xuenian`。

**新增英文：`apa7`（APA 7th edition）** — Letter、四边 1 英寸、Calibri 11pt、
双倍行距、页脚居中页码、References 悬挂缩进 0.5 英寸、Heading1 居中加粗无编号。
- 版式源：`templates/apa7/reference.docx`，由 `templates/apa7/build_reference.py` 生成。
- MD 标记：`<div class="pagebreak"></div>` 分页、`<div class="cs-XXX">` 指定段样式。
- 完整用法/坑/验收清单见用户级 skill `apa7-english-paper-wordeditor`。

## 环境

- Pandoc 不在 PATH、本机无 brew。可用副本放在
  `<repo>/.tools/pandoc-3.9-arm64/bin/pandoc`（`tool_paths.find_pandoc()` 会自动扫到）。
  补装办法：清华 PyPI `pip install pypandoc_binary`，
  复制 `site-packages/pypandoc/files/pandoc` 过去。
- Python 用托管 venv：`/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python`。
- 注意 `.tools/pandoc-3.9.0.2-arm64/` 是个**空壳目录**（只有 share/man），别被它骗了。
