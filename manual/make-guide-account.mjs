// 注册下单指引专用测试账号（与前端 credentialCrypto 同一套 AES-128-ECB 加密）
import { createRequire } from 'node:module';
const require = createRequire(
  '/Users/Admin1/Desktop/project/janxland/wordEditor/apps/wordEditor-frontend/node_modules/',
);
const CryptoJS = require('crypto-js');
const KEY = CryptoJS.enc.Utf8.parse('aoligeimeimaobin');
const OPTS = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };
const enc = (s) =>
  CryptoJS.AES.encrypt(s, KEY, OPTS).toString().replace(/\//g, '_').replace(/\+/g, '-');
const B = 'http://127.0.0.1:8787';
const USER = 'we-guide';
const encPass = enc('Guide@2026');

const post = (path, body) =>
  fetch(B + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const reg = await post('/api/auth/register', { username: USER, password: encPass });
console.log('register:', JSON.stringify(reg).slice(0, 120));
const login = await post('/api/auth/login', { username: USER, password: encPass });
console.log('login ok:', Boolean(JSON.stringify(login).includes('accessToken')));
