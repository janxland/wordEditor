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

**新增课程论文：`hutb-jinrong-bigdata`**（金融大数据与Python程序应用）。
- 由**模板工厂**生成（不是手写三件套）：`templates/<id>/spec.yaml` 是唯一数据源。
- 完整流程/坑/验收见用户级 skill `wordeditor-template-clone`。

## 模板复刻工厂（新增，2026-09-25）

新增任意 docx 格式模板**一律走工厂**，别再手写三件套：
```
python services/api-python/template_factory.py analyze "<源docx>"    # 解剖，输出填 spec 的事实
python services/api-python/template_factory.py detect  "<源docx>"    # 自动探测封面/评分表边界（含策略+依据）
python services/api-python/template_factory.py check  templates/<id>/spec.yaml
python services/api-python/template_factory.py build  templates/<id>/spec.yaml   # 幂等
python services/api-python/template_verify.py templates/<id>/spec.yaml <产物.docx>  # 0 FAIL 才结案
```

**两条铁律（违反过两次，别再犯）**：
1. **封面 / 尾页评分表 = 整页原样搬运（字节级），禁止复刻、也禁止分析表格结构。**
   边界由 `detect` 自动探测，spec 写 `slice: auto`；`template_verify.py` 同源调 detect。
   禁止人肉数索引写死。实现上三个硬约束：
   - **绝不用 lxml/ET 处理块内容**（parse→serialize 会丢 `proofErr`、注释、PI，且 nsmap
     只按首元素继承 → 前缀未绑定 → Word 报文档损坏）。块走字节：
     `template_factory.iter_body_top_level()` 切 + `clone_core._inject_block()` 字符串插入。
   - **xmlns 声明必须随块补进产物 `<w:document>` 根**，否则 `unbound prefix`。
     抽取时从 `indexOf('<w:blocks')` 起算，别用 `indexOf('>')`（会命中 `<?xml?>` 里的 `>`）。
   - **书签要成对**：曾删掉顶层 `bookmarkEnd` 留下段内 `bookmarkStart` → 不闭合。
   验收只比"源片段字节（rId 归一后）是否原样出现在产物中"，**不查行列/合并/单元格文本**。
2. **光"块字节一致"不够 —— 文档级默认值必须同源（铁律 1.5）。** 块字节一致只证明
   没被改写，证明不了渲染一样。段落没写死的项（行距/默认字体/东亚语言）都继承
   docDefaults / theme / settings / sectPr。从零造 reference 时曾把
   `pPrDefault` 塞成 `after=200 line=276 auto`（源是空）→ 封面 20 段 + 评分表 74 段
   全被撑开；`themeFontLang` 是 `ja-JP`（python-docx 默认模板自带，源是 zh-CN）→
   **默认东亚字体变日文字体**，列表编号「一、（一）、①」跟着变日文。
   → **reference.docx 一律整包克隆源 docx**（`build_reference_cloned()`，工厂默认）：
   复制全部部件 → 清空 body 留 sectPr → 追加源没有的样式 → themeFontLang 兜底 zh-CN
   → 补 numbering / 删孤儿 media。验收必须比**解析后格式**（`resolve_para()`：
   docDefaults → pStyle/basedOn 链 → 段落 → 首个 run），0 段不同才算过。
3. **正文/标题的格式要求以模板里的「文字描述」为准**（如「正文（小四号宋体、行距固定值24磅）」），
   不是以示范段的 OOXML 值为准 —— 示范段常被作者随手设错（标注小四、实际 sz=28）。
   OOXML 只用于取文字没覆盖的参数（缩进 twips / 页面设置 / 表格几何）。

**双引擎都要跑验收**：前端默认走 `/api` → Node 8787，Python 只走 `/py-api`。
Node 侧的块注入是 `services/api-node/src/pipeline/stages/blocks.ts`（stage `blocks`，
排在 STAGES **最后**确保不被样式阶段冲刷）。**历史坑：Node 侧曾完全没有实现块注入**
（`templates.ts` 的 coverBlock/tailBlock 只是死字段），2026-09-25 才补上。
改 stage 顺序时别把它挪到样式阶段之前。
   字号常是**混合**的，别统一成一个值。

**映射而非新造**：识别出的要求映射到本体系既有样式（ae/文章的正文、Cankaowenxian、
ZhaiYao*/Abstract*/KeyWords*、heading 1-4 + multilevel_list）。新 styles.yaml 是
`extends: ../_shared/hutb-base.yaml`，只写差异。没段落会用到的样式 = 过度切，删掉。
注意 `<div class="cs-XXX">` 是 **apa7 的扩展，hutb 主 lua 不支持**（写了落 `BodyText`）。
- 模板目录自包含：`source.docx`（切片源）+ `spec.yaml` + 工厂产物。
- **封面/尾页评分表走源 docx body 精确切片**，不过 pandoc、不重画 → 100% 保真且不受正文样式冲刷。
  切片必须含自带分页段；书签自动丢弃。
