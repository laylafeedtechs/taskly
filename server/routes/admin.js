import express from 'express';
import { hashPassword } from '../lib/password.js';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, requireSuperAdmin, publicUser, revokeUserSessions, accessibleWorkspaces, randomToken, sha256, rateLimit } from '../middleware/auth.js';
import { v, badRequest, notFound, paginate } from '../lib/http.js';
import { audit, verifyAuditChain } from '../lib/observability.js';
import { runRetention, retentionSettings, DEFAULT_RETENTION } from '../lib/retention.js';
import { runBackup, listBackups } from '../lib/backup.js';
import { addBusinessDays } from '../lib/incidents.js';
import { REQUEST_TYPES } from '../lib/privacyCatalog.js';
import { projectStats } from '../lib/health.js';
import { createUserWithWorkspace } from './auth.js';
import { sendMail } from '../lib/mailer.js';
import { notify } from '../lib/events.js';

const router = express.Router();
// Every admin endpoint requires a real session of a Super Admin (never an API key).
router.use(authenticate, sessionOnly, requireSuperAdmin);

const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';

router.get('/dashboard', (req, res) => {
  const users = db.get('users');
  const tasks = db.get('tasks').filter(t => !t.deletedAt);
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const events = db.get('systemEvents');
  res.json({
    metrics: {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.status === 'ACTIVE').length,
      blockedUsers: users.filter(u => u.status === 'BLOCKED').length,
      activeLast24h: users.filter(u => u.lastLoginAt && u.lastLoginAt >= dayAgo).length,
      totalWorkspaces: db.get('workspaces').filter(w => !w.archivedAt).length,
      totalProjects: db.get('projects').filter(p => !p.deletedAt).length,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'Done').length,
      activeSessions: db.get('sessions').length,
      errorsLast24h: events.filter(e => e.severity === 'error' && e.createdAt >= dayAgo).length,
      failedLoginsLast24h: events.filter(e => e.type === 'auth.login_failed' && e.createdAt >= dayAgo).length
    },
    health: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      email: process.env.SMTP_HOST ? 'SMTP configurado' : 'Caixa de saída local (SMTP não configurado)',
      googleOAuth: process.env.GOOGLE_CLIENT_ID ? 'Configurado' : 'Não configurado'
    },
    recentEvents: [...events].reverse().slice(0, 10)
  });
});

// ------------------------------------------------------------------ users

router.get('/users', (req, res) => {
  const { q, status } = req.query;
  let users = db.get('users');
  if (status && status !== 'ALL') users = users.filter(u => u.status === status);
  if (q) { const s = String(q).toLowerCase(); users = users.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)); }
  const list = users.map(u => {
    const wss = accessibleWorkspaces(u, { includeArchived: true });
    // Minimal DTO for platform administration (no preferences or internal fields).
    return {
      id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified !== false, status: u.status,
      isSuperAdmin: Boolean(u.isSuperAdmin), mfaEnabled: Boolean(u.mfa?.enabled), hasPassword: Boolean(u.passwordHash),
      googleLinked: Boolean(u.googleSub), lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt,
      workspaces: wss.map(w => ({ id: w.id, name: w.name, role: w.ownerId === u.id ? 'Owner' : w.members.find(m => m.userId === u.id)?.role })),
      projectCount: db.filter('projects', p => !p.deletedAt && (p.members || []).includes(u.id)).length
    };
  });
  const page = paginate(list, req.query, { defaultLimit: 50 });
  res.json({ users: page.items, total: page.total, page: page.page, totalPages: page.totalPages });
});

router.post('/users', async (req, res) => {
  const name = v.str(req.body.name, 'nome', { min: 2, max: 80, required: true });
  const email = v.email(req.body.email);
  if (db.find('users', u => u.email.toLowerCase() === email)) throw badRequest('E-mail já em uso');
  // No default password: either the admin sets one, or the user receives a set-password link.
  const password = req.body.password ? v.password(req.body.password) : null;
  const { user } = createUserWithWorkspace({ name, email, passwordHash: password ? await hashPassword(password) : null });
  user.onboardingCompleted = false;
  let setupLink;
  if (!password) {
    const token = randomToken();
    db.insert('passwordResets', { id: newId('pwr'), userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(), createdAt: new Date().toISOString() });
    setupLink = `${APP_URL()}/?reset=${token}`;
    const mail = await sendMail({ to: email, subject: 'Sua conta Taskly foi criada', text: `Olá, ${name.split(' ')[0]}! Um administrador criou sua conta. Defina sua senha pelo link abaixo (válido por 72 horas).`, actionUrl: setupLink, actionLabel: 'Definir senha' });
    if (mail.delivered) setupLink = undefined;
  }
  db.save();
  audit(req, { action: 'ADMIN_USER_CREATE', entity: `Usuário ${user.id}`, category: 'admin' });
  res.status(201).json({ user: publicUser(user), setupLink });
});

