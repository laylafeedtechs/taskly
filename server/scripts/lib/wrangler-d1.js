// Minimal D1 binding for console scripts running on Node: statements are sent
// through `wrangler d1 execute`, so the scripts reuse the application's own
// code (server/lib/d1store.js) instead of hand-written SQL.
//   --local  → the database used by `wrangler dev`
//   --remote → the production database on Cloudflare
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const WRANGLER = path.join(path.dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Inlines bound parameters; `?` never appears inside the SQL the app prepares
// other than as a placeholder.
function inline(sql, params) {
  let i = 0;
  return sql.replace(/\?/g, () => literal(params[i++]));
}

export function wranglerD1(database, target) {
  if (!['--local', '--remote'].includes(target)) throw new Error('Informe --local ou --remote');
  // Runs wrangler's own entry point with this Node binary (no shell, so no
  // quoting issues with SQL on any platform).
  const run = args => execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', database, target, '--json', '-y', ...args], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, stdio: ['ignore', 'pipe', 'pipe']
  });

  const query = statements => {
    // Read-only queries go in one call; results come back in order.
    const out = run(['--command', statements.map(s => inline(s.sql, s.params)).join(';\n')]);
    return JSON.parse(out).map(r => ({ results: r.results || [] }));
  };

  const write = statements => {
    // Writes go through a file (no command-line length limit). The version
    // guard is the first statement, so a conflict stops before any change.
    const file = path.join(os.tmpdir(), `taskly-d1-${crypto.randomBytes(6).toString('hex')}.sql`);
    fs.writeFileSync(file, statements.map(s => `${inline(s.sql, s.params)};`).join('\n'), { mode: 0o600 });
    try {
      run(['--file', file]);
    } catch (err) {
      const message = `${err.stdout || ''}${err.stderr || ''}` || err.message;
      throw new Error(/UNIQUE constraint failed: app_state\.key/i.test(message) ? 'UNIQUE constraint failed: app_state.key' : message.slice(0, 2000));
    } finally {
      fs.rmSync(file, { force: true });
    }
    return statements.map(() => ({ results: [] }));
  };

  const isRead = s => /^\s*SELECT/i.test(s.sql);
  const prepare = sql => {
    const stmt = {
      sql, params: [],
      bind(...params) { return { ...stmt, params }; },
      async first() { return query([this])[0].results[0] || null; },
      async all() { return query([this])[0]; }
    };
    return stmt;
  };
  return {
    prepare,
    async batch(statements) {
      return statements.every(isRead) ? query(statements) : write(statements);
    }
  };
}

export function targetFromArgs(argv) {
  if (argv.includes('--remote')) return '--remote';
  if (argv.includes('--local')) return '--local';
  return null;
}
