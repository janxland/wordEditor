# api-node

Fastify + TypeScript backend with API parity for wordEditor frontend.

## Goals

- Implement all `/api/*` endpoints used by frontend.
- Keep markdown/docx processing in Node orchestration.
- Resolve templates and workflow paths from repository root.
- Modular service architecture for future api-node expansion.

## Run

```powershell
cd services/api-node
pnpm install
pnpm dev
```

Default port: `8787`

Optional env:

- `WORDEDITOR_PORT` (default `8787`)
- `WORDEDITOR_REPO_ROOT` (auto-detected by default)
- `PANDOC` (optional explicit pandoc executable path)
- `WORDEDITOR_MAX_CONCURRENCY` (重任务并发上限，默认按物理内存推出 1~8)
- `WORDEDITOR_JOB_TTL_MINUTES` (任务目录保留时长，默认 360 分钟)
- `WORDEDITOR_LOG_LEVEL` (pino 访问日志级别，默认 `info`，静音用 `warn`)

## 接口契约

`contracts/openapi.json` 是唯一的接口来源，两个引擎按原始字节同发：

- `GET /openapi.json` — 12 个操作的请求体 schema、字段说明、错误文案（`x-errors`）、
  可直接执行的 `x-curl`；`info.x-ai` 里写清双引擎、并发闸门、任务 TTL 与
  「失败也是 HTTP 200 + SSE `error` 帧」这条最容易踩的约定。
- `GET /docs` — 配套的离线阅读页（无 CDN、无新依赖），同样两端同源。
- 请求体的必填项由 Fastify 内置 ajv 从同一份契约取，校验失败经 `setErrorHandler`
  翻译成与 Python 手写检查同字的 `{"detail": "… is required"}`；只借必填、不借类型，
  避免 Fastify 默认的 `coerceTypes` 把数字塞成字符串而改变语义。
- `/api/build/stream` 有意不注册 schema：它的入参错误按契约走 SSE `error` 帧，
  框架先抛 400 会让前端只看到一个无详情的连接错误。

改接口时的顺序是：先改 `contracts/openapi.json`（含校验用的 `required`），再改处理函数。

## 部署与内存

生产用 `pnpm build && node dist/main.js`，**不要用 `tsx`**（tsx 常驻多约 28 MB，且带类型解析）。

实测（macOS，`ps` RSS 口径；同一构建空载复测有 ±5 MB 抖动，因为 macOS 的 RSS 把共享页也计进每个进程，
机器越忙读数越高）：

| 指标 | 值 |
| --- | --- |
| 空闲常驻 | dist 76 MB（同机 api-python 43 MB）。对照组：裸 Fastify + 一个路由 = 65 MB，即本服务的代码与依赖只加约 1~2 MB |
| 首个解 docx 的请求 | 76 → 81 MB（jszip 载入 + 整包解压，这是工作本身） |
| 单路构建峰值进程树 | 126 MB（服务本体）+ 255 MB（pandoc 子进程） |
| 样式预览峰值 | pandoc 374 MB 占绝对大头，引擎侧只差 20~30 MB |
| 15 任务浸泡后 | RSS 回落到空闲水位，无累积泄漏，不需要定时重启 |

> 早期版本这里记的是「空闲 39 MB」——那是把裸 node 进程（实测 38 MB）当成了服务，已作废。

**常驻水位已经压不动了**：jszip 已改成首次开包时才 `import`（`ooxml/zip.ts`），
但 A/B（同一构建、各 3 次）只从 77.0/77.1/76.7 降到 76.2/76.3/76.4 MB —— 模块本身摊薄后约 1 MB。
xmldom（+1.3 MB）、yaml（+2.4 MB）同理，而它们的调用点是同步的，为 1~2 MB 把同步链改成异步不值。
结论：空闲足迹由 Fastify + V8 决定，要再降只能换框架或减并发，不该继续在「谁 import 得晚」上做文章。

真正值得省的是**一次请求内的峰值**（已做）：图片反查索引从「整目录 base64 常驻」改成
逐张 sha256（`pandoc.ts`）。100 MB 图片目录：旧实现索引进程 RSS 189~228 MB，新实现 79 MB。

一次请求的峰值 ≈ `服务本体常驻 + pandoc 峰值 + 引擎增量`。pandoc 与引擎无关且占大头
（小文档 115 MB → 多图 257 MB → 预览样例 374 MB），Node 侧增量约 30~90 MB（docx 解析在进程内），
Python 侧约 2~6 MB 但另起 2~3 个短命子进程。**因此限并发比限内存有效**：

| 主机内存 | 建议 `WORDEDITOR_MAX_CONCURRENCY` |
| --- | --- |
| 1 GB | 1~2 |
| 2 GB | 2~3 |
| 4 GB | 5 |
| 8 GB+ | 8（代码默认上限） |

闸门的取舍是「用排队换内存」，4 路并发构建实测：上限 4（等于不限）进程组峰值 **479 MB**，
上限 2 降到 **271 MB** 且 4/4 全部成功，多出的 2 路在 SSE 里收到 `[排队] … 第 N 位` 日志。

`--max-old-space-size` 只是给堆**设界**（让内存在服务内部失败，而不是被 OOM killer 打挂整机），
它本身不省内存；取值参考启动日志打印的「JS 堆上限 / 物理内存」两行：

```bash
NODE_OPTIONS=--max-old-space-size=512 node dist/main.js
```

上传体上已有 `MAX_BODY_BYTES = 96 MB` 的硬顶，`/api/import/docx` 走 JSON base64（约 1.37 倍膨胀），
内存敏感的小机型可把它调小。

## Tech Stack

