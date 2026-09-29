import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, accessibleWorkspaces, sha256, randomToken, rateLimit } from '../middleware/auth.js';
import { v, badRequest, notFound, forbidden, ROLES } from '../lib/http.js';
import { workspaceRole, permissionsFor, ASSIGNABLE_ROLES } from '../lib/rbac.js';
import { audit } from '../lib/observability.js';
import { sendMail } from '../lib/mailer.js';
import { notify, emit, recordActivity } from '../lib/events.js';

const router = express.Router();
const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function summarize(ws, user) {
  const role = workspaceRole(user, ws);
  return {
    id: ws.id, name: ws.name, slug: ws.slug, color: ws.color, icon: ws.icon, ownerId: ws.ownerId,
    archivedAt: ws.archivedAt, settings: ws.settings, createdAt: ws.createdAt,
    memberCount: ws.members.length,
    myRole: role,
    permissions: permissionsFor(role)
  };
}

// Only workspaces where the user is a member (Super Admins browse others via Admin Center).
router.get('/', authenticate, (req, res) => {
  const includeArchived = req.query.archived === '1';
  const list = accessibleWorkspaces(req.user, { includeArchived }).filter(w => !req.apiKey || w.id === req.apiKey.workspaceId);
  res.json({ workspaces: list.map(w => summarize(w, req.user)) });
});

