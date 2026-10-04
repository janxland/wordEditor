# wordEditor · 项目长期记忆（注入版）

> 详版（全部历史坑/数值）在 `MEMORY.detail.md`，需要时再 Read。

## 定位与入口

湖南工商大学论文导出工具：Markdown → docx。
`apps/wordEditor-frontend → /api → services/api-node（8787）` 或 `/py-api → api-python（8788）`。
离线链路：Pandoc + reference.docx + Lua 过滤器 + OOXML 后处理 + styles.yaml DSL。
**唯一 CLI 入口 `bin/we`**（build/templates/analyze/clone/verify/extract/ref-styles）；MCP 9 工具在
`services/api-python/mcp_server.py`；CLI 与 MCP 共用 `direct.py`，不要绕开它直写 OOXML。

## 硬约定

- 模板注册在 `config/templates.json`；`build.py` 只认已注册 id。工作区 = MD 所在目录。
- 模板三件套 `reference_doc` + `lua_filter` + `styles_yaml`；`resolve_lua_filters` 要求 `lua_filter` 非空。
- **两段管道**：md→html 不加载 Lua → Markdown 里写 `custom-style` 会被丢；只能写 HTML class，
  由 html→docx 段的 Lua 补回。不要合并成单段（会丢 class→custom-style 映射，项目依赖）。
- `postprocess_styles.py` DSL 是中文档排版口径（字号 half-pt、缩进字符）；英文版式固化进
  reference.docx，不要在 styles.yaml 用 `custom_styles` 重建。
- 往 tblPr/tcPr/pPr 塞元素一律走共享层 `ooxml/schema-order.ts` ↔ `pipeline/ooxml_schema_order.py` 的
  `putOrdered` / `put_ordered`，别 append 到末尾。
- **stdout 只放结果，进度一律 stderr**（`we clone` 的 JSON 要能被 jq 消费）。
- 改 `spec.yaml` 只能文本级定点替换，**禁止 yaml.safe_dump 往返**（洗掉注释）。
- 加新构建参数只改 `bin/we` argparse + `build_passthrough()`，别改 direct 映射表。
- **OOXML 命名空间 URI 唯一定义在 `services/api-python/ooxml_ns.py`**（W/R/XML/NS）。
  任何模块别再本地写一份 URI；`pipeline/` 与 `pipeline/tools/` 下的模块要先往 sys.path 塞
  api-python 根才 import 得到。**`q()`/`_q()` 构造器仍按 ET / lxml 分栈各留一份，不许合并**
  （元素类型不通用）。`NS` 是超集 `{"w","r"}` —— 只当 find/findall/xpath 前缀表用，
  **别拿去序列化**（多出来的 `r` 会被写进产物）。

## 模板

中文：hutb-gongke / hutb-guanke（默认）/ hutb-xingce / hutb-math-modeling / hutb-gongke-fengmian /
hutb-guanke-fengmian / hutb-guanke-xuenian / hutb-jinrong-bigdata / hutb-shehui-diaocha；英文：apa7。

**新增模板一律走工厂**（`template_factory.py` analyze/detect/check/build + `template_verify.py`）：
1. **封面/尾页评分表整页字节级搬运**，禁复刻禁分析表结构；边界 `slice: auto` 由 detect 探测。
2. **reference.docx 整包克隆源 docx**（`build_reference_cloned()`）—— 光块字节一致不够，
   docDefaults/theme/settings 不同源会让渲染全变（踩过 pPrDefault 撑开封面、themeFontLang=ja-JP
   把列表编号变日文）。验收要比解析后格式 `resolve_para()`，0 段不同才结案。
3. **格式以模板文字描述为准**，不以示范段 OOXML 值为准（作者常设错，如标注小四实际 sz=28）。
   块内容绝不用 lxml/ET（parse→serialize 丢节点、前缀未绑定 → Word 报损坏），走字节切片。
- 双引擎都要验收：Node 块注入在 `pipeline/stages/blocks.ts`，stage 必须排最后。

## 接单区 vs 代码区（2026-10-04 确立，别搞混）

