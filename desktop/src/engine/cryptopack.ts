// 🔒 두뇌 팩 암호화 — 멘토(대장)가 지식을 비밀번호로 잠가 공개 레포에 게시.
//   구독자는 비번으로만 복호화. 서버 없이 구독자-전용 배포. 비번 회전 = 해지자 차단.
//   AES-256-GCM + scrypt(비번→키). 외부 의존성 0(Node crypto).
import * as crypto from 'crypto';

export function encryptPack(plain: string, password: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, kdf: 'scrypt', alg: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') });
}

export function decryptPack(blob: string, password: string): string {
  const o = JSON.parse(blob);
  const salt = Buffer.from(o.salt, 'base64'), iv = Buffer.from(o.iv, 'base64'), tag = Buffer.from(o.tag, 'base64'), data = Buffer.from(o.data, 'base64');
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
