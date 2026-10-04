# wordEditor · 长期记忆（详版，不注入上下文）

> 压缩自 2026-10-04 之前的 MEMORY.md。注入版见同目录 `MEMORY.md`。
> 保留全部历史坑与数值细节，供排查时按需 Read。

## 模板复刻工厂（2026-09-25 起）

新增任意 docx 格式模板一律走工厂，别手写三件套：
```
python services/api-python/template_factory.py analyze "<源docx>"    # 解剖
python services/api-python/template_factory.py detect  "<源docx>"    # 自动探测封面/评分表边界
python services/api-python/template_factory.py check  templates/<id>/spec.yaml
python services/api-python/template_factory.py build  templates/<id>/spec.yaml   # 幂等
python services/api-python/template_verify.py templates/<id>/spec.yaml <产物.docx>  # 0 FAIL 才结案
```

**铁律 1：封面/尾页评分表 = 整页原样搬运（字节级），禁止复刻、禁止分析表格结构。**
边界由 `detect` 自动探测，spec 写 `slice: auto`；`template_verify.py` 同源调 detect。禁止人肉数索引写死。
- 绝不用 lxml/ET 处理块内容（parse→serialize 会丢 proofErr/注释/PI，且 nsmap 只按首元素继承 → 前缀未绑定 → Word 报文档损坏）。块走字节：`iter_body_top_level()` 切 + `clone_core._inject_block()` 字符串插入。
- xmlns 声明必须随块补进产物 `<w:document>` 根，否则 unbound prefix。抽取时从 `indexOf('<w:blocks')` 起算，别用 `indexOf('>')`（会命中 `<?xml?>` 里的 `>`）。
- 书签要成对：曾删掉顶层 `bookmarkEnd` 留下段内 `bookmarkStart` → 不闭合。
- 验收只比"源片段字节（rId 归一后）是否原样出现在产物中"，不查行列/合并/单元格文本。

**铁律 1.5：块字节一致不够，文档级默认值必须同源。** 段落没写死的项（行距/默认字体/东亚语言）继承 docDefaults / theme / settings / sectPr。从零造 reference 时曾把 `pPrDefault` 塞成 `after=200 line=276 auto`（源是空）→ 封面 20 段 + 评分表 74 段全被撑开；`themeFontLang` 是 `ja-JP`（python-docx 默认模板自带，源是 zh-CN）→ 默认东亚字体变日文字体，列表编号「一、（一）、①」跟着变日文。
→ reference.docx 一律整包克隆源 docx（`build_reference_cloned()`，工厂默认）：复制全部部件 → 清空 body 留 sectPr → 追加源没有的样式 → themeFontLang 兜底 zh-CN → 补 numbering / 删孤儿 media。验收必须比解析后格式（`resolve_para()`：docDefaults → pStyle/basedOn 链 → 段落 → 首个 run），0 段不同才算过。

**铁律 2：正文/标题格式以模板里的「文字描述」为准**（如「正文（小四号宋体、行距固定值24磅）」），不以示范段 OOXML 值为准 —— 示范段常被作者随手设错（标注小四、实际 sz=28）。OOXML 只用于取文字没覆盖的参数（缩进 twips / 页面设置 / 表格几何）。字号常是混合的，别统一成一个值。

**双引擎都要跑验收**：前端默认走 `/api` → Node 8787，Python 只走 `/py-api`。Node 侧块注入是 `services/api-node/src/pipeline/stages/blocks.ts`（stage `blocks` 排在 STAGES 最后，确保不被样式阶段冲刷）。历史坑：Node 侧曾完全没有实现块注入（`templates.ts` 的 coverBlock/tailBlock 只是死字段），2026-09-25 才补上。改 stage 顺序时别把它挪到样式阶段之前。

**映射而非新造**：识别出的要求映射到既有样式（ae/文章的正文、Cankaowenxian、ZhaiYao*/Abstract*/KeyWords*、heading 1-4 + multilevel_list）。新 styles.yaml 是 `extends: ../_shared/hutb-base.yaml`，只写差异。没段落会用到的样式 = 过度切，删掉。
- `<div class="cs-XXX">` 是 apa7 的扩展，hutb 主 lua 不支持（写了落 BodyText）。
- 模板目录自包含：`source.docx` + `spec.yaml` + 工厂产物。
- 结构化资产：`fields.json`（封面字段）/ `rubric.json`（评分指标）供 Web 渲染表单。
- 产物里正文 styleId 是中文「文章的正文」（pandoc 按 lua 的 custom-style 建，DSL 按 name 覆盖）。
- `first_line_chars: 2` 默认 firstLine=200 ≠ 2 字符，必须显式 `first_line_dxa: 560`。
- heading styleId 必须是 `1`..`9`（对齐 styles.yaml 的 `match: {id: "1"}`）。
- `Title` 无 DSL 覆盖入口，字号行距只能落在 reference.docx。
- 模板自述与 OOXML 实测冲突时以 OOXML 为准。

