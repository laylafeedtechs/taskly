// Cloudflare D1 persistence for the Database API (server/db.js).
//
// Every collection is a table (id, pos, data JSON). Each request:
//   1. loads the dataset — from an isolate-local cache when D1's `version`
//      counter is unchanged, otherwise from D1;
//   2. runs the existing synchronous route code against it, isolated from
//      concurrent requests by AsyncLocalStorage;
//   3. if anything changed, writes only the inserted / changed / deleted rows
//      plus the version bump in ONE `batch()`, which D1 executes as a
//      transaction — so a request's writes are all-or-nothing.
// Concurrency: requests in one isolate take turns (lock below), and every
// write batch is guarded by the version it was read at. If another isolate
// wrote in between, D1 rolls the whole batch back and the request answers
// 409 DB_CONFLICT — nothing is half-written and nothing is silently lost.
import { db, requestStore, initialData, prepareData } from '../db.js';
import { log } from './observability.js';

export const TABLES = {
  users: 'users',
  workspaces: 'workspaces',
  projects: 'projects',
  columns: 'task_columns',
  tasks: 'tasks',
  milestones: 'milestones',
  projectTemplates: 'project_templates',
  automations: 'automations',
  automationLogs: 'automation_logs',
  notifications: 'notifications',
  auditLogs: 'audit_logs',
  apiKeys: 'api_keys',
  webhooks: 'webhooks',
  webhookDeliveries: 'webhook_deliveries',
  featureFlags: 'feature_flags',
  savedReports: 'saved_reports',
  files: 'files',
  invitations: 'invitations',
  sessions: 'sessions',
  passwordResets: 'password_resets',
  activity: 'activity',
  systemEvents: 'system_events',
  securityIncidents: 'security_incidents',
  privacyRequests: 'privacy_requests',
  mfaChallenges: 'mfa_challenges',
  emailVerifications: 'email_verifications',
  oauthStates: 'oauth_states'
};
// Non-collection objects stored in app_state.
const STATE_KEYS = ['meta', 'systemSettings'];

let cache = null; // { version, rows: {collection: [{id,pos,data}]}, state: {key: json} }

export class ConflictError extends Error {
  constructor() {
    super('Os dados foram alterados por outra operação ao mesmo tempo. Tente novamente.');
    this.status = 409;
    this.expose = true;
    this.code = 'DB_CONFLICT';
  }
}

// Serialises load → handle → flush within this isolate, so concurrent
// requests build on each other's writes instead of on the same snapshot.
let tail = Promise.resolve();
const LOCK_TIMEOUT_MS = 30000;
function acquireLock() {
  let release;
  const held = new Promise(r => { release = r; });
  const turn = tail.then(() => {
    // Safety net: a request that never finishes must not block the isolate.
    const timer = setTimeout(release, LOCK_TIMEOUT_MS);
    let done = false;
    return () => { if (!done) { done = true; clearTimeout(timer); release(); } };
  });
  tail = turn.then(() => held);
  return turn;
}

async function readVersion(D1) {
  const row = await D1.prepare("SELECT value FROM app_state WHERE key = 'version'").first();
  return row ? Number(row.value) : 0;
}

async function loadFromD1(D1, version) {
  const names = Object.keys(TABLES);
  const results = await D1.batch([
    ...names.map(c => D1.prepare(`SELECT id, pos, data FROM ${TABLES[c]} ORDER BY pos`)),
    D1.prepare(`SELECT key, value FROM app_state WHERE key IN (${STATE_KEYS.map(() => '?').join(',')})`).bind(...STATE_KEYS)
  ]);
  const rows = {};
  names.forEach((c, i) => { rows[c] = results[i].results; });
  const state = Object.fromEntries(results[names.length].results.map(r => [r.key, r.value]));
  return { version, rows, state };
}

// Builds a fresh, request-private copy of the dataset plus the row index
// used later to compute what changed.
function materialize(snapshot) {
  const data = {};
  const index = {};
  for (const [c, list] of Object.entries(snapshot.rows)) {
    data[c] = list.map(r => JSON.parse(r.data));
    index[c] = new Map(list.map(r => [r.id, { json: r.data, pos: r.pos }]));
  }
  for (const k of STATE_KEYS) if (snapshot.state[k]) data[k] = JSON.parse(snapshot.state[k]);
  return { data, index, state: { ...snapshot.state } };
}

export async function openStore(D1) {
  const version = await readVersion(D1);
  if (!cache || cache.version !== version) cache = await loadFromD1(D1, version);
  const { data, index, state } = materialize(cache);
  const store = { data, index, state, version, dirty: false };
  // An empty database (first deploy) gets the initial production dataset;
  // older datasets are migrated to the current schema.
  if (!data.meta) {
    const fresh = initialData();
    Object.keys(fresh).forEach(k => { data[k] = fresh[k]; });
  }
  if (requestStore.run(store, () => prepareData(store.data))) store.dirty = true;
  return store;
}

