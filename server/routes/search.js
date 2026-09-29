import express from 'express';
import { db } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, accessibleWorkspaces } from '../middleware/auth.js';
import { paginate, today, badRequest } from '../lib/http.js';
import { workspaceRole, roleHas } from '../lib/rbac.js';
import { projectStats, isBlocked } from '../lib/health.js';

const router = express.Router();

// Global search across every workspace the caller is a member of. Nothing
// from other workspaces can be returned because the candidate set starts
// from the caller's own memberships.
router.get('/', authenticate, sessionOnly, (req, res) => search(req, res, req.query.workspaceId));

// Backwards-compatible workspace-scoped search.
router.get('/workspace/:wsId', authenticate, sessionOnly, workspaceAccess('project.view'), (req, res) => search(req, res, req.params.wsId));

function search(req, res, onlyWs) {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length > 100) throw badRequest('Busca muito longa');
  const empty = { tasks: [], projects: [], members: [], workspaces: [], comments: [], files: [] };
  if (!q) return res.json(empty);

  const workspaces = accessibleWorkspaces(req.user).filter(w => !onlyWs || w.id === onlyWs)
    .filter(w => roleHas(workspaceRole(req.user, w), 'project.view'));
  const wsIds = new Set(workspaces.map(w => w.id));
  const wsName = Object.fromEntries(workspaces.map(w => [w.id, w.name]));
  const liveProjects = db.filter('projects', p => wsIds.has(p.workspaceId) && !p.deletedAt);
  const liveIds = new Set(liveProjects.map(p => p.id));
  const has = s => String(s || '').toLowerCase().includes(q);
  const tasks = db.filter('tasks', t => wsIds.has(t.workspaceId) && liveIds.has(t.projectId) && !t.deletedAt);

  const memberIds = new Set(workspaces.flatMap(w => w.members.map(m => m.userId)));
  res.json({
    tasks: tasks.filter(t => has(t.title) || has(t.id) || (t.tags || []).some(has) || has(t.description))
      .slice(0, 12).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId, workspaceId: t.workspaceId, workspaceName: wsName[t.workspaceId] })),
    projects: liveProjects.filter(p => has(p.name) || has(p.description)).slice(0, 8)
      .map(p => ({ id: p.id, name: p.name, color: p.color, workspaceId: p.workspaceId, workspaceName: wsName[p.workspaceId], archived: Boolean(p.archivedAt) })),
    members: db.filter('users', u => memberIds.has(u.id) && (has(u.name) || has(u.email))).slice(0, 8)
      .map(u => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar })),
    workspaces: workspaces.filter(w => has(w.name)).slice(0, 5).map(w => ({ id: w.id, name: w.name, color: w.color })),
    comments: tasks.flatMap(t => (t.comments || []).filter(c => has(c.text)).map(c => ({ id: c.id, taskId: t.id, taskTitle: t.title, workspaceId: t.workspaceId, text: c.text.slice(0, 160), userName: c.userName, createdAt: c.createdAt }))).slice(0, 8),
    files: db.filter('files', f => wsIds.has(f.workspaceId) && liveIds.has(f.projectId) && !f.deletedAt && has(f.name)).slice(0, 8)
      .map(f => ({ id: f.id, name: f.name, projectId: f.projectId, workspaceId: f.workspaceId, formattedSize: f.formattedSize }))
  });
}

// --------------------------------------------------------- activity feed

router.get('/activity', authenticate, sessionOnly, (req, res) => {
  const { workspaceId, projectId, userId, type, from, to, taskId } = req.query;
  const allowed = new Set(accessibleWorkspaces(req.user).map(w => w.id));
  if (workspaceId && !allowed.has(workspaceId)) return res.json({ activity: [], total: 0, page: 1, totalPages: 1 });
  let list = db.filter('activity', a => allowed.has(a.workspaceId) && (!workspaceId || a.workspaceId === workspaceId));
  if (projectId && projectId !== 'ALL') list = list.filter(a => a.projectId === projectId);
  if (taskId) list = list.filter(a => a.taskId === taskId);
  if (userId && userId !== 'ALL') list = list.filter(a => a.actorId === userId);
  if (type && type !== 'ALL') list = list.filter(a => a.type.startsWith(type));
  if (from) list = list.filter(a => a.createdAt.slice(0, 10) >= from);
  if (to) list = list.filter(a => a.createdAt.slice(0, 10) <= to);
  list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = paginate(list, req.query, { defaultLimit: 30 });
  const tasks = Object.fromEntries(db.get('tasks').map(t => [t.id, t.title]));
  const projects = Object.fromEntries(db.get('projects').map(p => [p.id, p.name]));
  res.json({
    activity: page.items.map(a => ({ ...a, taskTitle: a.taskId ? tasks[a.taskId] || null : null, projectName: a.projectId ? projects[a.projectId] || null : null })),
    total: page.total, page: page.page, totalPages: page.totalPages
  });
});

// --------------------------------------------------------------- dashboard

router.get('/dashboard/:wsId', authenticate, sessionOnly, workspaceAccess('project.view'), (req, res) => {
  const ws = req.workspace;
  const now = today();
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
  const all = db.get('tasks');
  const projects = db.filter('projects', p => p.workspaceId === ws.id && !p.deletedAt && !p.archivedAt);
  const live = new Set(projects.map(p => p.id));
  const tasks = all.filter(t => t.workspaceId === ws.id && !t.deletedAt && !t.archivedAt && live.has(t.projectId));
  const mine = tasks.filter(t => t.assigneeId === req.user.id);
  const open = mine.filter(t => t.status !== 'Done');
  const slim = t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, projectId: t.projectId, isBlocked: isBlocked(t, all) });

  res.json({
    metrics: {
      openTasks: open.length,
      dueToday: open.filter(t => t.dueDate === now).length,
      overdue: open.filter(t => t.dueDate && t.dueDate < now).length,
      completedThisWeek: mine.filter(t => t.status === 'Done' && t.completedAt && Date.parse(t.completedAt) >= monday.getTime()).length
    },
    today: open.filter(t => t.dueDate && t.dueDate <= now).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(slim),
    upcoming: open.filter(t => t.dueDate && t.dueDate > now && t.dueDate <= weekAhead).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(slim),
    myTasks: open.sort((a, b) => ['Urgent', 'High', 'Normal', 'Low'].indexOf(a.priority) - ['Urgent', 'High', 'Normal', 'Low'].indexOf(b.priority)).slice(0, 12).map(slim),
    projects: projects.map(p => ({ id: p.id, name: p.name, color: p.color, dueDate: p.dueDate, ...projectStats(p, all) })),
    recentActivity: db.filter('activity', a => a.workspaceId === ws.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
      .map(a => ({ ...a, taskTitle: a.taskId ? all.find(t => t.id === a.taskId)?.title || null : null }))
  });
});

export default router;
