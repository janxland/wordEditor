/**
 * 凭据加密 —— 与 AuthCenter 生态（ablaze-frontend core/crypto）同源：
 * AES-128-ECB / Pkcs7，key 固定，base64 输出做 URL-safe 替换。
 * 后端 shared/credential-crypto.ts 用同算法解密；传输层安全由 HTTPS 负责，
 * 此层仅避免凭据以可读明文出现在抓包/日志中。
 */
import CryptoJS from "crypto-js";

const KEY = CryptoJS.enc.Utf8.parse("aoligeimeimaobin");
const OPTIONS = { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 };

const toUrlSafe = (str: string): string =>
  str.replace(/\//g, "_").replace(/\+/g, "-");

export function encryptCredential(plain: string): string {
  return toUrlSafe(CryptoJS.AES.encrypt(plain, KEY, OPTIONS).toString());
}