router.put('/users/:id', (req, res) => {
  const user = db.find('users', u => u.id === req.params.id);
  if (!user) throw notFound('Usuário não encontrado');
  const updates = {};
  const name = v.str(req.body.name, 'nome', { min: 2, max: 80 });
  if (name) updates.name = name;
  if (req.body.email !== undefined) {
    const email = v.email(req.body.email);
    if (email !== user.email.toLowerCase() && db.find('users', u => u.email.toLowerCase() === email)) throw badRequest('E-mail já em uso');
    updates.email = email;
  }
  // The Super Admin privilege is deliberately not editable here; see server/scripts/super-admin.js.
  if (req.body.isSuperAdmin !== undefined) throw badRequest('O privilégio de Super Admin só pode ser alterado no console do servidor');
  if (updates.email) updates.emailVerified = false;
  const updated = db.update('users', u => u.id === user.id, updates);
  audit(req, { action: 'ADMIN_USER_UPDATE', entity: `Usuário ${updated.id}`, category: 'admin', details: Object.keys(updates) });
  res.json({ user: publicUser(updated) });
});

// MFA reset for a user who lost their authenticator and recovery codes.
// Identity must be verified out of band; the reset is audited and the user notified.
router.post('/users/:id/reset-mfa', (req, res) => {
  const user = db.find('users', u => u.id === req.params.id);
  if (!user) throw notFound('Usuário não encontrado');
  if (user.id === req.user.id) throw badRequest('Use as configurações da sua conta para alterar o seu MFA');
  const reason = v.str(req.body.reason, 'motivo', { min: 10, max: 300, required: true });
  user.mfa = { enabled: false };
  revokeUserSessions(user.id);
  db.save();
  audit(req, { action: 'ADMIN_MFA_RESET', entity: `Usuário ${user.id}`, category: 'security', details: { reason } });
  notify(user.id, { event: 'security', title: 'Sua verificação em duas etapas foi redefinida', description: 'Um administrador redefiniu o MFA da sua conta a seu pedido. Configure-o novamente em Configurações → Segurança. Se você não pediu isso, contate o suporte.' });
  res.json({ success: true });
});