- Fastify (API framework)
- TypeScript (NodeNext ESM)
- JSZip + xmldom (OOXML 部件读写，ElementTree 等价 DOM 层见 `src/pipeline/ooxml/xml.ts`)
- yaml (styles.yaml DSL)

## Parity

后端与 `services/api-python` 是同一套 `/api/*` 契约的两份实现，docx 产物要求一致。
用 `npx tsx tools/parity.ts <pandoc|stage --upto <stage>|full> -i <md> -t <template>`
逐阶段对比两条链路：XML 部件按命名空间规范化后做语义比较（Node 侧为 DOM 改写，不追求 zip 逐字节）。
两份已有产物可直接 `npx tsx tools/parity.ts docx -a <file> -b <file>`（HTTP 端点回归用）。

## 有意保留的差异

以下是核对过、决定不跟 Python 对齐的点，别再当 bug 反复修：

- `GET /api/health` 的 `service` 为 `api-node`：用来分辨当前生效的引擎。
- `GET /api/tools` 的 `python.path`：Python 侧是自身解释器，Node 侧是探测到的 `python3`（仅备用引擎需要）。
- 错误文案：Python 常给 `build failed: 1` / 带尾随换行的 stderr，Node 在同样的 `{"detail"}` / SSE `{"error"}` 结构下给可读原因（如未知模板 + 可用列表）。
- SSE `step` 事件集合一致，但顺序按真实阶段单调推进；Python 因 `build.py` stdout 块缓冲，后处理事件会先于 `模板:/输入:` 到达，不复制这个乱序，也不复制每个 `[后处理]` 前的那个空行。
- SSE/JSON 的字面量差异：`json.dumps` 的 `", "` / `": "` 空白、浮点写成 `1.0`（Node 为 `1`）—— 任何 JS 消费者解析后同值。
- 方法不匹配（如 `POST /api/file`）：FastAPI 回 405，Fastify 4 有意对所有未知方法统一回 404。
- 请求体不是合法 JSON（如 `PUT /api/file` 传裸文本）：FastAPI 抛 500 纯文本，Node 经 `setErrorHandler` 回 400 `{"detail"}`。
- 未捕获异常出的 500：FastAPI 只回纯文本 `Internal Server Error`，Node 统一回 `{"detail":"<原因>\n<详情>"}`，400 层的 `{"detail"}` 文案两端逐字相同。
- 上传模式里越界/超大的条目：两边都静默跳过该条目，Node 额外给一行告警日志。
- `PUT /api/file?path=`（空路径）：Python 试图写仓库根返回 500，Node 返回 400 `invalid path`。
- 请求体上限 `MAX_BODY_BYTES` 96 MB（超限 413）：Python 无上限，Node 保留护栏。
- 样式预览样例稿 `templates/hutb-shared/preview-styles.md` 里有两张 jsdelivr 远端图，
  两引擎各自让 Pandoc 现取现嵌：网络抖动会让某一侧少嵌 2 张图，产物大小与 media 数随之不同。
  比对预览产物前先确认两边 `word/media` 数量相同，别把它当成引擎差异。

## 已核对的回归范围

- 完整链路 `parity full`：9 例（含 `input/数学建模2013A题` 那篇带「注：」正文的长文）产物语义一致。
- `POST /api/preview/styles`：8 个模板（把模板自己的 styles.yaml 原样回传）产物语义一致。
  请求里的 styles.yaml 是文本，落进任务目录前顶层相对 `extends` 会按 `templates/<templateId>/`
  锚定成绝对路径，两引擎同一处理。
- `/api/build/stream` 选项矩阵 13 例（`noHtmlPipe` / `noPostprocess` / `password` / 页眉页脚对齐组合 /
  `provenance` / 中文与非法字符文件名 / 别名模板 / entries 上传带图 / 三线表+公式）：产物与 `done` 负载一致，
  日志行逐字一致。`password` 的 `w:hash`/`w:salt` 是随机盐，哈希算法本身已与 `_hash_password` 同盐核对过。
- 其余端点 41 项（含 `/api/import/docx` 含公式与图片的 docx、
  各错误分支、并发 4 任务的作业目录隔离）：除上表所列，响应一致。
- 错误分支专项 24 项（20 个 REST 校验/越界/不存在路径 + 4 个 SSE `error` 帧）：
  400 层 `detail` 逐字相同，余下 7 项均为上表已登记的类别。
- SSE 心跳：两端每 15 秒发同一条 `:ping\n\n` 注释帧，响应头（`Content-Type` 带 charset、
  `Cache-Control`、`X-Accel-Buffering`）也已对齐；把间隔临时调到亚秒实测 node ping=7、
  python ping=15，`step` / `log` / `done` 计数与改造前相同。
- 契约发布：`GET /openapi.json` 与 `GET /docs` 两端字节相同，且等于仓库内的
  `contracts/openapi.json`；缺必填字段时两端同为 `{"detail":"… is required"}`。
- 内存改造（zip 单次会话 / 配置缓存 / 并发闸门 / TTL 回收）后上述四项全部重跑通过；
  另把改造前后的产物逐部件 sha1 对比，除 `docProps/core.xml` 的生成时间戳外全部相同。
- 常驻/按需这一轮（图片反查改摘要索引、jszip 惰性载入、配置缓存加 LRU 上界且失败不再被固化、
  CDN 覆盖不再写进共享缓存对象）后：`parity full` 9 例、矩阵 13 例、REST 41 项（仍只有上表
  所列 5 项框架级差异）、预览 8 模板全部一致；3 个带图用例改造前后逐部件 sha1 比对，
  除 `docProps/core.xml` 时间戳外全部相同。

