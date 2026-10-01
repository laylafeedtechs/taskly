// Encrypted backups of the database, stored outside the data directory.
// Every backup is immediately test-restored (decrypted + parsed) and the
// result is recorded, so a broken backup is noticed the day it is made.
// Restoring is only possible from the server console (npm run backup:restore).
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { db, DATA_DIR } from '../db.js';
import { encryptBuffer, decryptBuffer } from './secrets.js';
import { recordEvent } from './observability.js';
import { retentionSettings } from './retention.js';
import { IS_WORKER } from './runtime.js';

export const BACKUP_DIR = process.env.TASKLY_BACKUP_DIR
  ? path.resolve(process.env.TASKLY_BACKUP_DIR)
  : path.join(os.homedir(), 'taskly-backups');

const MAGIC = Buffer.from('TSKBK1');

function ensureDir() {
  if (path.resolve(BACKUP_DIR).startsWith(path.resolve(DATA_DIR))) throw new Error('O diretório de backup deve ficar fora do diretório de dados');
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
}

export function decryptBackupFile(file) {
  const blob = fs.readFileSync(file);
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Arquivo de backup inválido');
  return JSON.parse(decryptBuffer(blob.subarray(MAGIC.length)).toString('utf8'));
}

// On Cloudflare the database is D1, whose Time Travel keeps point-in-time
// restores for 30 days (wrangler d1 time-travel restore). File backups only
// apply to the Node deployment.
export const WORKER_BACKUP_NOTE = 'Banco no Cloudflare D1: backups contínuos pelo D1 Time Travel (restauração dos últimos 30 dias com "wrangler d1 time-travel restore").';

export function listBackups() {
  if (IS_WORKER) return [];
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter(f => /^taskly-\d{8}-\d{6}\.bak$/.test(f)).sort().reverse()
    .map(name => ({ name, size: fs.statSync(path.join(BACKUP_DIR, name)).size, createdAt: fs.statSync(path.join(BACKUP_DIR, name)).mtime.toISOString() }));
}

export function runBackup(reason = 'scheduled') {
  const started = Date.now();
  const status = { at: new Date().toISOString(), reason, ok: false, file: null, verified: false, error: null };
  if (IS_WORKER) return { ...status, ok: true, verified: true, managed: true, file: 'D1 Time Travel', error: null, note: WORKER_BACKUP_NOTE };
  try {
    ensureDir();
    const plain = Buffer.from(JSON.stringify(db.data), 'utf8');
    const digest = crypto.createHash('sha256').update(plain).digest('hex');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const file = path.join(BACKUP_DIR, `taskly-${stamp.slice(0, 8)}-${stamp.slice(8)}.bak`);
    fs.writeFileSync(file, Buffer.concat([MAGIC, encryptBuffer(plain)]), { mode: 0o600 });

    // Restore test: decrypt, parse and compare the checksum.
    const restored = decryptBackupFile(file);
    const check = crypto.createHash('sha256').update(JSON.stringify(restored)).digest('hex');
    Object.assign(status, { ok: true, file: path.basename(file), verified: check === digest, size: fs.statSync(file).size, ms: Date.now() - started });

    const keep = retentionSettings().backupsKeep || 14;
    listBackups().slice(keep).forEach(b => fs.unlinkSync(path.join(BACKUP_DIR, b.name)));
  } catch (err) {
    status.error = err.message;
    recordEvent('backup.failed', 'Falha ao gerar backup', { error: err.message }, 'error');
  }
  db.data.systemSettings.backupStatus = status;
  db.save();
  if (status.ok && !status.verified) recordEvent('backup.unverified', 'Backup gerado, mas a verificação de restauração falhou', {}, 'error');
  return status;
}