router.put('/users/:id/status', (req, res) => {
  const user = db.find('users', u => u.id === req.params.id);
  if (!user) throw notFound('Usuário não encontrado');
  if (user.id === req.user.id) throw badRequest('Você não pode bloquear a própria conta');
  const status = req.body.status ? v.oneOf(req.body.status, 'status', ['ACTIVE', 'BLOCKED']) : (user.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE');
  const updated = db.update('users', u => u.id === user.id, { status });
  if (status === 'BLOCKED') revokeUserSessions(user.id);
  audit(req, { action: status === 'BLOCKED' ? 'USER_BLOCK' : 'USER_UNBLOCK', entity: `Usuário ${user.email}`, category: 'admin' });
  res.json({ user: publicUser(updated) });
});

router.delete('/users/:id', (req, res) => {
  const user = db.find('users', u => u.id === req.params.id);
  if (!user) throw notFound('Usuário não encontrado');
  if (user.id === req.user.id) throw badRequest('Você não pode remover a própria conta');
  if (req.body?.confirm !== true) throw badRequest('Confirmação explícita obrigatória');
  const owned = db.filter('workspaces', w => w.ownerId === user.id && w.members.length > 1);
  if (owned.length) throw badRequest(`Transfira a propriedade de ${owned.map(w => w.name).join(', ')} antes de remover este usuário`);
  db.transaction(() => {
    db.get('workspaces').forEach(w => { w.members = w.members.filter(m => m.userId !== user.id); });
    db.filter('workspaces', w => w.ownerId === user.id).forEach(w => { w.archivedAt = new Date().toISOString(); });
    db.get('tasks').forEach(t => { if (t.assigneeId === user.id) t.assigneeId = null; });
    db.remove('sessions', s => s.userId === user.id);
    db.remove('notifications', n => n.userId === user.id);
    db.remove('users', u => u.id === user.id);
  });
  audit(req, { action: 'USER_DELETE', entity: `Usuário ${user.email}`, category: 'admin' });
  res.json({ success: true });
});

// ------------------------------------------------- workspaces & projects

router.get('/workspaces', (req, res) => {
  const list = db.get('workspaces').map(w => ({
    id: w.id, name: w.name, color: w.color, archivedAt: w.archivedAt, createdAt: w.createdAt,
    owner: db.find('users', u => u.id === w.ownerId)?.name || '—',
    memberCount: w.members.length,
    projectCount: db.filter('projects', p => p.workspaceId === w.id && !p.deletedAt).length,
    taskCount: db.filter('tasks', t => t.workspaceId === w.id && !t.deletedAt).length
  }));
  res.json({ workspaces: list });
});

router.post('/workspaces/:id/archive', (req, res) => {
  const ws = db.find('workspaces', w => w.id === req.params.id);
  if (!ws) throw notFound('Workspace não encontrado');
  ws.archivedAt = req.body.archived === false ? null : new Date().toISOString();
  db.save();
  audit(req, { action: ws.archivedAt ? 'ADMIN_WORKSPACE_ARCHIVE' : 'ADMIN_WORKSPACE_UNARCHIVE', entity: `Workspace ${ws.name}`, workspaceId: ws.id, category: 'admin' });
  res.json({ success: true });
});

router.get('/projects', (req, res) => {
  const all = db.get('tasks');
  const ws = Object.fromEntries(db.get('workspaces').map(w => [w.id, w.name]));
  res.json({ projects: db.filter('projects', p => !p.deletedAt).map(p => ({ id: p.id, name: p.name, workspaceName: ws[p.workspaceId], status: p.status, archivedAt: p.archivedAt, dueDate: p.dueDate, ...projectStats(p, all) })) });
});

// -------------------------------------------------------- logs & events

router.get('/audit-logs', (req, res) => {
  const { q, action, category, result, from, to } = req.query;
  let logs = [...db.get('auditLogs')].reverse();
  if (action && action !== 'ALL') logs = logs.filter(l => l.action.includes(String(action)));
  if (category && category !== 'ALL') logs = logs.filter(l => l.category === category);
  if (result && result !== 'ALL') logs = logs.filter(l => l.result.startsWith(result));
  if (from) logs = logs.filter(l => l.timestamp.slice(0, 10) >= from);
  if (to) logs = logs.filter(l => l.timestamp.slice(0, 10) <= to);
  if (q) { const s = String(q).toLowerCase(); logs = logs.filter(l => `${l.actor} ${l.action} ${l.entity} ${l.ip || ''}`.toLowerCase().includes(s)); }
  const page = paginate(logs, req.query, { defaultLimit: 50 });
  res.json({ auditLogs: page.items, total: page.total, page: page.page, totalPages: page.totalPages });
});

router.get('/system-events', (req, res) => {
  const { severity, type } = req.query;
  let events = [...db.get('systemEvents')].reverse();
  if (severity && severity !== 'ALL') events = events.filter(e => e.severity === severity);
  if (type) events = events.filter(e => e.type.startsWith(String(type)));
  const page = paginate(events, req.query, { defaultLimit: 50 });
  res.json({ events: page.items, total: page.total, page: page.page, totalPages: page.totalPages });
});

// ------------------------------------------------ feature flags & settings

router.get('/feature-flags', (req, res) => res.json({ featureFlags: db.get('featureFlags') }));

router.post('/feature-flags', (req, res) => {
  const key = v.str(req.body.key, 'chave', { min: 2, max: 60, required: true });
  if (!/^[a-z0-9-]+$/.test(key)) throw badRequest('A chave deve conter apenas letras minúsculas, números e hífens');
  if (db.find('featureFlags', f => f.key === key)) throw badRequest('Já existe uma flag com esta chave');
  const flag = { id: newId('flag'), key, name: v.str(req.body.name, 'nome', { min: 2, max: 80, required: true }), description: v.str(req.body.description, 'descrição', { max: 300 }) || '', enabled: Boolean(req.body.enabled), updatedAt: new Date().toISOString() };
  db.insert('featureFlags', flag);
  audit(req, { action: 'FEATURE_FLAG_CREATE', entity: `Flag ${key}`, category: 'admin' });
  res.status(201).json({ featureFlag: flag });
});

router.put('/feature-flags/:id', (req, res) => {
  const flag = db.find('featureFlags', f => f.id === req.params.id);
  if (!flag) throw notFound('Flag não encontrada');
  const updates = {};
  if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
  if (req.body.name !== undefined) updates.name = v.str(req.body.name, 'nome', { min: 2, max: 80, required: true });
  if (req.body.description !== undefined) updates.description = v.str(req.body.description, 'descrição', { max: 300 }) || '';
  const updated = db.update('featureFlags', f => f.id === flag.id, updates);
  audit(req, { action: 'FEATURE_FLAG_UPDATE', entity: `Flag ${flag.key} → ${updated.enabled ? 'ativada' : 'desativada'}`, category: 'admin' });
  res.json({ featureFlag: updated });
});

router.delete('/feature-flags/:id', (req, res) => {
  const flag = db.find('featureFlags', f => f.id === req.params.id);
  if (!flag) throw notFound('Flag não encontrada');
  db.remove('featureFlags', f => f.id === flag.id);
  audit(req, { action: 'FEATURE_FLAG_DELETE', entity: `Flag ${flag.key}`, category: 'admin' });
  res.json({ success: true });
});

router.get('/settings', (req, res) => res.json({ settings: db.data.systemSettings }));

router.put('/settings', (req, res) => {
  const s = db.data.systemSettings;
  if (req.body.allowSignup !== undefined) s.allowSignup = Boolean(req.body.allowSignup);
  if (req.body.maintenanceBanner !== undefined) s.maintenanceBanner = v.str(req.body.maintenanceBanner, 'aviso', { max: 300 }) || '';
  if (req.body.sessionDays !== undefined) s.sessionDays = v.int(req.body.sessionDays, 'duração da sessão', { min: 1, max: 30 });
  if (req.body.requireMfaForAdmins !== undefined) s.requireMfaForAdmins = Boolean(req.body.requireMfaForAdmins);
  db.save();
  audit(req, { action: 'SYSTEM_SETTINGS_UPDATE', entity: 'Configurações do sistema', category: 'admin', details: req.body });
  res.json({ settings: s });
});

// -------------------------------------------------------------- retention

router.get('/retention', (req, res) => res.json({ retention: retentionSettings(), defaults: DEFAULT_RETENTION }));

router.put('/retention', (req, res) => {
  const next = { ...retentionSettings() };
  Object.keys(DEFAULT_RETENTION).forEach(k => {
    if (req.body[k] !== undefined) next[k] = v.int(req.body[k], k, { min: 0, max: 3650 });
  });
  if (next.backupsKeep < 1) throw badRequest('Mantenha ao menos 1 backup');
  db.data.systemSettings.retention = next;
  db.save();
  audit(req, { action: 'RETENTION_POLICY_UPDATE', entity: 'Política de retenção', category: 'privacy', details: next });
  res.json({ retention: next });
});

router.post('/retention/run', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: req => `ret:${req.user.id}` }), (req, res) => {
  const counts = runRetention();
  audit(req, { action: 'RETENTION_RUN_MANUAL', entity: 'Política de retenção', category: 'privacy', details: counts });
  res.json({ counts });
});

