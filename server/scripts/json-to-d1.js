// Converts the Node JSON database (data/taskly_db.json) into a SQL file for
// Cloudflare D1, keeping every record and each collection's order.
//   npm run d1:export                      → data/d1-import.sql
//   npm run d1:export -- --replace         → also clears the tables first
//   npx wrangler d1 execute taskly --remote --file data/d1-import.sql
// The output contains personal data and password hashes: it is written to
// data/ (gitignored) with owner-only permissions. Delete it after importing.
//
// Encrypted fields (MFA and webhook secrets) are copied as they are, so the
// Worker must use the SAME key: TASKLY_ENCRYPTION_KEY, or the key file this
// machine created at ~/.taskly/encryption.key (see docs/cloudflare.md).
import fs from 'fs';
import path from 'path';
import { DATA_DIR, prepareData } from '../db.js';
import { TABLES } from '../lib/d1store.js';

const replace = process.argv.includes('--replace');
const source = path.join(DATA_DIR, 'taskly_db.json');
const target = path.join(DATA_DIR, 'd1-import.sql');

if (!fs.existsSync(source)) {
  console.error(`Arquivo não encontrado: ${source}`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
prepareData(data); // bring older files to the current schema

const q = value => `'${String(value).replace(/'/g, "''")}'`;
const lines = ['-- Taskly: importação de data/taskly_db.json (gerado por server/scripts/json-to-d1.js)'];
const counts = {};

for (const [collection, table] of Object.entries(TABLES)) {
  if (replace) lines.push(`DELETE FROM ${table};`);
  const list = Array.isArray(data[collection]) ? data[collection] : [];
  counts[collection] = list.length;
  list.forEach((row, i) => {
    if (!row || typeof row.id !== 'string') throw new Error(`Registro sem id em ${collection} (posição ${i})`);
    lines.push(`INSERT INTO ${table} (id, pos, data) VALUES (${q(row.id)}, ${i}, ${q(JSON.stringify(row))});`);
  });
}
for (const key of ['meta', 'systemSettings']) {
  if (data[key] !== undefined) lines.push(`INSERT INTO app_state (key, value) VALUES ('${key}', ${q(JSON.stringify(data[key]))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
}
// Every running Worker isolate drops its cache on the next request.
lines.push("INSERT INTO app_state (key, value) VALUES ('version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1;");

fs.writeFileSync(target, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`SQL gerado em ${target}`);
console.log(Object.entries(counts).filter(([, n]) => n).map(([c, n]) => `  ${c}: ${n}`).join('\n'));

const uploads = path.join(DATA_DIR, 'uploads');
if (fs.existsSync(uploads)) {
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full); else files.push(path.relative(uploads, full).split(path.sep).join('/'));
  });
  walk(uploads);
  if (files.length) {
    console.log(`\n${files.length} arquivo(s) enviado(s) precisam ir para o R2 (bucket taskly-files):`);
    files.forEach(key => console.log(`  npx wrangler r2 object put "taskly-files/${key}" --file "data/uploads/${key}" --remote`));
  }
}
console.log('\nImporte com: npx wrangler d1 execute taskly --remote --file data/d1-import.sql');
console.log('Depois apague o arquivo gerado (contém dados pessoais).');