- 结构化资产：`fields.json`（封面字段）/ `rubric.json`（评分指标）供 Web 直接渲染表单；
  `spec.yaml` 就是入库的那条记录。
- 产物里正文 styleId 是中文「文章的正文」（pandoc 按 lua 的 custom-style 建，DSL 按 name 覆盖），
  不是 spec 里的 `ae`。
- `first_line_chars: 2` 默认 firstLine=200 ≠ 2 字符，**必须显式 `first_line_dxa: 560`**。
- heading styleId 必须是 `1`..`9`（与 hutb 生态 styles.yaml 的 `match: {id: "1"}` 对齐）。
- `Title` 无 DSL 覆盖入口，字号行距只能落在 reference.docx。
- 模板自述与 OOXML 实测冲突时**以 OOXML 为准**。

## 双引擎现状（2026-09-25 回归确认）

- 接口契约单一来源 `contracts/openapi.json`（12 个接口），两端同发 `/openapi.json` 与 `/docs`。
- `api-node`（Fastify）与 `api-python`（FastAPI）**都能跑完整链路**，python 早已不是占位目录
  （`docs/project-structure.md` 里那句「不承载 Python 运行职责」已过时）。
- 前端 vite 代理双通道：`/api` → 8787（node）、`/py-api` → 8788（python，rewrite 掉前缀）。
- **产物等价已被逐部件验证**：docx 的 document.xml / styles.xml / numbering.xml /
  header* / footer* / media 全一致（字节一致或仅 XML 前缀差异）。
- **不等价处只在 SSE 进度流，且是 python 落后**（详见今日日志与
  `.cache/regression/REGRESSION-2026-09-25.md`）：
  `_sse()` 的 `json.dumps` 带空格、`_emit_step_from_build_line()` 靠 build.py 日志关键字反推
  step（重复帧 + step 后置）、entries 越界条目静默跳过不回报。**这三条至今未修。**

## 表格后处理（schema 顺序已成共享层）

- `ooxml/schema-order.ts` ↔ `pipeline/ooxml_schema_order.py`：ECMA-376 子元素顺序表
  （TBLPR / TCPR / PPR）+ `putOrdered`（py `put_ordered`）/ `ensureOrdered` / `orderIn`。
  **往 tblPr / tcPr / pPr 里塞元素一律走它**，别再 `append` / `SubElement` 到末尾。
- 三线表 = 顶线/栏目线/底线 + `tblW=5000 pct` + `jc=center` + `tblLayout=autofit`
  + 单元格 `vAlign=center` + 单元格段落 `jc=center`（SourceCode/VerbatimChar 段落跳过水平居中）。
- verbatim（代码块）表在 three-line **之后**跑，自建表：**不加 vAlign**（代码块垂直居中无意义），
  只保证顺序；它的取值（8300 dxa / fixed / 边框 / 字号）别动。
- python 侧 import 共享模块照 `postprocess_document.py` 惯例：先 `SCRIPT_DIR` 插 `sys.path`。

## 回归方法

- CLI 层产物对比：`services/api-node/tools/parity.ts`（pandoc / stage / full / docx 四种模式）。
- **HTTP 层回归：`.cache/regression/`**（gitignore 内，不入库）
  `http-regress.mjs`（REST 全量 + 10 个 build 用例）、`http-regress2.mjs`（错误路径/上传/并发）、
  `sse-diff.mjs`（SSE 序列 LCS diff）、`check-table.mjs`（tblPr/pPr 取值与 schema 顺序）。
  跑法：先起两端（端口隔离），再 `node .cache/regression/http-regress.mjs`。
- docx 比对口径：按部件解 zip → XML 语义归一（前缀按 URI 重编 nsK、折叠空白）→ 逐部件比。
  `dcterms:created/modified`、密码 hash/salt、任务目录路径要先 strip，否则必假阳性。

## 管线开销真相（2026-09-25 实测）

- **内存主因是 `--embed-resources`**，不是 pandoc 天生吃内存：它把 997KB 的 MathJax JS +
  全部图片 base64 塞进中间 HTML（中间产物 55.5KB → 1368KB）。去掉后段1 墙钟 2089→186ms、
  段2 峰值 365MB→129MB，两段合计 492→239MB。
- **段2 内存只由输入 HTML 体积决定，与模板大小无关**；模板垃圾**吃时间不吃内存**
  （段2 821ms→385ms→230ms）。