router.post('/', authenticate, sessionOnly, (req, res) => {
  const name = v.str(req.body.name, 'nome', { min: 2, max: 60, required: true });
  const now = new Date().toISOString();
  const ws = {
    id: newId('ws'),
    name,
    slug: `${name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
    color: v.color(req.body.color) || '#3B82F6',
    icon: v.str(req.body.icon, 'ícone', { max: 40 }) || 'business',
    ownerId: req.user.id,
    members: [{ userId: req.user.id, role: 'Owner', joinedAt: now }],
    archivedAt: null,
    settings: { defaultTaskType: 'Task', weekStartsOn: 1 },
    createdAt: now
  };
  db.insert('workspaces', ws);
  audit(req, { action: 'WORKSPACE_CREATE', entity: `Workspace ${ws.name} (${ws.id})`, workspaceId: ws.id, category: 'workspace' });
  res.status(201).json({ workspace: summarize(ws, req.user) });
});

router.get('/:wsId', authenticate, workspaceAccess(), (req, res) => {
  res.json({ workspace: summarize(req.workspace, req.user) });
});

router.put('/:wsId', authenticate, sessionOnly, workspaceAccess('workspace.manage'), (req, res) => {
  const updates = {};
  const name = v.str(req.body.name, 'nome', { min: 2, max: 60 });
  if (name) updates.name = name;
  if (req.body.color !== undefined) updates.color = v.color(req.body.color);
  if (req.body.icon !== undefined) updates.icon = v.str(req.body.icon, 'ícone', { max: 40 });
  if (req.body.settings !== undefined) {
    updates.settings = {
      ...req.workspace.settings,
      defaultTaskType: v.str(req.body.settings.defaultTaskType, 'tipo padrão', { max: 20 }) || req.workspace.settings?.defaultTaskType || 'Task',
      weekStartsOn: v.int(req.body.settings.weekStartsOn, 'início da semana', { min: 0, max: 6 }) ?? req.workspace.settings?.weekStartsOn ?? 1
    };
  }
  const updated = db.update('workspaces', w => w.id === req.workspace.id, updates);
  audit(req, { action: 'WORKSPACE_UPDATE', entity: `Workspace ${updated.name}`, workspaceId: updated.id, category: 'workspace', details: updates });
  res.json({ workspace: summarize(updated, req.user) });
});

router.post('/:wsId/archive', authenticate, sessionOnly, workspaceAccess('workspace.manage'), (req, res) => {
  const archive = req.body.archived !== false;
  if (archive && accessibleWorkspaces(req.user).length <= 1) throw badRequest('Você precisa manter pelo menos um workspace ativo');
  const updated = db.update('workspaces', w => w.id === req.workspace.id, { archivedAt: archive ? new Date().toISOString() : null });
  audit(req, { action: archive ? 'WORKSPACE_ARCHIVE' : 'WORKSPACE_UNARCHIVE', entity: `Workspace ${updated.name}`, workspaceId: updated.id, category: 'workspace' });
  res.json({ workspace: summarize(updated, req.user) });
});

router.post('/:wsId/leave', authenticate, sessionOnly, workspaceAccess(), (req, res) => {
  if (req.workspace.ownerId === req.user.id) throw badRequest('O proprietário não pode sair. Transfira a propriedade antes.');
  req.workspace.members = req.workspace.members.filter(m => m.userId !== req.user.id);
  db.save();
  audit(req, { action: 'WORKSPACE_LEAVE', entity: `Workspace ${req.workspace.name}`, workspaceId: req.workspace.id, category: 'workspace' });
  res.json({ success: true });
});

// ------------------------------------------------------------- invitations

const publicInvite = i => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt, invitedBy: db.find('users', u => u.id === i.invitedBy)?.name || null });

router.get('/:wsId/invitations', authenticate, workspaceAccess('members.manage'), (req, res) => {
  const now = Date.now();
  const pending = db.filter('invitations', i => i.workspaceId === req.workspace.id && !i.usedAt && !i.revokedAt && Date.parse(i.expiresAt) > now);
  res.json({ invitations: pending.map(publicInvite) });
});

router.post('/:wsId/invitations', authenticate, sessionOnly, workspaceAccess('members.manage'),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 50, key: req => `invite:${req.user.id}` }),
  async (req, res) => {
    const email = v.email(req.body.email);
    const role = v.oneOf(req.body.role || 'Member', 'papel', ROLES);
    if (!ASSIGNABLE_ROLES[req.wsRole].includes(role)) throw forbidden(`Seu papel não permite convidar como ${role}`);
    const existingUser = db.find('users', u => u.email.toLowerCase() === email);
    if (existingUser && req.workspace.members.some(m => m.userId === existingUser.id)) throw badRequest('Este usuário já é membro do workspace');

    // A new invitation supersedes any pending one for the same e-mail.
    db.filter('invitations', i => i.workspaceId === req.workspace.id && i.email === email && !i.usedAt && !i.revokedAt)
      .forEach(i => { i.revokedAt = new Date().toISOString(); });

    const token = randomToken();
    const invitation = {
      id: newId('inv'), workspaceId: req.workspace.id, email, role, tokenHash: sha256(token),
      invitedBy: req.user.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      usedAt: null, revokedAt: null, createdAt: new Date().toISOString()
    };
    db.insert('invitations', invitation);
    const link = `${APP_URL()}/?invite=${token}`;
    const mail = await sendMail({
      to: email,
      subject: `Convite para ${req.workspace.name}`,
      text: `${req.user.name} convidou você para o workspace "${req.workspace.name}" como ${role}. O convite expira em 7 dias.`,
      actionUrl: link,
      actionLabel: 'Aceitar convite'
    });
    if (existingUser) notify(existingUser.id, { event: 'invitation', title: `Convite para ${req.workspace.name}`, description: `${req.user.name} convidou você como ${role}.`, workspaceId: req.workspace.id });
    audit(req, { action: 'INVITATION_CREATE', entity: `Convite ${email} (${role})`, workspaceId: req.workspace.id, category: 'permissions' });
    // The raw link is only returned when e-mail is not configured, so an admin can share it manually.
    res.status(201).json({ invitation: publicInvite(invitation), emailDelivered: mail.delivered, inviteLink: mail.delivered ? undefined : link });
  });

router.delete('/:wsId/invitations/:id', authenticate, sessionOnly, workspaceAccess('members.manage'), (req, res) => {
  const inv = db.find('invitations', i => i.id === req.params.id && i.workspaceId === req.workspace.id);
  if (!inv) throw notFound('Convite não encontrado');
  inv.revokedAt = new Date().toISOString();
  db.save();
  audit(req, { action: 'INVITATION_REVOKE', entity: `Convite ${inv.email}`, workspaceId: req.workspace.id, category: 'permissions' });
  res.json({ success: true });
});

function findValidInvitation(token) {
  const inv = db.find('invitations', i => i.tokenHash === sha256(String(token)));
  if (!inv || inv.usedAt || inv.revokedAt || Date.parse(inv.expiresAt) < Date.now()) return null;
  const ws = db.find('workspaces', w => w.id === inv.workspaceId && !w.archivedAt);
  return ws ? { inv, ws } : null;
}

// Public preview so the invite page can show context before login.
router.get('/invitations/:token/preview', rateLimit({ windowMs: 60000, max: 30 }), (req, res) => {
  const found = findValidInvitation(req.params.token);
  if (!found) throw notFound('Convite inválido, expirado ou já utilizado');
  const inviter = db.find('users', u => u.id === found.inv.invitedBy);
  res.json({ workspaceName: found.ws.name, email: found.inv.email, role: found.inv.role, invitedBy: inviter?.name || null, expiresAt: found.inv.expiresAt, accountExists: Boolean(db.find('users', u => u.email.toLowerCase() === found.inv.email)) });
});

router.post('/invitations/:token/accept', authenticate, sessionOnly, (req, res) => {
  const found = findValidInvitation(req.params.token);
  if (!found) throw notFound('Convite inválido, expirado ou já utilizado');
  const { inv, ws } = found;
  if (inv.email !== req.user.email.toLowerCase()) {
    audit(req, { action: 'INVITATION_EMAIL_MISMATCH', entity: `Convite ${inv.id}`, workspaceId: ws.id, result: 'BLOCKED', category: 'security' });
    throw forbidden(`Este convite foi enviado para ${inv.email}. Entre com essa conta para aceitá-lo.`);
  }
  db.transaction(() => {
    if (!ws.members.some(m => m.userId === req.user.id)) ws.members.push({ userId: req.user.id, role: inv.role, joinedAt: new Date().toISOString() });
    inv.usedAt = new Date().toISOString();
  });
  audit(req, { action: 'INVITATION_ACCEPT', entity: `Workspace ${ws.name} como ${inv.role}`, workspaceId: ws.id, category: 'permissions' });
  recordActivity({ workspaceId: ws.id, actor: req.user, type: 'member.added', message: `${req.user.name} entrou no workspace como ${inv.role}` });
  emit({ type: 'member.added', workspaceId: ws.id, payload: { userId: req.user.id, name: req.user.name, role: inv.role } });
  res.json({ workspace: summarize(ws, req.user) });
});

export default router;
