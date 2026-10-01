// Domain events: every important change flows through emit(), which records
// activity, runs matching automations and delivers webhooks.
import crypto from 'crypto';
import dns from 'dns/promises';
import dnsCallback from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import { unseal } from './secrets.js';
import { IS_WORKER, background, detached } from './runtime.js';
import { db, newId } from '../db.js';
import { sendMail } from './mailer.js';
import { recordEvent } from './observability.js';

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

// ------------------------------------------------------------------ activity

export function recordActivity({ workspaceId, projectId = null, taskId = null, actor, type, message, meta = undefined }) {
  const entry = {
    id: newId('act'),
    workspaceId,
    projectId,
    taskId,
    actorId: actor?.id || null,
    actor: actor?.name || 'Sistema',
    type,
    message,
    meta,
    createdAt: new Date().toISOString()
  };
  db.get('activity').push(entry);
  db.save();
  return entry;
}

// ------------------------------------------------------------- notifications

const CATEGORY_FOR_EVENT = {
  assignment: 'Assignments',
  mention: 'Mentions',
  comment: 'Comments',
  deadline: 'Deadlines',
  automation: 'System',
  invitation: 'System',
  security: 'System'
};

export function notify(userId, { event, title, description, taskId = null, projectId = null, workspaceId = null, actor = null, dedupeKey = null }) {
  const user = db.find('users', u => u.id === userId);
  if (!user || user.status === 'BLOCKED') return null;
  if (actor && actor.id === userId && event !== 'security') return null;

  const prefs = user.notificationPreferences || {};
  const eventPrefs = prefs.events?.[event] || { inApp: true, email: false };
  // Security notifications cannot be disabled.
  const inApp = event === 'security' || (prefs.inApp !== false && eventPrefs.inApp !== false);
  const email = event === 'security' || (prefs.email !== false && eventPrefs.email === true);

  if (dedupeKey && db.find('notifications', n => n.userId === userId && n.dedupeKey === dedupeKey)) return null;

  let notification = null;
  if (inApp) {
    notification = {
      id: newId('notif'),
      userId,
      event,
      category: CATEGORY_FOR_EVENT[event] || 'System',
      title,
      description,
      taskId,
      projectId,
      workspaceId,
      actorName: actor?.name || null,
      avatar: actor?.avatar || null,
      unread: true,
      archived: false,
      dedupeKey,
      createdAt: new Date().toISOString()
    };
    db.insert('notifications', notification);
  }
  if (email) {
    // Kept alive after the response on Workers (waitUntil).
    background(sendMail({
      to: user.email,
      subject: `Taskly — ${title}`,
      text: description,
      actionUrl: taskId ? `${APP_URL()}/?task=${encodeURIComponent(taskId)}` : APP_URL(),
      actionLabel: taskId ? 'Abrir tarefa' : 'Abrir Taskly'
    }));
  }
  return notification;
}

export function extractMentions(text, workspace) {
  const ids = new Set();
  const lower = text.toLowerCase();
  workspace.members.forEach(m => {
    const u = db.find('users', x => x.id === m.userId);
    if (!u) return;
    const first = u.name.split(' ')[0].toLowerCase();
    const handle = u.email.split('@')[0].toLowerCase();
    if (lower.includes(`@${u.name.toLowerCase()}`) || lower.includes(`@${handle}`) || new RegExp(`@${first}\\b`).test(lower)) ids.add(u.id);
  });
  return [...ids];
}

// --------------------------------------------------------------- automations

