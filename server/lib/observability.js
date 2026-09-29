// Structured logging, audit trail and system-event recording.
// Sensitive fields are redacted before anything is written.
import { hashAuditEntry } from './auditHash.js';
import { db, newId } from '../db.js';

const SENSITIVE_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|hash|code_verifier/i;

export function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

export function log(level, message, context = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...redact(context) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (process.env.LOG_LEVEL !== 'silent') console.log(line);
}

const MAX_EVENTS = 5000;

// System events power the Admin Center "System Activity" view.
export function recordEvent(type, message, context = {}, severity = 'info') {
  const events = db.get('systemEvents');
  events.push({ id: newId('evt'), type, severity, message: String(message).slice(0, 500), context: redact(context), createdAt: new Date().toISOString() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  db.save();
  log(severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'info', message, { type, ...context });
}

const MAX_AUDIT = 20000;

export function audit(req, { action, entity, result = 'SUCCESS', workspaceId = null, category = 'general', details = undefined }) {
  const user = req?.user;
  // The actor is identified by id + display name; e-mail is resolvable from the id when needed.
  const actor = user
    ? `${user.name}${req.session?.impersonatorId ? ' (via impersonação)' : ''}`
    : (req?.auditActor || 'Anônimo');
  const logs = db.get('auditLogs');
  const entry = {
    id: newId('aud'),
    actorId: user?.id || null,
    impersonatorId: req?.session?.impersonatorId || null,
    sessionId: req?.session?.id || null,
    requestId: req?.id || null,
    actor,
    action,
    category,
    entity,
    workspaceId,
    result,
    details: details ? redact(details) : undefined,
    ip: req?.ip || null,
    device: String(req?.headers?.['user-agent'] || '').slice(0, 200),
    timestamp: new Date().toISOString()
  };
  chainAudit(entry);
  logs.push(entry);
  if (logs.length > MAX_AUDIT) trimAudit(logs.length - MAX_AUDIT);
  db.save();
  auditListeners.forEach(fn => { try { fn(entry, req); } catch (err) { log('error', 'audit listener failed', { error: err.message }); } });
}

// ------------------------------------------------ tamper-evident audit chain
// Each entry stores the hash of the previous one, so editing or deleting a
// record in the middle of the log is detectable by verifyAuditChain().

const auditListeners = [];
export const onAudit = fn => auditListeners.push(fn);

const hashEntry = hashAuditEntry;

export function chainAudit(entry) {
  db.data.meta = db.data.meta || {};
  const prevHash = db.data.meta.auditChainHead || db.data.meta.auditChainAnchor || 'genesis';
  entry.prevHash = prevHash;
  entry.hash = hashEntry(entry, prevHash);
  db.data.meta.auditChainHead = entry.hash;
}

// Retention removes the oldest entries; the anchor keeps the chain verifiable.
export function trimAudit(count) {
  const logs = db.get('auditLogs');
  const removed = logs.splice(0, count);
  if (removed.length) db.data.meta.auditChainAnchor = removed[removed.length - 1].hash;
}

export function verifyAuditChain() {
  const logs = db.get('auditLogs');
  let prev = db.data.meta?.auditChainAnchor || 'genesis';
  for (let i = 0; i < logs.length; i++) {
    const e = logs[i];
    if (e.prevHash !== prev || e.hash !== hashEntry(e, prev)) return { ok: false, checked: i, brokenAt: e.id, timestamp: e.timestamp };
    prev = e.hash;
  }
  return { ok: prev === (db.data.meta?.auditChainHead || prev), checked: logs.length };
}
