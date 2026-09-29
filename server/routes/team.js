import express from 'express';
import { db } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, publicUser, authorizeWorkspace } from '../middleware/auth.js';
import { v, badRequest, notFound, forbidden, ROLES } from '../lib/http.js';
import { permissionMatrix, ASSIGNABLE_ROLES, roleHas } from '../lib/rbac.js';
import { audit } from '../lib/observability.js';
import { emit, recordActivity, notify } from '../lib/events.js';

const router = express.Router();

router.get('/workspace/:wsId/members', authenticate, workspaceAccess(null, 'projects:read'), (req, res) => {
  const canManage = roleHas(req.wsRole, 'members.manage');
  const members = req.workspace.members.map(m => {
    const user = db.find('users', u => u.id === m.userId);
    if (!user) return null;
    // Last access is only visible to members who manage the team (data minimization).
    return {
      id: user.id, name: user.name, email: user.email, avatar: user.avatar || null, status: user.status,
      ...(canManage ? { lastLoginAt: user.lastLoginAt || null } : {}),
      workspaceRole: req.workspace.ownerId === user.id ? 'Owner' : m.role, joinedAt: m.joinedAt
    };
  }).filter(Boolean);
  res.json({ members });
});

router.put('/workspace/:wsId/members/:userId', authenticate, sessionOnly, workspaceAccess('members.manage'), (req, res) => {
  const role = v.oneOf(req.body.role, 'papel', ROLES, { required: true });
  const ws = req.workspace;
  const member = ws.members.find(m => m.userId === req.params.userId);
  if (!member) throw notFound('Usuário não é membro deste workspace');
  if (req.params.userId === req.user.id) throw badRequest('Você não pode alterar o seu próprio papel');
  if (ws.ownerId === member.userId) throw badRequest('O papel do proprietário não pode ser alterado. Transfira a propriedade primeiro.');
  if (role === 'Owner') throw badRequest('Use "Transferir propriedade" para tornar alguém proprietário.');

  const assignable = ASSIGNABLE_ROLES[req.wsRole];
  // Managers cannot touch peers or owners, and nobody can grant above their own level.
  if (!assignable.includes(role) || !assignable.includes(member.role)) {
    audit(req, { action: 'MEMBER_ROLE_CHANGE_DENIED', entity: `${member.userId} → ${role}`, workspaceId: ws.id, result: 'BLOCKED', category: 'permissions' });
    throw forbidden('Seu papel não permite esta alteração');
  }
  const previous = member.role;
  member.role = role;
  db.save();
  audit(req, { action: 'MEMBER_ROLE_CHANGE', entity: `${member.userId}: ${previous} → ${role}`, workspaceId: ws.id, category: 'permissions' });
  notify(member.userId, { event: 'security', title: 'Seu papel foi alterado', description: `Seu papel em "${ws.name}" agora é ${role}.`, workspaceId: ws.id, actor: req.user });
  res.json({ success: true, member });
});

router.post('/workspace/:wsId/transfer-ownership', authenticate, sessionOnly, workspaceAccess('workspace.manage'), (req, res) => {
  const ws = req.workspace;
  if (ws.ownerId !== req.user.id) throw forbidden('Apenas o proprietário pode transferir a propriedade');
  const target = ws.members.find(m => m.userId === req.body.userId);
  if (!target || target.userId === req.user.id) throw badRequest('Escolha outro membro do workspace');
  db.transaction(() => {
    ws.ownerId = target.userId;
    target.role = 'Owner';
    const me = ws.members.find(m => m.userId === req.user.id);
    if (me) me.role = 'Manager';
  });
  audit(req, { action: 'OWNERSHIP_TRANSFER', entity: `Workspace ${ws.name} → ${target.userId}`, workspaceId: ws.id, category: 'permissions' });
  res.json({ success: true });
});

router.delete('/workspace/:wsId/members/:userId', authenticate, sessionOnly, workspaceAccess('members.manage'), (req, res) => {
  const ws = req.workspace;
  const member = ws.members.find(m => m.userId === req.params.userId);
  if (!member) throw notFound('Usuário não é membro deste workspace');
  if (ws.ownerId === member.userId) throw badRequest('O proprietário não pode ser removido');
  if (member.userId === req.user.id) throw badRequest('Use "Sair do workspace" para remover a si mesmo');
  if (!ASSIGNABLE_ROLES[req.wsRole].includes(member.role)) throw forbidden('Seu papel não permite remover este membro');

  const user = db.find('users', u => u.id === member.userId);
  db.transaction(() => {
    ws.members = ws.members.filter(m => m.userId !== member.userId);
    // Unassign their open tasks so nothing silently points to a non-member.
    db.filter('tasks', t => t.workspaceId === ws.id && t.assigneeId === member.userId && t.status !== 'Done').forEach(t => { t.assigneeId = null; });
  });
  audit(req, { action: 'MEMBER_REMOVE', entity: `${user?.email || member.userId} removido`, workspaceId: ws.id, category: 'permissions' });
  recordActivity({ workspaceId: ws.id, actor: req.user, type: 'member.removed', message: `${user?.name || 'Um membro'} foi removido do workspace` });
  emit({ type: 'member.removed', workspaceId: ws.id, payload: { userId: member.userId } });
  res.json({ success: true });
});

router.get('/permissions-matrix', authenticate, (req, res) => {
  const wsId = req.query.workspaceId;
  let myRole = null;
  if (wsId) myRole = authorizeWorkspace(req, wsId).role;
  res.json({ permissionsMatrix: permissionMatrix(), myRole, assignableRoles: myRole ? ASSIGNABLE_ROLES[myRole] : [] });
});

export default router;