export const AUTOMATION_TRIGGERS = {
  'task.created': 'Tarefa criada',
  'task.status_changed': 'Tarefa movida para status',
  'task.priority_changed': 'Prioridade alterada para',
  'task.assigned': 'Tarefa atribuída',
  'task.completed': 'Tarefa concluída',
  'task.commented': 'Comentário adicionado'
};
export const AUTOMATION_FIELDS = ['priority', 'type', 'status', 'tag', 'assigneeId', 'projectId'];
export const AUTOMATION_OPS = ['eq', 'neq', 'contains'];
export const AUTOMATION_ACTIONS = {
  notify: 'Notificar',
  set_priority: 'Alterar prioridade',
  set_status: 'Mover para status',
  add_tag: 'Adicionar tag',
  assign: 'Atribuir a'
};

function conditionMatches(cond, task) {
  const actual = cond.field === 'tag' ? (task.tags || []) : task[cond.field];
  if (cond.op === 'contains') return Array.isArray(actual) ? actual.includes(cond.value) : String(actual || '').includes(cond.value);
  const eq = Array.isArray(actual) ? actual.includes(cond.value) : actual === cond.value;
  return cond.op === 'neq' ? !eq : eq;
}

function triggerMatches(trigger, event) {
  if (trigger.type !== event.type) return false;
  if (!trigger.value) return true;
  if (event.type === 'task.status_changed') return event.task.status === trigger.value;
  if (event.type === 'task.priority_changed') return event.task.priority === trigger.value;
  if (event.type === 'task.assigned') return event.task.assigneeId === trigger.value;
  return true;
}

function projectManagers(workspace) {
  return workspace.members.filter(m => ['Owner', 'Manager'].includes(m.role)).map(m => m.userId);
}

function runAction(action, task, workspace, automation) {
  const target = db.find('tasks', t => t.id === task.id);
  switch (action.type) {
    case 'notify': {
      const recipients = action.target === 'assignee' ? [task.assigneeId]
        : action.target === 'project_managers' ? projectManagers(workspace)
          : [action.target];
      const valid = recipients.filter(id => id && workspace.members.some(m => m.userId === id));
      valid.forEach(uid => notify(uid, {
        event: 'automation',
        title: `Automação: ${automation.title}`,
        description: `${task.id} — ${task.title}`,
        taskId: task.id, projectId: task.projectId, workspaceId: workspace.id
      }));
      return `Notificação enviada para ${valid.length} usuário(s)`;
    }
    case 'set_priority':
      if (!target) throw new Error('Tarefa não encontrada');
      target.priority = action.value;
      return `Prioridade alterada para ${action.value}`;
    case 'set_status': {
      if (!target) throw new Error('Tarefa não encontrada');
      const valid = db.filter('columns', c => c.projectId === target.projectId).some(c => c.statusKey === action.value);
      if (!valid) throw new Error(`Status "${action.value}" não existe no projeto`);
      target.status = action.value;
      return `Tarefa movida para ${action.value}`;
    }
    case 'add_tag':
      if (!target) throw new Error('Tarefa não encontrada');
      target.tags = [...new Set([...(target.tags || []), action.value])];
      return `Tag "${action.value}" adicionada`;
    case 'assign':
      if (!target) throw new Error('Tarefa não encontrada');
      if (!workspace.members.some(m => m.userId === action.value)) throw new Error('Usuário não é membro do workspace');
      target.assigneeId = action.value;
      return 'Responsável alterado';
    default:
      throw new Error(`Ação desconhecida: ${action.type}`);
  }
}

export function describeAutomation(def) {
  const trig = `${AUTOMATION_TRIGGERS[def.trigger.type] || def.trigger.type}${def.trigger.value ? ` "${def.trigger.value}"` : ''}`;
  const conds = def.conditions.length ? def.conditions.map(c => `${c.field} ${c.op === 'eq' ? '=' : c.op === 'neq' ? '≠' : 'contém'} ${c.value}`).join(' E ') : 'sempre';
  const acts = def.actions.map(a => `${AUTOMATION_ACTIONS[a.type] || a.type}${a.value ? ` ${a.value}` : a.target ? ` ${a.target}` : ''}`).join(', ');
  return { trigger: trig, condition: conds, action: acts };
}

