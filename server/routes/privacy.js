// Privacy Center: data-subject rights (LGPD art. 18) and the public policy.
import express from 'express';
import { verifyPassword } from '../lib/password.js';
import * as OTPAuth from 'otpauth';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, destroySession, rateLimit, publicUser, accessibleWorkspaces } from '../middleware/auth.js';
import { v, badRequest, forbidden } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { notify } from '../lib/events.js';
import { unseal } from '../lib/secrets.js';
import { deleteStored } from '../lib/storage.js';
import { purgeWorkspace } from '../lib/purge.js';
import { retentionSettings } from '../lib/retention.js';
import { DATA_CATEGORIES, COOKIES, LOCAL_STORAGE, processors, REQUEST_TYPES } from '../lib/privacyCatalog.js';

const router = express.Router();

// Public: everything the privacy page needs. Controller/DPO data come from
// the Admin Center and must be filled in by the controller.
router.get('/policy', (req, res) => {
  const p = db.data.systemSettings?.privacy || {};
  res.json({
    controller: { name: p.controllerName, document: p.controllerDocument, address: p.controllerAddress, contactEmail: p.contactEmail },
    dpo: { name: p.dpoName, email: p.dpoEmail },
    version: p.policyVersion, updatedAt: p.policyUpdatedAt, reviewedByLegal: Boolean(p.reviewedByLegal),
    categories: DATA_CATEGORIES, cookies: COOKIES, localStorage: LOCAL_STORAGE, processors: processors(),
    retention: retentionSettings(), requestTypes: REQUEST_TYPES
  });
});

router.use(authenticate, sessionOnly);

// Portability / access: everything Taskly holds about the requester, in JSON.
function collectPersonalData(user) {
  const wsIds = new Set(accessibleWorkspaces(user, { includeArchived: true }).map(w => w.id));
  const tasks = db.get('tasks');
  return {
    generatedAt: new Date().toISOString(),
    notice: 'Cópia dos dados pessoais do titular mantidos pelo Taskly. Dados de outras pessoas foram omitidos.',
    account: publicUser(user),
    memberships: db.get('workspaces').filter(w => wsIds.has(w.id)).map(w => ({ workspace: w.name, role: w.ownerId === user.id ? 'Owner' : w.members.find(m => m.userId === user.id)?.role, joinedAt: w.members.find(m => m.userId === user.id)?.joinedAt })),
    sessions: db.filter('sessions', s => s.userId === user.id).map(s => ({ createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, device: s.device })),
    tasksAssigned: tasks.filter(t => t.assigneeId === user.id && !t.deletedAt).map(t => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate })),
    tasksCreated: tasks.filter(t => t.createdBy === user.id && !t.deletedAt).map(t => ({ id: t.id, title: t.title, createdAt: t.createdAt })),
    comments: tasks.flatMap(t => (t.comments || []).filter(c => c.userId === user.id).map(c => ({ taskId: t.id, text: c.text, createdAt: c.createdAt }))),
    files: db.filter('files', f => f.uploadedById === user.id && !f.deletedAt).map(f => ({ name: f.name, size: f.size, createdAt: f.createdAt })),
    activity: db.filter('activity', a => a.actorId === user.id).map(a => ({ type: a.type, message: a.message, taskId: a.taskId, createdAt: a.createdAt })),
    notifications: db.filter('notifications', n => n.userId === user.id).map(n => ({ title: n.title, description: n.description, createdAt: n.createdAt, read: !n.unread })),
    securityLog: db.filter('auditLogs', l => l.actorId === user.id).map(l => ({ action: l.action, result: l.result, ip: l.ip, device: l.device, timestamp: l.timestamp })),
    privacyRequests: db.filter('privacyRequests', r => r.userId === user.id).map(({ userId, ...r }) => r)
  };
}

router.get('/me/summary', (req, res) => {
  const data = collectPersonalData(req.user);
  res.json({
    categories: DATA_CATEGORIES,
    counts: Object.fromEntries(['memberships', 'sessions', 'tasksAssigned', 'tasksCreated', 'comments', 'files', 'activity', 'notifications', 'securityLog'].map(k => [k, data[k].length]))
  });
});