- **客户稿件一律放仓库根 `jobs/`**：`jobs/inbox/` 来稿 → `jobs/work/<单号-标题>/` 在建 →
  `jobs/done/` 已交付。**整目录被 `.gitignore` 忽略**（只入库 `jobs/README.md` + 三个 `.gitkeep`）。
  工作区约定不变：工作区 = MD 所在目录，`we build` 产物回写同级。
- **`input/` 是代码自带的样例与回归输入，要入库**。
  `input/暑假社会调查报告-样例.md` 是 **E6 产物等价回归（28/28 部件逐字节一致）的基线输入**，
  删了改了回归就跑不了。`input/金融大数据课程论文-样例.md` 同理。
- **判断口诀**：「删掉会不会让别人跑不通这个项目」→ 会 = `input/`；不会 = `jobs/`。
- 客户稿件别放 `input/`（曾有两单 41M 堆在那里，让工作区永远脏、还差点被去冗余扫描误判）。
- CLI `we --help` / `bin/we` docstring、MCP `mcp_server.py` instructions、skill
  `wordeditor-export` 与 `wordeditor-pipeline-audit` **都已写明这条边界**，改任一处要同步。

## 双引擎

契约单一来源 `contracts/openapi.json`（12 接口），两端同发 `/openapi.json` + `/docs`。
产物等价已逐部件验证。**唯一不等价是 SSE 进度流且 python 落后 3 处（至今未修）**：
`_sse()` json.dumps 带空格、`_emit_step_from_build_line()` 靠日志关键字反推 step（重复帧+step 后置）、
entries 越界静默跳过。清单见 skill `wordeditor-pipeline-audit`。

## 回归

- CLI 层：`services/api-node/tools/parity.ts`。HTTP 层脚本已丢失，重建规格在 skill 里，重建后放 skill 的 `scripts/`。
- docx 比对：解 zip → XML 语义归一 → 逐部件比；先 strip `dcterms` 时间戳、密码 hash/salt、任务目录路径。
- 死代码检测用 **AST + `git grep` 双证**；证据标准 = 28/28 docx 部件去时间戳后逐字节一致。
- A/B 别 `cp` 覆盖源文件（踩过覆盖回旧版），用独立目录 + try/finally + 断言行数。

## 环境 / 部署

- Pandoc：`/Users/Admin1/homebrew/bin/pandoc`（`.tools/pandoc-3.9.0.2-arm64/` 是空壳，别被骗）。
- 起 python 服务用托管 venv（系统 python3 无 uvicorn）；`services/api-node/dist/` 是编译产物，改完要 `pnpm dev` 或重新 build。
- 云端 = 成都 ROGINX（103.52.153.223），systemd `wordeditor-api` 端口 8791，`WORDEDITOR_EDITION=cloud`；
  前端 `VITE_EDITION=cloud`。**形态判定必须惰性函数**（ESM import 提升会早于 dotenv）。
- `LICENSE` 专有许可，仓库必须转私有（见 `docs/ip-protection-checklist.md`）。

## 去冗余迭代（2026-10-04 起）

状态机与每轮缺陷台账在 **`docs/refactor/ITERATION-STATE.md`**，轮次明细在 `docs/refactor/rounds/`。
规则：每轮 5 个缺陷、单测/产物证据闭环、禁止"看着对"结案。详见该文件头部。
- 单例检测唯一入口 `tools/singleton-scan.py`（A0 孤岛 / A 无人 import / B+C 同名符号多份定义）。
  第 03 轮已修 Vite 误报：认 index.html script 入口 + vite/tsconfig 别名 + `import()`/`require`
  动态 specifier，`.d.ts` 剔除，devtool 目录单列 `D.devtool` 不计缺陷。
  **改扫描器 = 改全仓判定，动完必须 `api-node`/`api-python`/`frontend` 三个 target 全跑复验。**
  B/C 只扫 `export` 符号，非导出的重复私有函数扫不到（已知局限）。
- **python 跑管线一律用 venv** `/Users/Admin1/.workbuddy/binaries/python/envs/default/bin/python`
  （托管 3.13.12 没装 lxml/yaml，clone_core / template_factory 直接 import 失败）。
- 产物 A/B 用 `git worktree add /tmp/xxx HEAD --detach` 建独立目录，**别 cp 覆盖源文件**。
