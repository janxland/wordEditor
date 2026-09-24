/**
 * 更新日志数据 —— 与页面解耦：新增条目只改本文件（最新一条放数组最前）。
 * version 用日期或语义号均可；items 按提交主题的 kind 归类（feat/fix/perf/refactor/docs）。
 */
export interface ChangelogItem {
  kind: 'feat' | 'fix' | 'perf' | 'refactor' | 'docs';
  text: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  summary?: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '2026-09 · 引擎可选切换',
    date: '2026-09-25',
    summary: '前端可在设置里于 Node / Python 两引擎间切换，产物闭环等价。',
    items: [
      { kind: 'feat', text: '新增引擎切换：默认 Node（/api→8787），可切 Python（/py-api→8788），选择存 localStorage 并即时重载' },
      { kind: 'feat', text: '设置面板实时探测两引擎健康状态，未启动时给出启动命令' },
      { kind: 'refactor', text: '所有服务端调用与后端返回的下载链接统一走引擎代理前缀，Node/Python 产物逐部件比对语义一致' },
    ],
  },
  {
    version: '2026-09 · 稳定性与内存收口',
    date: '2026-09-24',
    summary: '进程/任务层缺陷清零，构建期内存热点逐点压平。',
    items: [
      { kind: 'fix', text: '子进程提前退出后再写 stdin 抛 EPIPE 会崩掉整个服务——现在按退出码口径回收' },
      { kind: 'fix', text: 'SSE 客户端断开后心跳不再写已关闭的流；任务目录回收不再被单个坏目录卡死，失败请求当场清目录' },
      { kind: 'perf', text: '一次构建共用一个 zip 会话：文本部件缓存、媒体逐张解压落盘、流式落盘，峰值 RSS 明显下降' },
      { kind: 'perf', text: 'pandoc HTML 标题剥离与图片还原合成单趟替换；styles.yaml extends 链每个文件只解析一次' },
      { kind: 'perf', text: 'applyRefs 段落预筛先过便宜的文本关，跳过无引用段落的全树扫描' },
      { kind: 'fix', text: 'pandoc 定位顺序与 tool_paths.py 对齐，两引擎不会再各挑一个版本' },
    ],
  },
  {
    version: '2026-09 · 架构收口',
    date: '2026-09-24',
    summary: '重复实现合并、死代码清除，接口层/管线层/通道层职责各归其位。',
    items: [
      { kind: 'refactor', text: '越界守卫、目录遍历、docx 解包各收成一份实现；删除 10 处零引用导出与一条死配置链' },
      { kind: 'refactor', text: '模板解析收成管线唯一入口 templateById；入参校验与错误出口统一进接口层；SSE 帧格式归位通道层' },
      { kind: 'fix', text: 'CDN 环境变量覆盖不再写进共享缓存对象；配置解析缓存按 LRU 加界，失败不再被永久记住' },
      { kind: 'docs', text: '注释只留 WHY；README 补部署与常驻内存画像（空闲水位由 Fastify+V8 决定）' },
    ],
  },
  {
    version: '2026-09 · 契约与资源治理',
    date: '2026-09-23',
    summary: '两引擎对外行为逐字节对齐，重任务加闸门与回收。',
    items: [
      { kind: 'feat', text: '接口契约单一来源（contracts/openapi.json），api-python 与 api-node 同发 /openapi.json 与 /docs' },
      { kind: 'feat', text: '构建流 SSE 加 :ping 心跳帧，两引擎帧序列逐字节一致；子进程输出按 StringDecoder 接续，跨块 UTF-8 不再写坏' },
      { kind: 'feat', text: '打开 pino 访问日志 + SIGTERM 优雅停机' },
      { kind: 'perf', text: '后处理 7 个阶段共用一次 zip 会话；每请求重复的配置解析改为按 mtime 判新缓存' },
      { kind: 'perf', text: '任务目录按 TTL 回收（启动巡检 + 每 15 分钟）；重任务加零依赖并发闸门，槽满排队并回报位次' },
      { kind: 'perf', text: 'pandoc 图片反查索引改按内容摘要，jszip 首次开包时才 import' },
    ],
  },
  {
    version: '2026-09 · Python 复刻闭环',
    date: '2026-09-23',
    summary: 'Node 后端补全全部后处理阶段与导入链路，产物与 Python 逐字段一致。',
    items: [
      { kind: 'feat', text: 'styles.yaml DSL 注入链、三线表、附录代码块表格化、页眉页脚与动态页码全部移植落地' },
      { kind: 'feat', text: '导入链路改为自建 OOXML 结构还原（告别 Pandoc 直转），公式按命名空间 URI 识别不再整块丢失' },
      { kind: 'feat', text: 'reference.docx 样式明细解析补全，与 Python 输出逐字段一致' },
      { kind: 'fix', text: '/api/* 错误体与 SSE 事件序列、下载响应与 done 负载、后处理日志行全部与 Python 契约逐字对齐' },
      { kind: 'fix', text: '样式预览传入 styles.yaml 的相对 extends 按模板目录锚定；页眉页脚黑框的 wps 形状分支一并移除' },
      { kind: 'refactor', text: '前端删除与后端重复的 dev-api 层，只保留 vite /api 代理' },
      { kind: 'docs', text: 'README 记录与 api-python 有意保留的契约差异与回归范围（8 模板在线预览 + 41 项接口比对）' },
    ],
  },
  {
    version: '2026-09 · 起点',
    date: '2026-09-23',
    summary: 'api-node 按 Python 后端分层重建：Fastify + 零新增依赖（fastify/jszip/@xmldom/xmldom/yaml）。',
    items: [
      { kind: 'refactor', text: 'src/{config,main,server} + http/{routes,jobs} + pipeline/{ooxml,stages} 分层定型' },
      { kind: 'feat', text: '文档结构后处理移植：标题识别、[N] 交叉引用 REF 域、表注兜底' },
    ],
  },
  {
    version: '2026-09 · 模板扩充与 MCP 直连',
    date: '2026-09-06',
    summary: '学校模板成体系（管科/工科/APA 7），构建能力下沉为可直调的 MCP server。',
    items: [
      { kind: 'feat', text: '新增管科含封面评分表、学年论文、工科含封面评分表（反向复刻 docx，封面/评审表块注入）模板' },
      { kind: 'feat', text: '附录代码块转三线表；表题改用 Pandoc Table: 语法；新增 APA 7 英文模板并修复 HTML 管道内联图片丢失' },
      { kind: 'feat', text: 'MCP server + 直连构建层（direct + style_core + bin/we），构建与自然语言样式全覆盖；样式核心迁入 api-python' },
      { kind: 'fix', text: '标题样式解析校验样式名，避免克隆模板中 styleId 数字误配正文样式' },
    ],
  },
  {
    version: '2026-08 · 页眉页脚与导出页交互',
    date: '2026-08-24',
    summary: 'DOCX 页眉页脚写入落地，导出链路跨平台可用性补齐。',
    items: [
      { kind: 'feat', text: 'DOCX 页眉页脚写入后处理（pipeline），导出页接入页眉页脚设置与导出参数透传' },
      { kind: 'fix', text: 'Pandoc 工具路径探测增强（Homebrew/仓库内置/跨平台提示）' },
      { kind: 'fix', text: '适配 antd v5 废弃 API（destroyOnHidden 与 Spin 子元素）；导出页文件夹上传交互改为 webkitdirectory 动态注入' },
      { kind: 'fix', text: '论文文件识别优化' },
    ],
  },
  {
    version: '2026-05 ~ 06 · 初始化与格式打磨',
    date: '2026-05-17',
    summary: '项目起步：Markdown 多模板一键导出 Word + 前端可视化，随后两个月把版式细节磨平。',
    items: [
      { kind: 'feat', text: '初始化 wordEditor：Markdown 多模板一键导出 Word；前端可视化与总览样式落地' },
      { kind: 'feat', text: '加入密码机制；导出到文件夹' },
      { kind: 'feat', text: 'OOXML 去除冗余 VBA 脚本' },
      { kind: 'fix', text: '移出页眉页脚整页黑框；格式优化两轮；模板与文件夹上传优化' },
      { kind: 'refactor', text: '重构架构一轮，去冗余' },
    ],
  },
];
