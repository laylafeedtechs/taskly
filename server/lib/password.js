// Password hashing.
//
// Node: bcrypt (cost 12).
// Cloudflare Worker: PBKDF2-HMAC-SHA256 through WebCrypto. bcryptjs is pure
// JavaScript and a cost-12 hash takes ~250 ms of CPU, far above the Workers
// CPU budget; PBKDF2 runs natively. 100 000 iterations is the maximum the
// Workers runtime accepts.
//
// verifyPassword() accepts both formats, so accounts migrated from Node keep
// working; needsRehash() lets the login upgrade them to the current format.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { IS_WORKER } from './runtime.js';

const PBKDF2_ITERATIONS = 100000;
const enc = new TextEncoder();
const b64 = buf => Buffer.from(buf).toString('base64');

async function pbkdf2(password, salt, iterations) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  if (!IS_WORKER) return bcrypt.hash(password, 12);
  const salt = crypto.randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, algo, iter, salt, expected] = stored.split('$');
    if (algo !== 'sha256') return false;
    const hash = await pbkdf2(String(password), Buffer.from(salt, 'base64'), Number(iter));
    const exp = Buffer.from(expected, 'base64');
    return exp.length === hash.length && crypto.timingSafeEqual(exp, Buffer.from(hash));
  }
  return bcrypt.compare(String(password), stored);
}

export const needsRehash = stored => (IS_WORKER ? !String(stored).startsWith('pbkdf2$') : !String(stored).startsWith('$2'));

// Fixed hash used when the account does not exist, so the response time does
// not reveal whether an e-mail is registered.
export const DUMMY_HASH = IS_WORKER
  ? 'pbkdf2$sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8nKb5sEu5l3P6EYyUDS4NWFUe0PjC.';
