// Time-limited, signed public URLs for creatives. The Instagram API fetches
// media by URL from Meta's servers ("media must be hosted on a publicly
// accessible server"), but the library is private: instead of exposing the
// storage, each publishing attempt gets URLs that expire after two hours and
// name exactly one file. Nothing else is reachable without a session.
import crypto from 'crypto';
import { deriveKey } from '../secrets.js';

const TTL_MS = 2 * 60 * 60 * 1000;
const b64 = buf => Buffer.from(buf).toString('base64url');

function signature(payload) {
  return crypto.createHmac('sha256', deriveKey('social-media-url')).update(payload).digest('base64url');
}

export function signedMediaUrl(creativeId, { now = Date.now(), ttlMs = TTL_MS } = {}) {
  const payload = b64(JSON.stringify({ c: creativeId, e: now + ttlMs }));
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/social/media/${payload}.${signature(payload)}`;
}

// Returns the creative id, or null when the token is malformed, forged or expired.
export function verifyMediaToken(token, { now = Date.now() } = {}) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || payload.length > 200) return null;
  const expected = signature(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.c !== 'string' || typeof data.e !== 'number' || data.e < now) return null;
    return data.c;
  } catch {
    return null;
  }
}