// Automation actions may change the task, which would emit new events.
// Depth is capped to prevent infinite loops between rules.
function runAutomations(event, depth) {
  if (depth > 2 || !event.task) return;
  const workspace = db.find('workspaces', w => w.id === event.workspaceId);
  if (!workspace) return;
  const rules = db.filter('automations', a => a.workspaceId === event.workspaceId && a.enabled && (!a.projectId || a.projectId === event.task.projectId));

  rules.forEach(rule => {
    const def = rule.definition;
    if (!def || !triggerMatches(def.trigger, event)) return;
    const conditionsOk = def.conditions.every(c => conditionMatches(c, event.task));
    const desc = describeAutomation(def);
    const log = {
      id: newId('autlog'),
      workspaceId: workspace.id,
      automationId: rule.id,
      automationTitle: rule.title,
      taskId: event.task.id,
      trigger: desc.trigger,
      condition: desc.condition,
      action: desc.action,
      timestamp: new Date().toISOString()
    };
    if (!conditionsOk) return; // Only executions are logged; non-matching rules are skipped.

    const before = JSON.stringify(db.find('tasks', t => t.id === event.task.id));
    const results = [];
    try {
      def.actions.forEach(a => results.push(runAction(a, event.task, workspace, rule)));
      Object.assign(log, { status: 'SUCCESS', result: results.join('; '), error: null });
    } catch (err) {
      Object.assign(log, { status: 'FAILURE', result: results.join('; ') || null, error: err.message });
      recordEvent('automation.failed', `Automação "${rule.title}" falhou`, { automationId: rule.id, error: err.message }, 'warn');
    }
    rule.executionsCount = (rule.executionsCount || 0) + 1;
    rule.lastTriggeredAt = log.timestamp;
    db.get('automationLogs').unshift(log);
    db.save();

    const after = db.find('tasks', t => t.id === event.task.id);
    if (after && JSON.stringify(after) !== before) {
      recordActivity({ workspaceId: workspace.id, projectId: after.projectId, taskId: after.id, actor: { name: `Automação: ${rule.title}` }, type: 'automation.executed', message: log.result });
      const prev = JSON.parse(before);
      if (prev.status !== after.status) emit({ type: 'task.status_changed', workspaceId: workspace.id, task: after }, depth + 1);
      if (prev.priority !== after.priority) emit({ type: 'task.priority_changed', workspaceId: workspace.id, task: after }, depth + 1);
    }
  });
}

// ------------------------------------------------------------------ webhooks

export const WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.completed', 'task.deleted', 'project.created', 'project.updated', 'member.added', 'member.removed', 'comment.created'];

// IPv4-mapped IPv6 (::ffff:a.b.c.d or its hex form ::ffff:7f00:1) → IPv4.
function unmapIPv4(ip) {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip;
}

function isPrivateAddress(ip) {
  ip = unmapIPv4(ip);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  const lower = ip.toLowerCase();
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || lower.startsWith('fe80') || lower.startsWith('ff');
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === 'true';

// Guards against SSRF: webhooks may only target public http(s) endpoints,
// unless ALLOW_PRIVATE_WEBHOOKS=true (local development only).
export async function assertSafeWebhookUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('URL inválida'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Apenas URLs http(s) são permitidas');
  if (url.username || url.password) throw new Error('A URL não pode conter credenciais');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Em produção, webhooks exigem HTTPS');
  if (allowPrivate()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // On Workers, outbound fetch runs on Cloudflare's network, which cannot
  // reach the operator's private networks, and Node's DNS resolution is not
  // available — so names are checked syntactically and IP literals by range.
  if (IS_WORKER) {
    if (/^(localhost|.*\.(localhost|local|internal|lan|home|corp))$/i.test(host)) throw new Error('Endereços internos/privados não são permitidos');
    if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Endereços internos/privados não são permitidos');
    return url;
  }
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  if (addresses.length === 0) throw new Error('Não foi possível resolver o host do webhook');
  if (addresses.some(isPrivateAddress)) throw new Error('Endereços internos/privados não são permitidos');
  return url;
}

// DNS lookup used for the actual connection. Validating the address here (and
// not only beforehand) closes the DNS-rebinding window between check and connect.
function safeLookup(hostname, options, callback) {
  dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!allowPrivate() && addresses.some(a => isPrivateAddress(a.address))) return callback(new Error('Endereços internos/privados não são permitidos'));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function postJson(rawUrl, headers, body, timeoutMs = 8000) {
  const url = new URL(rawUrl);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, lookup: safeLookup, timeout: timeoutMs }, res => {
      res.resume(); // the response body is ignored and never stored
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo limite excedido (8s)')));
    req.on('error', reject);
    req.end(body);
  });
}

