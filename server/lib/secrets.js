// Encryption of sensitive values at rest (MFA secrets, webhook secrets,
// backups) using AES-256-GCM from Node's crypto module. No custom crypto.
//
// Key source, in order:
//   1. TASKLY_ENCRYPTION_KEY (base64, 32 bytes) — preferred in production,
//      injected by the hosting provider's secret manager.
//   2. A key file in TASKLY_KEY_DIR (default ~/.taskly), created on first
//      run with owner-only permissions. It lives outside the data and backup
//      directories so a copy of the database alone cannot be decrypted.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IS_WORKER } from './runtime.js';

const PREFIX = 'enc:v1:';
let key = null;

function loadKey() {
  if (key) return key;
  if (process.env.TASKLY_ENCRYPTION_KEY) {
    key = Buffer.from(process.env.TASKLY_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('TASKLY_ENCRYPTION_KEY must be 32 bytes encoded in base64');
    return key;
  }
  // A Worker has no persistent disk: the key must come from a Cloudflare secret.
  if (IS_WORKER) {
    const err = new Error('TASKLY_ENCRYPTION_KEY não configurada (wrangler secret put TASKLY_ENCRYPTION_KEY)');
    err.status = 503; err.expose = true; err.code = 'ENCRYPTION_KEY_MISSING';
    throw err;
  }
  const dir = process.env.TASKLY_KEY_DIR ? path.resolve(process.env.TASKLY_KEY_DIR) : path.join(os.homedir(), '.taskly');
  const file = path.join(dir, 'encryption.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  return key;
}

export function encryptBuffer(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptBuffer(blob) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export const isSealed = value => typeof value === 'string' && value.startsWith(PREFIX);

export function seal(text) {
  if (text === null || text === undefined || isSealed(text)) return text;
  return PREFIX + encryptBuffer(Buffer.from(String(text), 'utf8')).toString('base64');
}

export function unseal(value) {
  if (!isSealed(value)) return value;
  return decryptBuffer(Buffer.from(value.slice(PREFIX.length), 'base64')).toString('utf8');
}

// Purpose-bound subkeys (e.g. signing public media URLs), so the encryption
// key itself is never used for anything but encryption.
export function deriveKey(purpose) {
  return crypto.createHmac('sha256', loadKey()).update(`taskly:${purpose}`).digest();
}
