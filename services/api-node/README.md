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

## 部署与内存

生产用 `pnpm build && node dist/main.js`，**不要用 `tsx`**（tsx 常驻多约 28 MB，且带类型解析）。

实测（macOS，与 api-python 同一测量口径，`ps` RSS + `top` phys_footprint）：

| 指标 | 值 |
| --- | --- |
| 空闲常驻 | RSS 39 MB / footprint 41 MB（api-python 38 MB） |
| 单路构建峰值进程树 | 126 MB（服务本体）+ 255 MB（pandoc 子进程） |
| 样式预览峰值 | pandoc 374 MB 占绝对大头，引擎侧只差 20~30 MB |
| 15 任务浸泡后 | RSS 回落到 37 MB，无累积泄漏，不需要定时重启 |

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
- 上传模式里越界/超大的条目：两边都静默跳过该条目，Node 额外给一行告警日志。
- `PUT /api/file?path=`（空路径）：Python 试图写仓库根返回 500，Node 返回 400 `invalid path`。
- 请求体上限 `MAX_BODY_BYTES` 96 MB（超限 413）：Python 无上限，Node 保留护栏。

## 已核对的回归范围

- 完整链路 `parity full`：8 个模板产物语义一致。
- `POST /api/preview/styles`：8 个模板（把模板自己的 styles.yaml 原样回传）产物语义一致。
  请求里的 styles.yaml 是文本，落进任务目录前顶层相对 `extends` 会按 `templates/<templateId>/`
  锚定成绝对路径，两引擎同一处理。
- `/api/build/stream` 选项矩阵 13 例（`noHtmlPipe` / `noPostprocess` / `password` / 页眉页脚对齐组合 /
  `provenance` / 中文与非法字符文件名 / 别名模板 / entries 上传带图 / 三线表+公式）：产物与 `done` 负载一致，
  日志行逐字一致。`password` 的 `w:hash`/`w:salt` 是随机盐，哈希算法本身已与 `_hash_password` 同盐核对过。
- 其余端点 41 项（含 `/api/import/docx` 含公式与图片的 docx、
  各错误分支、并发 4 任务的作业目录隔离）：除上表所列，响应一致。
- 内存改造（zip 单次会话 / 配置缓存 / 并发闸门 / TTL 回收）后上述四项全部重跑通过；
  另把改造前后的产物逐部件 sha1 对比，除 `docProps/core.xml` 的生成时间戳外全部相同。