// Signature covers timestamp + body. Receivers should reject timestamps older
// than 5 minutes and delivery ids already seen (replay protection).
export function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// Minimum data sent to third parties: no comments, names or e-mails.
function webhookData(event) {
  const t = event.task;
  if (t) return { id: t.id, title: t.title, status: t.status, priority: t.priority, type: t.type, projectId: t.projectId, assigneeId: t.assigneeId, dueDate: t.dueDate, completedAt: t.completedAt, updatedAt: t.updatedAt || t.createdAt };
  const p = event.payload || {};
  if (event.webhookEvent === 'comment.created') return { taskId: p.taskId, commentId: p.comment?.id, createdAt: p.comment?.createdAt };
  if (event.webhookEvent?.startsWith('member.')) return { userId: p.userId, role: p.role };
  return p;
}

// One HTTP attempt. Touches no stored data, so on Workers it runs outside
// any D1 transaction.
async function sendWebhook(hook, eventType, data, deliveryId) {
  const body = JSON.stringify({ id: deliveryId, event: eventType, createdAt: new Date().toISOString(), data });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const started = Date.now();
  let status = null;
  let error = null;
  try {
    await assertSafeWebhookUrl(hook.url);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Taskly-Webhooks/2.0',
      'X-Taskly-Event': eventType,
      'X-Taskly-Delivery': deliveryId,
      'X-Taskly-Timestamp': timestamp,
      'X-Taskly-Signature': `sha256=${signPayload(unseal(hook.secret), timestamp, body)}`
    };
    // Workers' http.request ignores custom DNS lookups, so it uses fetch there.
    status = IS_WORKER
      ? (await fetch(hook.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(8000) })).status
      : await postJson(hook.url, headers, body);
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (err) {
    error = err.message;
  }
  return { status, error, durationMs: Date.now() - started };
}

// Stores the attempt's outcome. Returns the record and the retry delay (ms),
// or null when no further attempt is due.
function recordDelivery(hook, eventType, deliveryId, attempt, { status, error, durationMs }) {
  const success = !error;
  const record = {
    id: newId('whlog'), webhookId: hook.id, workspaceId: hook.workspaceId, deliveryId, event: eventType,
    attempt, statusCode: status, success, error, durationMs, createdAt: new Date().toISOString()
  };
  const deliveries = db.get('webhookDeliveries');
  deliveries.unshift(record);
  if (deliveries.length > 5000) deliveries.length = 5000;
  const stored = db.find('webhooks', w => w.id === hook.id);
  if (stored) { stored.lastDeliveryAt = record.createdAt; stored.lastStatus = success ? 'SUCCESS' : 'FAILURE'; }
  db.save();

  const policy = hook.retryPolicy || { maxAttempts: 3, backoffSeconds: 5 };
  if (success) return { record, retryIn: null };
  if (attempt < policy.maxAttempts) return { record, retryIn: policy.backoffSeconds * 1000 * 2 ** (attempt - 1) };
  recordEvent('webhook.failed', `Webhook "${hook.name}" falhou após ${attempt} tentativa(s)`, { webhookId: hook.id, error }, 'error');
  return { record, retryIn: null };
}