## 模板清单

中文：hutb-gongke / hutb-guanke（默认）/ hutb-xingce / hutb-math-modeling / hutb-gongke-fengmian / hutb-guanke-fengmian / hutb-guanke-xuenian / hutb-jinrong-bigdata / hutb-shehui-diaocha。
英文：apa7（Letter、四边 1 英寸、Calibri 11pt、双倍行距、页脚居中页码、References 悬挂缩进 0.5 英寸、Heading1 居中加粗无编号）。版式源 `templates/apa7/build_reference.py` 生成。MD 标记：`<div class="pagebreak"></div>` 分页、`<div class="cs-XXX">` 指定段样式。

## 产品化 / MCP（2026-10-03）

MCP 实测 9 个工具（别再少）：templates / build_docx / apply_style / save_style / list_styles / save_template / remove_template / analyze_docx / clone_template。
- `analyze_docx` 的正文区 = 去掉封面/尾表两切片后的区间（封面可能在正文之前，如 hutb-shehui-diaocha 封面 body[21:38]、正文 [38:58]）→ 用 `min(slice[1])..max(slice[0])` 算，别写死 `cover[1]..tail[0]`。
- `clone_template` 自动填机械可读项：封面字段（`extract_fields` 逐格读表）、tail.title（detect 抓）、rubric 的 grade/remark/signature 行 + other_rows。只有 `tail.rubric.groups` 是语义判断，且只驱动 Web 表单不进 docx → 缺了报 advisory 不阻塞出稿。
- `we clone` 退出码：ok=false → exit 2。`we verify` 走 template_verify 退出码。

授权：`LICENSE` 专有许可。仓库必须转私有（最高优先级未完成，见 `docs/ip-protection-checklist.md`）。护城河是模板生态不是代码。

## 去冗余与 stdout 契约（2026-10-03）

- `run.py` 已删。Python 侧唯一 CLI 入口 `bin/we`：build / templates / analyze / clone / verify / extract / ref-styles。参数解析转交给 `pipeline/` 脚本。
- `build.py` 20 个参数原只透传 4 个 → 已加 `direct.build_to_workspace(extra_args=...)`。加新参数只改 `bin/we` argparse + `build_passthrough()`。
- stdout 只放结果，进度一律 `print(..., file=sys.stderr)`（已修 direct.py、tpl_factory/assets.py）。
- `ooxml_numbering.py` 97→15 行，只剩 `HUTB_HEADING_NUM_ID = 2`。
- 改 `spec.yaml` 只能文本级定点替换，禁止 `yaml.safe_dump` 往返（洗掉全部注释，实测 22→0）。替换要求：① 单行正则 ② 传 indent（title 在缩进 0/2 各出现一次）③ 传 parent 走完整层级校验 ④ 每次替换后 `yaml.safe_load` 守卫。改完断言注释数不变。
- 死代码检测用 AST + `git grep` 双证（shell `grep -r` 的 `\b` 不生效、包内互调误报、全仓 grep 超时）。删完证据标准：28/28 docx 部件 strip dcterms 时间戳后逐字节一致。
- A/B 对照别 `cp` 覆盖源文件（踩过：收敛版覆盖回 97 行旧版）。正确：旧版独立目录 + try/finally 还原 + 跑完断言行数。

## 表格后处理

- `ooxml/schema-order.ts` ↔ `pipeline/ooxml_schema_order.py`：ECMA-376 子元素顺序表（TBLPR/TCPR/PPR）+ `putOrdered`（py `put_ordered`）/ `ensureOrdered` / `orderIn`。往 tblPr/tcPr/pPr 塞元素一律走它。
- 三线表 = 顶线/栏目线/底线 + `tblW=5000 pct` + `jc=center` + `tblLayout=autofit` + 单元格 `vAlign=center` + 单元格段落 `jc=center`（SourceCode/VerbatimChar 段落跳过水平居中）。
- verbatim（代码块）表在 three-line 之后跑，自建表不加 vAlign；取值（8300 dxa / fixed / 边框 / 字号）别动。

## 管线开销真相（2026-09-25 实测）