- **`templates/hutb-shared/reference.docx` 是污染源**（被 6 个模板共用）：自带 659KB
  零引用孤儿图（image1–6，含 image5.png 301.8KB）+ webSettings 里 951 个 `<w:div>` +
  settings 里 2974 个 `<w:rsid>`。`hutb-guanke-xuenian` / `hutb-gongke-fengmian` 同样污染，
  `apa7` 干净（脚本生成的）。清理后产物 **941KB→292KB**，且 document.xml/styles.xml/9 张
  文档图**逐字节一致**。
- **产物不可复现**：`pic:cNvPr@descr` 被写入 `.cache/wordeditor-api-node/<uuid>/…` 绝对路径，
  同一输入两次构建 document.xml 不同（也泄漏服务器路径）。根因 embed + normalize 换回绝对路径；
  且 pandoc 在图片**无 alt** 时用 `src` 填 `descr` → 一个 descr 吃 339KB base64。
- 可用优化：① 清模板 ② 去 embed（同步删 `normalizeStandaloneHtml`，**两端同改**）③ 去 `--mathjax`。
  **不要**合并成单段 —— 会丢 MD 里 HTML class → `custom-style` 的映射（项目依赖）。
- 报告与脚本：`.cache/regression/PANDOC-COST-ANALYSIS-2026-09-25.md`。

## 环境

- Pandoc：`tool_paths.find_pandoc()` 自动扫，本机命中 `/Users/Admin1/homebrew/bin/pandoc`
  （仓库内还有一份 `.tools/pandoc-3.9-arm64/bin/pandoc`；`.tools/pandoc-3.9.0.2-arm64/` 是空壳，别被骗）。
- **`tools/parity.ts` 硬编码 `python3`**：本机基础版没装 pyyaml，CLI 层对比会挂；HTTP 层走 venv 没事。
- **起 python 服务必须用托管 venv**：`python3` 指向 3.13.12 基础版，**没装 uvicorn**；
  要用 `/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python -m uvicorn app:app --app-dir services/api-python`。
- **`services/api-node/dist/` 是编译产物，不含源码改动**：`pnpm start` 跑 dist 会拿到旧行为，
  改完管线必须 `pnpm dev`（tsx 直跑 ts）或重新 build 才生效。
- `services/api-python/app.py` 用 Bash `grep` 会匹配不到内容（疑似含特殊字节），用 Grep 工具。

## 云地分工部署（2026-09-26 上线）

**云端 = 成都 ROGINX 服务器（c202608060983447 / 100.98.118.42，公网 103.52.153.223）薄后端**。
⚠️ 曾误部署到 XQJN 服务器（100.127.82.64），2026-09-27 已彻底清理（pm2/nginx/目录/库全删）。
- 目录 `/www/wwwroot/word.roginx.ink/`：`repo/services/api-node/`（dist+node_modules+.env）+ `repo/config/templates.json` + `repo/contracts/openapi.json` + `web/dist`（前端静态）。
- **systemd 服务 `wordeditor-api`**（那台服务器无 PM2 惯例），端口 **8791**，`WORDEDITOR_EDITION=cloud`；nginx `/www/server/panel/vhost/nginx/html_word.roginx.ink.conf`（80+443，复用 `cert/www.roginx.ink/` 泛域名证书，/api → 8791，SPA fallback）。
- **DB 就在本机 MySQL**（127.0.0.1，wordeditor/<redacted>，库 wordeditor，7 单原有数据）。
- 本地 .env 的 COS_* 与服务器一致（ap-chengdu mybox-1257251314）。
- **DNS 已加（2026-09-27，DNSPod API Record.Create，A → 103.52.153.223，TTL 600）；SSL 用泛域名证书，实测 https 200 + 证书校验通过。**

**构建形态开关**：
- 前端 `VITE_EDITION=cloud`：registerFeatures 不注册 make/meta 组 → rollup DCE，制作工具 chunk 根本不进产物；appStore bootstrap 空 config 兜底。full=默认。
- 后端 `WORDEDITOR_EDITION=cloud`：routes/index.ts 只注册 system+docorder（鉴权/工单/上传），模板/构建/导入路由不注册 → 服务器无需 pandoc。
- **坑：ESM import 提升，模块顶层读 process.env 在 dotenv config() 之前 → 后端形态判定必须惰性（`edition()` 函数），不能 const。**
- 前端访问级别：`access: 'public'|'worker'|'admin'`（registry.canAccess），菜单过滤 + routes.tsx RoleGate 双重拦截；cloud 构建直接物理排除。

**冒烟**：`/tmp/word-cloud-smoke.mjs`（playwright + `--host-resolver-rules=MAP word.roginx.ink 103.52.153.223` 绕 DNS），10 项全过。Chromium 路径注意是 `chrome-mac-arm64/Google Chrome for Testing.app`。