const activeHook = id => {
  const hook = db.find('webhooks', w => w.id === id);
  return hook?.active ? { ...hook } : null;
};

export async function deliverWebhook(hook, eventType, data, { attempt = 1, deliveryId = newId('whd') } = {}) {
  const result = await sendWebhook(hook, eventType, data, deliveryId);
  const { record, retryIn } = recordDelivery(hook, eventType, deliveryId, attempt, result);
  if (retryIn !== null) {
    setTimeout(() => {
      const current = activeHook(hook.id);
      if (current) deliverWebhook(current, eventType, data, { attempt: attempt + 1, deliveryId });
    }, retryIn).unref?.();
  }
  return record;
}

// Workers: each step that reads or writes data is its own short D1
// transaction (detached); the HTTP call and the back-off wait happen between
// them. Background work lives ~30 s after the response, so waits are capped.
async function deliverWebhookDetached(hookId, eventType, data) {
  const deliveryId = newId('whd');
  for (let attempt = 1; ; attempt++) {
    const hook = await detached(() => activeHook(hookId));
    if (!hook) return;
    const result = await sendWebhook(hook, eventType, data, deliveryId);
    const outcome = await detached(() => recordDelivery(hook, eventType, deliveryId, attempt, result));
    if (!outcome || outcome.retryIn === null) return;
    await new Promise(r => setTimeout(r, Math.min(outcome.retryIn, 10000)));
  }
}

function dispatchWebhooks(event) {
  const hookEvent = event.webhookEvent || event.type;
  if (!WEBHOOK_EVENTS.includes(hookEvent)) return;
  const data = webhookData({ ...event, webhookEvent: hookEvent });
  db.filter('webhooks', w => w.workspaceId === event.workspaceId && w.active && w.events.includes(hookEvent))
    .forEach(hook => {
      if (IS_WORKER) background(deliverWebhookDetached(hook.id, hookEvent, data));
      else deliverWebhook(hook, hookEvent, data);
    });
}

// --------------------------------------------------------------------- emit

export function emit(event, depth = 0) {
  try {
    runAutomations(event, depth);
  } catch (err) {
    recordEvent('automation.engine_error', 'Erro no motor de automações', { error: err.message }, 'error');
  }
  if (depth === 0) {
    const webhookEvent = {
      'task.status_changed': event.task?.status === 'Done' ? 'task.completed' : 'task.updated',
      'task.priority_changed': 'task.updated',
      'task.assigned': 'task.updated',
      'task.commented': 'comment.created'
    }[event.type] || event.type;
    dispatchWebhooks({ ...event, webhookEvent });
  }
}

// --------------------------------------------------------- deadline scanner

// Creates at most one "due soon" and one "overdue" notification per task per day.
export function scanDeadlines() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  db.filter('tasks', t => !t.deletedAt && !t.archivedAt && t.status !== 'Done' && t.dueDate && t.assigneeId).forEach(t => {
    if (t.dueDate === tomorrow || t.dueDate === todayStr) {
      notify(t.assigneeId, {
        event: 'deadline', title: t.dueDate === todayStr ? 'Prazo vence hoje' : 'Prazo vence amanhã',
        description: `${t.id} — ${t.title}`, taskId: t.id, projectId: t.projectId, workspaceId: t.workspaceId,
        dedupeKey: `due:${t.id}:${t.dueDate}`
      });
    } else if (t.dueDate < todayStr) {
      notify(t.assigneeId, {
        event: 'deadline', title: 'Tarefa atrasada', description: `${t.id} — ${t.title} (venceu em ${t.dueDate})`,
        taskId: t.id, projectId: t.projectId, workspaceId: t.workspaceId, dedupeKey: `overdue:${t.id}:${todayStr}`
      });
    }
  });
}
