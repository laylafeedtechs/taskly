// Restores an encrypted backup. Run with the server STOPPED:
//   npm run backup:restore -- taskly-20260929-120000.bak
// The current database is kept as data/taskly_db.pre-restore-<timestamp>.json.
import fs from 'fs';
import path from 'path';

const { BACKUP_DIR, decryptBackupFile, listBackups } = await import('../lib/backup.js');
const { DATA_DIR } = await import('../db.js');

const name = process.argv[2];
if (!name) {
  console.log(`Backups em ${BACKUP_DIR}:`);
  listBackups().forEach(b => console.log(`  ${b.name}  ${(b.size / 1024).toFixed(0)} KB  ${b.createdAt}`));
  console.log('\nUso: npm run backup:restore -- <arquivo>');
  process.exit(0);
}
const file = path.join(BACKUP_DIR, path.basename(name));
const data = decryptBackupFile(file);
const target = path.join(DATA_DIR, 'taskly_db.json');
if (fs.existsSync(target)) fs.copyFileSync(target, path.join(DATA_DIR, `taskly_db.pre-restore-${Date.now()}.json`));
fs.writeFileSync(target, JSON.stringify(data, null, 2));
console.log(`Backup ${path.basename(file)} restaurado em ${target}. Inicie o servidor novamente.`);