// ------------------------------------------------------ privacy (controller)

router.put('/privacy', (req, res) => {
  const p = db.data.systemSettings.privacy;
  ['controllerName', 'controllerDocument', 'controllerAddress', 'contactEmail', 'dpoName', 'dpoEmail', 'policyVersion'].forEach(k => {
    if (req.body[k] !== undefined) p[k] = v.str(req.body[k], k, { max: 200 }) || '';
  });
  if (req.body.reviewedByLegal !== undefined) p.reviewedByLegal = Boolean(req.body.reviewedByLegal);
  p.policyUpdatedAt = new Date().toISOString().slice(0, 10);
  db.save();
  audit(req, { action: 'PRIVACY_SETTINGS_UPDATE', entity: 'Dados do controlador / política', category: 'privacy' });
  res.json({ privacy: p });
});

router.get('/privacy-requests', (req, res) => {
  const { status } = req.query;
  let list = [...db.get('privacyRequests')].reverse();
  if (status && status !== 'ALL') list = list.filter(r => r.status === status);
  const page = paginate(list, req.query, { defaultLimit: 50 });
  res.json({ requests: page.items, total: page.total, page: page.page, totalPages: page.totalPages, types: REQUEST_TYPES });
});

router.put('/privacy-requests/:id', (req, res) => {
  const r = db.find('privacyRequests', x => x.id === req.params.id);
  if (!r) throw notFound('Solicitação não encontrada');
  if (req.body.status !== undefined) r.status = v.oneOf(req.body.status, 'status', ['received', 'in_progress', 'completed', 'rejected']);
  if (req.body.response !== undefined) r.response = v.str(req.body.response, 'resposta', { max: 4000 }) || null;
  r.handledBy = req.user.id;
  r.updatedAt = new Date().toISOString();
  db.save();
  audit(req, { action: 'PRIVACY_REQUEST_UPDATE', entity: `Solicitação ${r.id}`, category: 'privacy', details: { status: r.status } });
  if (r.userId && ['completed', 'rejected'].includes(r.status)) notify(r.userId, { event: 'security', title: 'Sua solicitação de privacidade foi respondida', description: r.response || 'Veja os detalhes na Central de Privacidade.' });
  res.json({ request: r });
});

