import fs from 'node:fs';
import os from 'node:os';
import v8 from 'node:v8';

import { resolveCacheDir, resolvePort, resolveRepoRoot } from './config.js';
import { MAX_CONCURRENCY } from './jobs/gate.js';
import { startJobJanitor } from './jobs/workspace.js';
import { createServer } from './server.js';

const repoRoot = resolveRepoRoot();
const cacheDir = resolveCacheDir(repoRoot);
fs.mkdirSync(cacheDir, { recursive: true });
startJobJanitor(cacheDir);

const app = createServer({ repoRoot, cacheDir });
const port = resolvePort();
const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(0)}MB`;

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`http://localhost:${port}  repo=${repoRoot}`);
    // 部署时最先要确认的三件事：并发闸门、堆上限、机器总内存。
    app.log.info(
      `重任务并发 ${MAX_CONCURRENCY} · JS 堆上限 ${mb(
        v8.getHeapStatistics().heap_size_limit,
      )} · 物理内存 ${mb(os.totalmem())}`,
    );
  })
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });

// 优雅停机：先停止接新连接并等待在途请求（含 SSE 构建流），超时才硬退，避免卡死在一路长构建上。
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在关闭…`);
    const hardExit = setTimeout(() => process.exit(0), 30_000);
    hardExit.unref();
    app.close().then(
      () => process.exit(0),
      (e: unknown) => {
        app.log.error({ err: e }, '关闭异常');
        process.exit(1);
      },
    );
  });
}
