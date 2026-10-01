// Local file storage with content validation. Files are stored under random
// names outside any web root and are only served through authorized routes.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../db.js';
import { badRequest, HttpError } from './http.js';
import { IS_WORKER, bindings, background } from './runtime.js';

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// extension -> { mime, check(buffer) }
const SIGNATURES = {
  png: { mime: 'image/png', check: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', check: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', check: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mime: 'image/gif', check: b => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  webp: { mime: 'image/webp', check: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  pdf: { mime: 'application/pdf', check: b => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  zip: { mime: 'application/zip', check: isZip },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: isZip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: isZip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: isZip },
  txt: { mime: 'text/plain; charset=utf-8', check: isText },
  md: { mime: 'text/markdown; charset=utf-8', check: isText },
  csv: { mime: 'text/csv; charset=utf-8', check: isText },
  json: { mime: 'application/json', check: b => isText(b) && isJson(b) }
};

function isZip(b) { return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) }
function isText(b) {
  const sample = b.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.max(sample.length - 4, 0))); return true; } catch { return false; }
}
function isJson(b) { try { JSON.parse(b.toString('utf8')); return true; } catch { return false; } }

export const PREVIEWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain; charset=utf-8', 'text/markdown; charset=utf-8', 'text/csv; charset=utf-8', 'application/json'];

export function extensionOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function sanitizeFileName(name) {
  const base = path.basename(String(name)).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  if (!base || base === '.' || base === '..') throw badRequest('Nome de arquivo inválido');
  return base.slice(0, 180);
}

// Accepts base64 (optionally a data: URL) and validates extension, size and content.
export function decodeUpload({ name, data }, { allowed, maxBytes }) {
  const fileName = sanitizeFileName(name || '');
  const ext = extensionOf(fileName);
  if (!allowed.includes(ext) || !SIGNATURES[ext]) throw badRequest(`Tipo de arquivo .${ext || '?'} não permitido`);
  if (typeof data !== 'string' || data.length === 0) throw badRequest('Conteúdo do arquivo ausente');
  const b64 = data.includes(',') && data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw badRequest('Conteúdo do arquivo inválido');
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw badRequest('Arquivo vazio');
  if (buffer.length > maxBytes) throw badRequest(`O arquivo excede o limite de ${Math.round(maxBytes / 1048576)} MB`);
  if (!SIGNATURES[ext].check(buffer)) throw badRequest('O conteúdo do arquivo não corresponde à extensão informada');
  return { fileName, ext, mime: SIGNATURES[ext].mime, buffer };
}

const KEY_RE = /^[a-z]+\/[a-f0-9]{32}\.[a-z0-9]+$/;
const validKey = key => typeof key === 'string' && KEY_RE.test(key);

function bucket() {
  const r2 = bindings()?.FILES;
  if (!r2) throw new HttpError(503, 'O armazenamento de arquivos (R2) não está configurado neste ambiente.', 'STORAGE_NOT_CONFIGURED');
  return r2;
}

export async function storeBuffer(folder, buffer, ext, contentType = 'application/octet-stream') {
  const key = `${folder}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (IS_WORKER) {
    await bucket().put(key, buffer, { httpMetadata: { contentType } });
    return key;
  }
  fs.mkdirSync(path.join(UPLOAD_DIR, folder), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, key), buffer);
  return key;
}

// Returns the stored bytes, or null when the object does not exist.
export async function readStored(key) {
  if (!validKey(key)) return null;
  if (IS_WORKER) {
    const obj = await bucket().get(key);
    return obj ? Buffer.from(await obj.arrayBuffer()) : null;
  }
  const full = path.join(UPLOAD_DIR, key);
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

export function deleteStored(key) {
  if (!validKey(key)) return;
  if (IS_WORKER) {
    const r2 = bindings()?.FILES;
    if (r2) background(r2.delete(key));
    return;
  }
  const full = path.join(UPLOAD_DIR, key);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

export function formatSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
