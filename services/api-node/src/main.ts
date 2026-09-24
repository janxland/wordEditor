import fs from 'node:fs';

import { resolveCacheDir, resolvePort, resolveRepoRoot } from './config.js';
import { startJobJanitor } from './jobs/workspace.js';
import { createServer } from './server.js';

const repoRoot = resolveRepoRoot();
const cacheDir = resolveCacheDir(repoRoot);
fs.mkdirSync(cacheDir, { recursive: true });
startJobJanitor(cacheDir);

const app = createServer({ repoRoot, cacheDir });
const port = resolvePort();

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`[api-node] http://localhost:${port}  repo=${repoRoot}`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
