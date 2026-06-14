import fs from 'node:fs';

import { cacheDir, resolvePort, resolveRepoRoot } from './config/env.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const cDir = cacheDir(repoRoot);
  fs.mkdirSync(cDir, { recursive: true });

  const app = createApp(repoRoot, cDir);
  const port = resolvePort();

  await app.listen({ port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`[api-node] listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[api-node] repo root: ${repoRoot}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