router.get('/me/export', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: req => `export:${req.user.id}` }), (req, res) => {
  audit(req, { action: 'PERSONAL_DATA_EXPORT', entity: `Usuário ${req.user.id}`, category: 'privacy' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="taskly-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(collectPersonalData(req.user), null, 2));
});

// ---------------------------------------------------------- requests

router.get('/requests', (req, res) => {
  res.json({ requests: db.filter('privacyRequests', r => r.userId === req.user.id).map(({ userId, ...r }) => r).reverse(), types: REQUEST_TYPES });
});

router.post('/requests', rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 10, key: req => `privreq:${req.user.id}` }), (req, res) => {
  const type = v.oneOf(req.body.type, 'tipo', Object.keys(REQUEST_TYPES), { required: true });
  const details = v.str(req.body.details, 'detalhes', { max: 2000 }) || '';
  const now = new Date();
  const request = {
    id: newId('priv'), userId: req.user.id, userName: req.user.name, userEmail: req.user.email, type, details,
    status: 'received', // received → in_progress → completed | rejected
    // Reference deadline (15 days, LGPD art. 19, II) — to be validated by the DPO.
    dueAt: new Date(now.getTime() + 15 * 86400000).toISOString(),
    response: null, createdAt: now.toISOString(), updatedAt: now.toISOString()
  };
  db.insert('privacyRequests', request);
  audit(req, { action: 'PRIVACY_REQUEST_CREATED', entity: `Solicitação ${request.id} (${type})`, category: 'privacy' });
  db.filter('users', u => u.isSuperAdmin && u.status === 'ACTIVE').forEach(a => notify(a.id, { event: 'security', title: 'Nova solicitação de titular (LGPD)', description: `${REQUEST_TYPES[type]} — prazo de referência ${request.dueAt.slice(0, 10)}` }));
  const { userId, ...out } = request;
  res.status(201).json({ request: out });
});

// ---------------------------------------------------- account deletion

// Deletes the account. Workspaces owned alone are deleted with it; shared
// workspaces must be transferred first. Content authored in shared
// workspaces is kept for the other members but de-identified. Audit records
// are retained (security / legal obligations) with the actor pseudonymized.
router.delete('/me/account', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: req => `delacct:${req.user.id}` }), async (req, res) => {
  const user = req.user;
  if (req.session.impersonatorId) throw forbidden('A exclusão de conta não pode ser feita em um acesso de suporte');
  if (req.body.confirmEmail?.toLowerCase() !== user.email.toLowerCase()) throw badRequest('Digite seu e-mail para confirmar');
  if (user.passwordHash && !(await verifyPassword(String(req.body.password || ''), user.passwordHash))) throw badRequest('Senha incorreta');
  if (user.mfa?.enabled) {
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(unseal(user.mfa.secret)), digits: 6, period: 30 });
    if (totp.validate({ token: String(req.body.code || ''), window: 1 }) === null) throw badRequest('Código de verificação inválido');
  }
  if (user.isSuperAdmin && db.filter('users', u => u.isSuperAdmin).length <= 1) throw badRequest('O último Super Admin não pode excluir a própria conta');
  const shared = db.filter('workspaces', w => w.ownerId === user.id && w.members.some(m => m.userId !== user.id));
  if (shared.length) throw badRequest(`Transfira a propriedade destes workspaces antes: ${shared.map(w => w.name).join(', ')}`);

  const soleOwned = db.filter('workspaces', w => w.ownerId === user.id).map(w => w.id);
  soleOwned.forEach(purgeWorkspace);
  const label = 'Usuário removido';
  db.transaction(() => {
    db.get('workspaces').forEach(w => { w.members = w.members.filter(m => m.userId !== user.id); });
    db.get('tasks').forEach(t => {
      if (t.assigneeId === user.id) t.assigneeId = null;
      if (t.createdBy === user.id) t.createdBy = null;
      (t.comments || []).forEach(c => { if (c.userId === user.id) Object.assign(c, { userId: null, userName: label, userAvatar: null }); });
    });
    db.get('activity').forEach(a => { if (a.actorId === user.id) Object.assign(a, { actorId: null, actor: label }); });
    db.get('files').forEach(f => { if (f.uploadedById === user.id) Object.assign(f, { uploadedById: null, uploadedBy: label }); });
    db.get('projects').forEach(p => { p.members = (p.members || []).filter(id => id !== user.id); if (p.createdBy === user.id) p.createdBy = null; });
    db.get('apiKeys').forEach(k => { if (k.createdBy === user.id && !k.revokedAt) k.revokedAt = new Date().toISOString(); });
    db.get('privacyRequests').forEach(r => { if (r.userId === user.id) Object.assign(r, { userName: label, userEmail: null }); });
    ['sessions', 'notifications', 'mfaChallenges', 'emailVerifications', 'passwordResets'].forEach(c => db.remove(c, x => x.userId === user.id));
    db.remove('invitations', i => i.email === user.email.toLowerCase());
    db.remove('users', u => u.id === user.id);
  });
  if (user.avatarKey) { try { deleteStored(user.avatarKey); } catch { /* already gone */ } }
  req.user = { id: user.id, name: label };
  audit(req, { action: 'ACCOUNT_DELETED', entity: `Usuário ${user.id}`, category: 'privacy', details: { workspacesDeleted: soleOwned.length } });
  destroySession(req, res);
  res.json({ success: true });
});

export default router;