// Positions keep each collection's array order (several features rely on
// insertion order) without rewriting untouched rows.
function positionsFor(list, index) {
  const pos = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const known = index.get(list[i].id);
    if (known) { pos[i] = known.pos; continue; }
    const prev = i > 0 ? pos[i - 1] : null;
    let next = null;
    for (let j = i + 1; j < list.length; j++) { const k = index.get(list[j].id); if (k) { next = k.pos; break; } }
    pos[i] = prev === null ? (next === null ? i : next - 1) : next === null || next <= prev ? prev + 1 : (prev + next) / 2;
  }
  return pos;
}

function diffStatements(D1, store) {
  const stmts = [];
  for (const [collection, table] of Object.entries(TABLES)) {
    const list = Array.isArray(store.data[collection]) ? store.data[collection] : [];
    const index = store.index[collection] || new Map();
    const pos = positionsFor(list, index);
    const seen = new Set();
    list.forEach((row, i) => {
      if (!row || typeof row.id !== 'string') throw new Error(`Registro sem id na coleção ${collection}`);
      seen.add(row.id);
      const json = JSON.stringify(row);
      const known = index.get(row.id);
      if (known && known.json === json) return;
      stmts.push(D1.prepare(`INSERT INTO ${table} (id, pos, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET pos = excluded.pos, data = excluded.data`).bind(row.id, pos[i], json));
    });
    for (const id of index.keys()) if (!seen.has(id)) stmts.push(D1.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id));
  }
  for (const key of STATE_KEYS) {
    if (store.data[key] === undefined) continue;
    const json = JSON.stringify(store.data[key]);
    if (store.state[key] !== json) stmts.push(D1.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, json));
  }
  return stmts;
}

export async function flushStore(D1, store) {
  if (!store.dirty) return;
  const stmts = diffStatements(D1, store);
  if (!stmts.length) return;
  // Optimistic concurrency guard, first in the transaction: when the stored
  // version is no longer the one this request read, it inserts a duplicate
  // primary key, which aborts and rolls back the entire batch.
  stmts.unshift(D1.prepare("INSERT INTO app_state (key, value) SELECT 'version', 'conflict' WHERE CAST((SELECT value FROM app_state WHERE key = 'version') AS INTEGER) <> ?").bind(store.version));
  stmts.push(D1.prepare("INSERT INTO app_state (key, value) VALUES ('version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"));
  try {
    await D1.batch(stmts);
  } catch (err) {
    cache = null;
    if (/UNIQUE constraint failed: app_state.key/i.test(err.message)) throw new ConflictError();
    throw err;
  }
  cache = snapshotOf(store, store.version + 1);
}

function snapshotOf(store, version) {
  const rows = {};
  for (const collection of Object.keys(TABLES)) {
    const list = Array.isArray(store.data[collection]) ? store.data[collection] : [];
    const pos = positionsFor(list, store.index[collection] || new Map());
    rows[collection] = list.map((r, i) => ({ id: r.id, pos: pos[i], data: JSON.stringify(r) }));
  }
  const state = Object.fromEntries(STATE_KEYS.filter(k => store.data[k] !== undefined).map(k => [k, JSON.stringify(store.data[k])]));
  return { version, rows, state };
}

// Express middleware: runs the rest of the request inside a D1-backed store
// and persists changes *before* the response is released, so a 200 always
// means the data is stored.
export function d1Middleware(getD1) {
  return async (req, res, next) => {
    const D1 = getD1();
    if (!D1) return next(Object.assign(new Error('Banco de dados (D1) não configurado'), { status: 503, expose: true, code: 'DB_NOT_CONFIGURED' }));
    const release = await acquireLock();
    res.once('close', release);
    let store;
    try {
      store = await openStore(D1);
    } catch (err) {
      release();
      log('error', 'D1 load failed', { error: err.message });
      return next(Object.assign(new Error('Banco de dados indisponível. Verifique se as migrations do D1 foram aplicadas.'), { status: 503, expose: true, code: 'DB_UNAVAILABLE' }));
    }
    const end = res.end.bind(res);
    let finishing = false;
    res.end = (...args) => {
      if (finishing) return end(...args);
      finishing = true;
      flushStore(D1, store).then(() => { release(); end(...args); }).catch(err => {
        release();
        const conflict = err instanceof ConflictError;
        if (conflict) log('warn', 'D1 write conflict, request rolled back', { path: req.path });
        else log('error', 'D1 write failed', { error: err.message, path: req.path });
        const body = JSON.stringify(conflict
          ? { error: err.message, code: err.code }
          : { error: 'Não foi possível salvar as alterações. Tente novamente.', code: 'DB_WRITE_FAILED' });
        if (!res.headersSent) {
          res.statusCode = conflict ? 409 : 500;
          res.removeHeader('Content-Length');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.removeHeader('Set-Cookie'); // a session that was not stored must not be handed out
        }
        end(body);
      });
      return res;
    };
    requestStore.run(store, next);
  };
}

// Runs background work (Cron Trigger, post-response bookkeeping) against D1
// as one transaction. fn must be short: it holds the isolate lock. On a
// version conflict it is re-run on fresh data.
export async function withD1Store(D1, fn, { attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const release = await acquireLock();
    try {
      const store = await openStore(D1);
      const result = await requestStore.run(store, fn);
      await flushStore(D1, store);
      return result;
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= attempts) throw err;
    } finally {
      release();
    }
  }
}

export { db };
