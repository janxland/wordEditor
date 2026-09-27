// deploy-releases.js - 把桌面端安装包 zip 直传腾讯云 COS 下载中心（wordeditor/downloads/）
//
// 参照 YesPlayMusic scripts/deploy-cdn.js 的做法：
//   - 凭据从 services/api-node/.env 读（COS_SECRET_ID/KEY/BUCKET/REGION，不进 git）；
//   - putObject 带 x-cos-acl: public-read，配合 cos.roginx.ink CDN 公网直读；
//   - 大文件走 sliceUploadFile 分片，单文件失败退避重试，挡 COS 偶发 socket hang up。
//
// 用法：node scripts/deploy-releases.js            # 上传 release/*.zip
//       node scripts/deploy-releases.js --check    # 只看要传什么，不动 COS

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const COS = require('cos-nodejs-sdk-v5');

const rootDir = path.resolve(__dirname, '..', '..', '..'); // wordEditor 仓库根
const releaseDir = path.resolve(__dirname, '..', 'release');

// 凭据唯一来源：services/api-node/.env（与工单附件上传同源，避免多处发密钥）
const envPath = path.join(rootDir, 'services', 'api-node', '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;
const PREFIX = (process.env.COS_DOWNLOADS_PREFIX || 'wordeditor/downloads').replace(/^\/|\/$/g, '');
const CDN_BASE = (process.env.COS_CDN_BASE || 'https://cos.roginx.ink').replace(/\/$/, '');

if (!BUCKET || !REGION) {
  console.error('❌ 缺少 COS_BUCKET/COS_REGION：请确认 services/api-node/.env 存在且含 COS_* 凭据');
  process.exit(1);
}

const zips = fs
  .readdirSync(releaseDir)
  .filter((f) => f.endsWith('.zip'))
  .map((f) => {
    const file = path.join(releaseDir, f);
    return { file, name: f, size: fs.statSync(file).size };
  });

if (!zips.length) {
  console.error('❌ release/ 下没有 zip，请先打包（npx electron-builder --mac --dir / --win --dir）');
  process.exit(1);
}

console.log('待上传：');
zips.forEach((z) => console.log(`  ${z.name}  ${(z.size / 1024 ** 2).toFixed(1)} MB`));
if (process.argv.includes('--check')) process.exit(0);

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 分片上传单文件（3 次退避重试） */
async function uploadOne(z) {
  const key = `${PREFIX}/${z.name}`;
  for (let attempt = 1; ; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        cos.sliceUploadFile(
          {
            Bucket: BUCKET,
            Region: REGION,
            Key: key,
            FilePath: z.file,
            Headers: { 'x-cos-acl': 'public-read' },
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      return key;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`重试第 ${attempt} 次: ${z.name}（${err.message || err}）`);
      await sleep(300 * attempt);
    }
  }
}

(async () => {
  let done = 0;
  const failures = [];
  for (const z of zips) {
    try {
      const key = await uploadOne(z);
      done++;
      console.log(`✅ [${done}/${zips.length}] ${z.name} → ${CDN_BASE}/${key}`);
    } catch (err) {
      failures.push(z.name);
      console.error(`❌ ${z.name}:`, err.message || err);
    }
  }
  if (failures.length) {
    console.error(`\n部署未完成，${failures.length} 个失败：${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\n部署完成！刷新下载中心即可见（COS 前缀 ${PREFIX}/）`);
})();