// -------------------------------------------------------------- incidents

router.get('/incidents', (req, res) => {
  const { status } = req.query;
  let list = [...db.get('securityIncidents')].reverse();
  if (status && status !== 'ALL') list = list.filter(i => i.status === status);
  res.json({ incidents: list });
});

router.get('/incidents/:id', (req, res) => {
  const incident = db.find('securityIncidents', i => i.id === req.params.id);
  if (!incident) throw notFound('Incidente não encontrado');
  const evidence = new Set(incident.evidence);
  res.json({ incident, evidence: db.filter('auditLogs', l => evidence.has(l.id)) });
});

// Records the human assessment. Once an incident is confirmed to involve
// personal data with relevant risk, the reference deadline for
// communication (3 business days, ANPD Resolution CD/ANPD nº 15/2024) is set.
router.put('/incidents/:id', (req, res) => {
  const incident = db.find('securityIncidents', i => i.id === req.params.id);
  if (!incident) throw notFound('Incidente não encontrado');
  if (req.body.status !== undefined) incident.status = v.oneOf(req.body.status, 'status', ['open', 'investigating', 'closed']);
  const a = incident.assessment;
  ['involvesPersonalData', 'relevantRisk', 'communicationRequired'].forEach(k => {
    if (req.body[k] !== undefined) a[k] = req.body[k] === null ? null : Boolean(req.body[k]);
  });
  if (a.involvesPersonalData && a.relevantRisk && !a.confirmedAt) {
    a.confirmedAt = new Date().toISOString();
    a.communicationDeadline = addBusinessDays(a.confirmedAt, 3);
  }
  if (req.body.communicatedAt !== undefined) a.communicatedAt = v.date(req.body.communicatedAt, 'data da comunicação');
  if (req.body.note) incident.notes.push({ by: req.user.name, at: new Date().toISOString(), text: v.str(req.body.note, 'nota', { max: 2000, required: true }) });
  incident.updatedAt = new Date().toISOString();
  db.save();
  audit(req, { action: 'INCIDENT_UPDATE', entity: `Incidente ${incident.id}`, category: 'security', details: { status: incident.status, assessment: a } });
  res.json({ incident });
});

// ---------------------------------------------------------------- backups

router.get('/backups', (req, res) => {
  res.json({ status: db.data.systemSettings.backupStatus || null, backups: listBackups(), directory: 'Configurado em TASKLY_BACKUP_DIR (fora do diretório de dados)' });
});

router.post('/backups', rateLimit({ windowMs: 60 * 60 * 1000, max: 6, key: req => `bk:${req.user.id}` }), (req, res) => {
  const status = runBackup('manual');
  audit(req, { action: 'BACKUP_MANUAL', entity: status.file || 'Backup', result: status.ok ? 'SUCCESS' : 'FAILED', category: 'admin' });
  res.status(status.ok ? 201 : 500).json({ status });
});

// ---------------------------------------------------------- audit integrity

router.get('/audit-integrity', (req, res) => res.json(verifyAuditChain()));

export default router;