- 内存主因是 `--embed-resources`：把 997KB MathJax JS + 全部图片 base64 塞进中间 HTML（55.5KB → 1368KB）。去掉后段1 墙钟 2089→186ms、段2 峰值 365MB→129MB，合计 492→239MB。
- 段2 内存只由输入 HTML 体积决定，与模板大小无关；模板垃圾吃时间不吃内存（段2 821→385→230ms）。
- `templates/hutb-shared/reference.docx` 是污染源（6 个模板共用）：659KB 零引用孤儿图（image1–6，image5.png 301.8KB）+ webSettings 951 个 `<w:div>` + settings 2974 个 `<w:rsid>`。清理后产物 941KB→292KB，document.xml/styles.xml/9 张图逐字节一致。
- 产物不可复现：`pic:cNvPr@descr` 写入 `.cache/wordeditor-api-node/<uuid>/…` 绝对路径（也泄漏服务器路径）；pandoc 在图片无 alt 时用 src 填 descr → 一个 descr 吃 339KB base64。
- 可用优化：① 清模板 ② 去 embed（同步删 `normalizeStandaloneHtml`，两端同改）③ 去 `--mathjax`。不要合并成单段 —— 会丢 MD 里 HTML class → custom-style 的映射。
- 详见 skill `wordeditor-pipeline-audit` 的 `references/pandoc-cost-audit.md`。

## 回归方法

- CLI 层产物对比：`services/api-node/tools/parity.ts`（pandoc / stage / full / docx）。
- HTTP 层回归脚本已丢失（原 `.cache/regression/*.mjs` 被清理未进 git）。重建规格在 skill `wordeditor-pipeline-audit` 的 `references/dual-engine-regression.md` §3–§5；重建后放 skill 的 `scripts/`。
- docx 比对口径：按部件解 zip → XML 语义归一（前缀按 URI 重编 nsK、折叠空白）→ 逐部件比。`dcterms:created/modified`、密码 hash/salt、任务目录路径先 strip。

## 环境

- Pandoc：`tool_paths.find_pandoc()` 扫到 `/Users/Admin1/homebrew/bin/pandoc`（仓库内 `.tools/pandoc-3.9-arm64/bin/pandoc`；`.tools/pandoc-3.9.0.2-arm64/` 是空壳）。
- `tools/parity.ts` 硬编码 `python3`：基础版没装 pyyaml，CLI 层对比会挂；HTTP 层走 venv 没事。
- 起 python 服务必须用托管 venv：`/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python -m uvicorn app:app --app-dir services/api-python`（系统 python3 无 uvicorn）。
- `services/api-node/dist/` 是编译产物：改完管线必须 `pnpm dev`（tsx）或重新 build，`pnpm start` 跑 dist 会拿到旧行为。
- `services/api-python/app.py` 用 Bash grep 匹配不到（疑似含特殊字节），用 Grep 工具。

## 云部署（2026-09-26 上线）

云端 = 成都 ROGINX 服务器（c202608060983447 / 100.98.118.42，公网 103.52.153.223）。
⚠️ 曾误部署到 XQJN 服务器（100.127.82.64），2026-09-27 已彻底清理。
- 目录 `/www/wwwroot/word.roginx.ink/`：`repo/services/api-node/`（dist+node_modules+.env）+ `repo/config/templates.json` + `repo/contracts/openapi.json` + `web/dist`。
- systemd 服务 `wordeditor-api`（该服务器无 PM2 惯例），端口 8791，`WORDEDITOR_EDITION=cloud`；nginx `/www/server/panel/vhost/nginx/html_word.roginx.ink.conf`（80+443，复用 `cert/www.roginx.ink/` 泛域名证书，/api → 8791，SPA fallback）。
- DB 在本机 MySQL（127.0.0.1，库 wordeditor）。本地 .env 的 COS_* 与服务器一致（ap-chengdu mybox-1257251314）。
- DNS 已加（DNSPod A → 103.52.153.223，TTL 600）；SSL 泛域名证书，实测 https 200。

**构建形态开关**：
- 前端 `VITE_EDITION=cloud`：registerFeatures 不注册 make/meta 组 → rollup DCE，制作工具 chunk 不进产物；appStore bootstrap 空 config 兜底。full=默认。
- 后端 `WORDEDITOR_EDITION=cloud`：routes/index.ts 只注册 system+docorder，模板/构建/导入不注册 → 服务器无需 pandoc。
- 坑：ESM import 提升，模块顶层读 process.env 在 dotenv config() 之前 → 后端形态判定必须惰性（`edition()` 函数），不能 const。
- 前端访问级别 `access: 'public'|'worker'|'admin'`（registry.canAccess），菜单过滤 + routes.tsx RoleGate 双重拦截；cloud 构建物理排除。
- 冒烟脚本 `/tmp/word-cloud-smoke.mjs`（playwright + `--host-resolver-rules=MAP word.roginx.ink 103.52.153.223`）。Chromium 路径 `chrome-mac-arm64/Google Chrome for Testing.app`。
