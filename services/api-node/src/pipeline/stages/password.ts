/**
 * 「修改密码」：对应 apply_password.py。
 *
 * 只写 writeProtection（修改保护），不对内容加密：未输入密码者以只读方式打开。
 * 口令哈希按 ECMA-376 §17.15.1.120，cryptAlgorithmSid=14（SHA-512）+ 10 万次迭代。
 */
import crypto from 'node:crypto';

import { parseXml, serializeEl } from '../ooxml/xml.js';
import { patchDocxParts } from '../ooxml/zip.js';
import type { StageContext } from './context.js';

const SETTINGS_PART = 'word/settings.xml';
const SPIN_COUNT = 100_000;
const CRYPT_SID = 14;

/** 与 Python `_hash_password` 逐字节一致：盐 + utf-16le 口令，SHA-512 迭代 SPIN_COUNT 次。 */
export function hashPassword(password: string, salt: Buffer): Buffer {
  const pw = Buffer.from(password, 'utf16le');
  let h = crypto.createHash('sha512').update(Buffer.concat([salt, pw])).digest();
  const counter = Buffer.alloc(4);
  for (let i = 0; i < SPIN_COUNT; i += 1) {
    counter.writeInt32LE(i, 0);
    h = crypto.createHash('sha512').update(h).update(counter).digest();
  }
  return h;
}

export async function applyPassword(docxPath: string, password: string | null): Promise<void> {
  await patchDocxParts(docxPath, {
    [SETTINGS_PART]: (source) => {
      if (source === null) return null;
      const doc = parseXml(source);
      const root = doc.documentElement;
      for (const old of Array.from(root.getElementsByTagName('w:writeProtection'))) {
        root.removeChild(old);
      }
      if (!password) return serializeEl(root);

      const salt = crypto.randomBytes(16);
      const wp = doc.createElement('w:writeProtection');
      wp.setAttribute('w:cryptProviderType', 'rsaAES');
      wp.setAttribute('w:cryptAlgorithmClass', 'hash');
      wp.setAttribute('w:cryptAlgorithmType', 'typeAny');
      wp.setAttribute('w:cryptAlgorithmSid', String(CRYPT_SID));
      wp.setAttribute('w:cryptSpinCount', String(SPIN_COUNT));
      wp.setAttribute('w:hash', hashPassword(password, salt).toString('base64'));
      wp.setAttribute('w:salt', salt.toString('base64'));
      root.insertBefore(wp, root.firstChild);
      return serializeEl(root);
    },
  });
}

export async function applyPasswordStage(ctx: StageContext): Promise<void> {
  const password = ctx.options.password;
  if (!password) return;
  ctx.log('[后处理] 设置修改密码 …');
  await applyPassword(ctx.docxPath, password);
  ctx.log('[apply_password] 已设置修改密码');
}
