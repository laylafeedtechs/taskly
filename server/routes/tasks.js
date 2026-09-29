import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, workspaceAccess, resource, loadResource, authorizeWorkspace } from '../middleware/auth.js';
import { v, badRequest, notFound, forbidden, conflict, PRIORITIES, TASK_TYPES, today } from '../lib/http.js';
import { roleHas } from '../lib/rbac.js';
import { isBlocked } from '../lib/health.js';
import { audit } from '../lib/observability.js';
import { emit, recordActivity, notify, extractMentions } from '../lib/events.js';
import { blankTask } from './projects.js';

const router = express.Router();
const PRIORITY_LABEL = { Urgent: 'Urgente', High: 'Alta', Normal: 'Normal', Low: 'Baixa' };
const RECURRENCE = ['daily', 'weekly', 'monthly', 'custom'];

// ------------------------------------------------------------- helpers

const projectColumns = projectId => db.filter('columns', c => c.projectId === projectId).sort((a, b) => a.order - b.order);

// Statuses that mean "ready/finished" and therefore require dependencies to be done.
function gatedStatuses(projectId) {
  const cols = projectColumns(projectId);
  return new Set(['Review', 'Testing', 'Done', cols[cols.length - 1]?.statusKey].filter(Boolean));
}

function assertMember(ws, userId) {
  if (userId && !ws.members.some(m => m.userId === userId) && ws.ownerId !== userId) throw badRequest('O responsável precisa ser membro do workspace');
}

function assertProjectInWorkspace(projectId, ws) {
  const p = db.find('projects', x => x.id === projectId && x.workspaceId === ws.id && !x.deletedAt);
  if (!p) throw badRequest('Projeto inválido para este workspace');
  return p;
}

function wouldCreateCycle(taskId, newBlockerId) {
  // Adding "taskId blocked by newBlockerId" creates a cycle if taskId already blocks newBlockerId (transitively).
  const stack = [newBlockerId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = db.find('tasks', x => x.id === cur);
    (t?.blockedBy || []).forEach(id => stack.push(id));
  }
  return false;
}

function validateBlockedBy(task, ids, ws) {
  const list = v.strArray(ids, 'dependências', { maxItems: 30 }) || [];
  list.forEach(id => {
    if (id === task.id) throw badRequest('Uma tarefa não pode depender de si mesma');
    const dep = db.find('tasks', t => t.id === id && t.workspaceId === ws.id && !t.deletedAt);
    if (!dep) throw badRequest(`Dependência ${id} não encontrada neste workspace`);
    if (task.id && wouldCreateCycle(task.id, id)) throw badRequest(`Adicionar ${id} criaria uma dependência circular`);
  });
  return list;
}

function parseRecurrence(body) {
  if (body.recurrence === undefined && body.isRecurring === undefined) return undefined;
  if (body.recurrence === null || body.isRecurring === false) return null;
  const r = body.recurrence || { interval: body.recurringInterval || 'weekly' };
  const interval = v.oneOf(r.interval, 'recorrência', RECURRENCE, { required: true });
  const out = { interval, every: v.int(r.every, 'intervalo', { min: 1, max: 365 }) || 1, time: null, weekdays: [] };
  if (r.time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw badRequest('Horário inválido (use HH:MM)');
    out.time = r.time;
  }
  if (interval === 'custom' || interval === 'weekly') {
    out.weekdays = Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map(Number).filter(d => d >= 0 && d <= 6))] : [];
  }
  return out;
}

export function nextOccurrence(dueDate, rec) {
  const base = new Date(`${dueDate || today()}T00:00:00Z`);
  const d = new Date(base);
  if (rec.interval === 'daily') d.setUTCDate(d.getUTCDate() + rec.every);
  else if (rec.interval === 'monthly') d.setUTCMonth(d.getUTCMonth() + rec.every);
  else if (rec.weekdays?.length) {
    // Next matching weekday after the base date (e.g. every Monday).
    do { d.setUTCDate(d.getUTCDate() + 1); } while (!rec.weekdays.includes(d.getUTCDay()));
    if (rec.every > 1) d.setUTCDate(d.getUTCDate() + 7 * (rec.every - 1));
  } else d.setUTCDate(d.getUTCDate() + (rec.interval === 'weekly' ? 7 : 1) * rec.every);
  // Never schedule in the past (e.g. a daily task completed a week late).
  const todayDate = new Date(`${today()}T00:00:00Z`);
  while (d <= todayDate && rec.interval === 'daily') d.setUTCDate(d.getUTCDate() + rec.every);
  return d.toISOString().slice(0, 10);
}

function parseChecklist(items) {
  if (!Array.isArray(items)) throw badRequest('Checklist inválido');
  if (items.length > 100) throw badRequest('Máximo de 100 itens no checklist');
  return items.map(i => ({ id: typeof i.id === 'string' && i.id.length < 40 ? i.id : newId('chk'), text: v.str(i.text, 'item', { required: true, max: 300 }), completed: Boolean(i.completed) }));
}

// Indexes relationships once so decorating a whole board stays O(n).
function buildIndex(all) {
  const byId = new Map();
  const blocks = new Map();
  const subtasks = new Map();
  const files = new Map();
  all.forEach(t => {
    if (t.deletedAt) return;
    byId.set(t.id, t);
    (t.blockedBy || []).forEach(id => blocks.set(id, [...(blocks.get(id) || []), t.id]));
    if (t.subtaskOf) subtasks.set(t.subtaskOf, [...(subtasks.get(t.subtaskOf) || []), t]);
  });
  db.get('files').forEach(f => { if (f.taskId && !f.deletedAt) files.set(f.taskId, (files.get(f.taskId) || 0) + 1); });
  return { byId, blocks, subtasks, files };
}

// Derived, read-only fields shown on cards and in the drawer.
function decorate(task, all, index = buildIndex(all)) {
  const subs = index.subtasks.get(task.id) || [];
  const done = (task.checklist || []).filter(c => c.completed).length;
  return {
    ...task,
    blocks: index.blocks.get(task.id) || [],
    isBlocked: task.status !== 'Done' && (task.blockedBy || []).some(id => { const d = index.byId.get(id); return d && d.status !== 'Done'; }),
    checklistProgress: { done, total: (task.checklist || []).length },
    subtaskProgress: { done: subs.filter(s => s.status === 'Done').length, total: subs.length },
    commentCount: (task.comments || []).length,
    attachmentCount: index.files.get(task.id) || 0
  };
}

function inRange(date, from, to) {
  return date && (!from || date >= from) && (!to || date <= to);
}

export function filterTasks(list, q, all) {
  const csv = s => (s && s !== 'ALL' ? String(s).split(',').filter(Boolean) : null);
  const priorities = csv(q.priority);
  const statuses = csv(q.status);
  const assignees = csv(q.assigneeId);
  const types = csv(q.type);
  const tags = csv(q.tag);
  const projects = csv(q.projectId);
  const now = today();
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return list.filter(t => {
    if (projects && !projects.includes(t.projectId)) return false;
    if (priorities && !priorities.includes(t.priority)) return false;
    if (statuses && !statuses.includes(t.status)) return false;
    if (assignees && !assignees.includes(t.assigneeId || 'unassigned')) return false;
    if (types && !types.includes(t.type)) return false;
    if (tags && !tags.some(tag => (t.tags || []).includes(tag))) return false;
    if (q.due === 'overdue' && !(t.dueDate && t.dueDate < now && t.status !== 'Done')) return false;
    if (q.due === 'today' && t.dueDate !== now) return false;
    if (q.due === 'week' && !inRange(t.dueDate, now, weekEnd)) return false;
    if (q.due === 'none' && t.dueDate) return false;
    if (q.blocked === '1' && !(t.status !== 'Done' && isBlocked(t, all))) return false;
    if (q.search && q.search.trim()) {
      const s = q.search.trim().toLowerCase();
      const hit = t.title.toLowerCase().includes(s) || t.id.toLowerCase().includes(s) ||
        (t.description || '').toLowerCase().includes(s) || (t.tags || []).some(tag => tag.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- list

router.get('/workspace/:wsId', authenticate, workspaceAccess('project.view', 'tasks:read'), (req, res) => {
  const all = db.get('tasks');
  const includeArchived = req.query.archived === '1';
  const liveProjects = new Set(db.filter('projects', p => p.workspaceId === req.workspace.id && !p.deletedAt).map(p => p.id));
  const base = all.filter(t => t.workspaceId === req.workspace.id && !t.deletedAt && liveProjects.has(t.projectId) && (includeArchived ? Boolean(t.archivedAt) || req.query.archivedOnly !== '1' : !t.archivedAt));
  const list = filterTasks(base, req.query, all);
  res.json({ tasks: (idx => list.map(t => decorate(t, all, idx)))(buildIndex(all)), total: list.length });
});

// -------------------------------------------------------------- create

router.post('/workspace/:wsId', authenticate, workspaceAccess('task.create', 'tasks:write'), (req, res) => {
  const ws = req.workspace;
  const title = v.str(req.body.title, 'título', { min: 1, max: 200, required: true });
  const firstProject = db.find('projects', p => p.workspaceId === ws.id && !p.deletedAt && !p.archivedAt);
  const projectId = req.body.projectId || firstProject?.id;
  if (!projectId) throw badRequest('Crie um projeto antes de adicionar tarefas');
  assertProjectInWorkspace(projectId, ws);
  const cols = projectColumns(projectId);
  const status = req.body.status || cols.find(c => c.statusKey === 'To Do')?.statusKey || cols[0]?.statusKey || 'To Do';
  if (!cols.some(c => c.statusKey === status)) throw badRequest('Status inválido para este projeto');
  const assigneeId = req.body.assigneeId === undefined ? req.user.id : (req.body.assigneeId || null);
  assertMember(ws, assigneeId);

  let tags = req.body.tags;
  if (typeof tags === 'string') tags = tags.split(',').map(s => s.trim()).filter(Boolean);
  const recurrence = parseRecurrence(req.body) || null;
  const milestoneId = req.body.milestoneId || null;
  if (milestoneId && !db.find('milestones', m => m.id === milestoneId && m.projectId === projectId)) throw badRequest('Marco inválido');
  const subtaskOf = req.body.subtaskOf || null;
  if (subtaskOf && !db.find('tasks', t => t.id === subtaskOf && t.projectId === projectId && !t.deletedAt)) throw badRequest('Tarefa-pai inválida');

  const task = blankTask({
    id: db.nextTaskId(),
    title,
    description: v.str(req.body.description, 'descrição', { max: 20000, trim: false }) || '',
    status,
    priority: v.oneOf(req.body.priority || 'Normal', 'prioridade', PRIORITIES),
    type: v.oneOf(req.body.type || ws.settings?.defaultTaskType || 'Task', 'tipo', TASK_TYPES),
    tags: v.strArray(tags || [], 'tags', { maxItems: 20, maxLen: 30 }),
    projectId,
    workspaceId: ws.id,
    assigneeId,
    dueDate: v.date(req.body.dueDate, 'prazo') ?? null,
    startDate: v.date(req.body.startDate, 'início') ?? today(),
    recurrence,
    isRecurring: Boolean(recurrence),
    milestoneId,
    subtaskOf,
    checklist: req.body.checklist ? parseChecklist(req.body.checklist) : [],
    createdBy: req.user.id,
    completedAt: status === 'Done' ? new Date().toISOString() : null
  });
  task.blockedBy = validateBlockedBy(task, req.body.blockedBy || [], ws);
  if (task.dueDate && task.startDate && task.startDate > task.dueDate) throw badRequest('A data de início não pode ser depois do prazo');

  db.insert('tasks', task);
  recordActivity({ workspaceId: ws.id, projectId, taskId: task.id, actor: req.user, type: 'task.created', message: 'criou a tarefa' });
  if (assigneeId && assigneeId !== req.user.id) {
    notify(assigneeId, { event: 'assignment', title: 'Nova tarefa atribuída a você', description: `${req.user.name} atribuiu ${task.id} — ${task.title}`, taskId: task.id, projectId, workspaceId: ws.id, actor: req.user });
  }
  emit({ type: 'task.created', workspaceId: ws.id, task });
  res.status(201).json({ task: decorate(db.find('tasks', t => t.id === task.id), db.get('tasks')) });
});

// ---------------------------------------------------------------- read

router.get('/:id', authenticate, resource('tasks', 'project.view', { scope: 'tasks:read' }), (req, res) => {
  const all = db.get('tasks');
  const task = req.resource;
  res.json({
    task: decorate(task, all),
    subtasks: all.filter(t => t.subtaskOf === task.id && !t.deletedAt).map(t => decorate(t, all)),
    dependencies: {
      blockedBy: (task.blockedBy || []).map(id => all.find(t => t.id === id)).filter(Boolean).map(t => ({ id: t.id, title: t.title, status: t.status })),
      blocks: all.filter(t => !t.deletedAt && (t.blockedBy || []).includes(task.id)).map(t => ({ id: t.id, title: t.title, status: t.status }))
    },
    attachments: db.filter('files', f => f.taskId === task.id && !f.deletedAt)
  });
});

router.get('/:id/activity', authenticate, resource('tasks', 'project.view', { scope: 'tasks:read' }), (req, res) => {
  const list = db.filter('activity', a => a.taskId === req.resource.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ activity: list.slice(0, 200) });
});

// -------------------------------------------------------------- update

// Applies a validated set of changes to a task and records history.
// Shared by the single-task PUT and bulk actions.
function applyTaskChanges(req, task, body, { forceOverride = false } = {}) {
  const ws = db.find('workspaces', w => w.id === task.workspaceId);
  const history = [];
  const events = [];
  const changes = {};

  if (body.projectId !== undefined && body.projectId !== task.projectId) {
    assertProjectInWorkspace(body.projectId, ws);
    const cols = projectColumns(body.projectId);
    changes.projectId = body.projectId;
    if (!cols.some(c => c.statusKey === (body.status ?? task.status))) changes.status = cols[0]?.statusKey;
    changes.milestoneId = null;
    history.push(['task.moved', `moveu a tarefa para o projeto ${db.find('projects', p => p.id === body.projectId)?.name}`]);
  }
  if (body.title !== undefined) {
    const title = v.str(body.title, 'título', { min: 1, max: 200, required: true });
    if (title !== task.title) { changes.title = title; history.push(['task.title_changed', `renomeou a tarefa para "${title}"`]); }
  }
  if (body.description !== undefined) {
    const description = v.str(body.description, 'descrição', { max: 20000, trim: false }) ?? '';
    if (description !== task.description) { changes.description = description; history.push(['task.description_changed', 'atualizou a descrição']); }
  }
  if (body.priority !== undefined && body.priority !== task.priority) {
    changes.priority = v.oneOf(body.priority, 'prioridade', PRIORITIES);
    history.push(['task.priority_changed', `alterou a prioridade de ${PRIORITY_LABEL[task.priority]} para ${PRIORITY_LABEL[changes.priority]}`, { from: task.priority, to: changes.priority }]);
    events.push('task.priority_changed');
  }
  if (body.type !== undefined && body.type !== task.type) {
    changes.type = v.oneOf(body.type, 'tipo', TASK_TYPES);
    history.push(['task.type_changed', `alterou o tipo para ${changes.type}`]);
  }
  if (body.tags !== undefined) {
    const tags = v.strArray(body.tags, 'tags', { maxItems: 20, maxLen: 30 });
    const added = tags.filter(t => !(task.tags || []).includes(t));
    const removed = (task.tags || []).filter(t => !tags.includes(t));
    if (added.length || removed.length) {
      changes.tags = tags;
      if (added.length) history.push(['task.tags_changed', `adicionou a(s) tag(s) ${added.join(', ')}`]);
      if (removed.length) history.push(['task.tags_changed', `removeu a(s) tag(s) ${removed.join(', ')}`]);
    }
  }
  if (body.assigneeId !== undefined && (body.assigneeId || null) !== task.assigneeId) {
    const assigneeId = body.assigneeId || null;
    assertMember(ws, assigneeId);
    changes.assigneeId = assigneeId;
    const name = assigneeId ? db.find('users', u => u.id === assigneeId)?.name : null;
    history.push(['task.assignee_changed', name ? `atribuiu a tarefa a ${name}` : 'removeu o responsável']);
    events.push('task.assigned');
  }
  if (body.dueDate !== undefined && (body.dueDate || null) !== task.dueDate) {
    changes.dueDate = v.date(body.dueDate, 'prazo');
    history.push(['task.due_changed', changes.dueDate ? `alterou o prazo para ${changes.dueDate}` : 'removeu o prazo', { from: task.dueDate, to: changes.dueDate }]);
  }
  if (body.startDate !== undefined && (body.startDate || null) !== task.startDate) {
    changes.startDate = v.date(body.startDate, 'início');
    history.push(['task.start_changed', `alterou o início para ${changes.startDate || '—'}`]);
  }
  const start = changes.startDate !== undefined ? changes.startDate : task.startDate;
  const due = changes.dueDate !== undefined ? changes.dueDate : task.dueDate;
  if (start && due && start > due) throw badRequest('A data de início não pode ser depois do prazo');

  if (body.checklist !== undefined) {
    const checklist = parseChecklist(body.checklist);
    const before = (task.checklist || []).filter(c => c.completed).length;
    const after = checklist.filter(c => c.completed).length;
    changes.checklist = checklist;
    if (checklist.length !== (task.checklist || []).length) history.push(['task.checklist_changed', `atualizou o checklist (${after}/${checklist.length})`]);
    else if (before !== after) history.push(['task.checklist_changed', `marcou itens do checklist (${after}/${checklist.length})`]);
  }
  if (body.blockedBy !== undefined) {
    const blockedBy = validateBlockedBy(task, body.blockedBy, ws);
    const added = blockedBy.filter(id => !(task.blockedBy || []).includes(id));
    const removed = (task.blockedBy || []).filter(id => !blockedBy.includes(id));
    if (added.length || removed.length) {
      changes.blockedBy = blockedBy;
      if (added.length) history.push(['task.dependency_added', `agora está bloqueada por ${added.join(', ')}`]);
      if (removed.length) history.push(['task.dependency_removed', `removeu a dependência de ${removed.join(', ')}`]);
    }
  }
  const rec = parseRecurrence(body);
  if (rec !== undefined) {
    changes.recurrence = rec;
    changes.isRecurring = Boolean(rec);
    history.push(['task.recurrence_changed', rec ? `definiu recorrência (${rec.interval})` : 'removeu a recorrência']);
  }
  if (body.milestoneId !== undefined) {
    const pid = changes.projectId || task.projectId;
    if (body.milestoneId && !db.find('milestones', m => m.id === body.milestoneId && m.projectId === pid)) throw badRequest('Marco inválido');
    changes.milestoneId = body.milestoneId || null;
  }

  const newStatus = body.status !== undefined ? body.status : changes.status;
  if (newStatus !== undefined && newStatus !== task.status) {
    const pid = changes.projectId || task.projectId;
    if (!projectColumns(pid).some(c => c.statusKey === newStatus)) throw badRequest(`Status "${newStatus}" não existe neste projeto`);
    const blockers = (changes.blockedBy || task.blockedBy || []).map(id => db.find('tasks', t => t.id === id)).filter(t => t && !t.deletedAt && t.status !== 'Done');
    if (blockers.length && gatedStatuses(pid).has(newStatus)) {
      if (!forceOverride) {
        throw conflict(`${task.id} está bloqueada por ${blockers.map(b => b.id).join(', ')}, que ainda não foi(ram) concluída(s).`, { blockedByTasks: blockers.map(b => ({ id: b.id, title: b.title, status: b.status })) });
      }
      history.push(['task.dependency_override', `ignorou dependências pendentes (${blockers.map(b => b.id).join(', ')})`]);
    }
    changes.status = newStatus;
    changes.completedAt = newStatus === 'Done' ? new Date().toISOString() : null;
    const colName = projectColumns(pid).find(c => c.statusKey === newStatus)?.name || newStatus;
    history.push(['task.status_changed', `moveu a tarefa para ${colName}`, { from: task.status, to: newStatus }]);
    events.push('task.status_changed');
  }

  Object.assign(task, changes, { updatedAt: new Date().toISOString() });
  return { task, history, events, ws, changedFields: Object.keys(changes) };
}

// Creates the next occurrence of a recurring task once it is completed.
function spawnRecurrence(req, task) {
  if (!task.recurrence || task.status !== 'Done') return null;
  const cols = projectColumns(task.projectId);
  const next = blankTask({
    ...task,
    id: db.nextTaskId(),
    status: cols.find(c => c.statusKey === 'To Do')?.statusKey || cols[0]?.statusKey,
    dueDate: nextOccurrence(task.dueDate, task.recurrence),
    startDate: today(),
    checklist: (task.checklist || []).map(c => ({ ...c, id: newId('chk'), completed: false })),
    comments: [],
    completedAt: null,
    recurrenceOf: task.recurrenceOf || task.id,
    createdAt: new Date().toISOString(),
    updatedAt: undefined
  });
  db.get('tasks').push(next);
  // The completed occurrence stops recurring so it never spawns twice.
  task.recurrence = null;
  task.isRecurring = false;
  recordActivity({ workspaceId: task.workspaceId, projectId: task.projectId, taskId: next.id, actor: { name: 'Sistema (recorrência)' }, type: 'task.created', message: `criou a próxima ocorrência de ${task.id} para ${next.dueDate}` });
  return next;
}

function finalize(req, result, previousAssignee) {
  const { task, history, events, ws } = result;
  history.forEach(([type, message, meta]) => recordActivity({ workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, actor: req.user, type, message, meta }));
  if (events.includes('task.assigned') && task.assigneeId && task.assigneeId !== previousAssignee) {
    notify(task.assigneeId, { event: 'assignment', title: 'Tarefa atribuída a você', description: `${req.user.name} atribuiu ${task.id} — ${task.title}`, taskId: task.id, projectId: task.projectId, workspaceId: ws.id, actor: req.user });
  }
  events.forEach(type => emit({ type, workspaceId: ws.id, task }));
  if (!events.length && result.changedFields.length) emit({ type: 'task.updated', workspaceId: ws.id, task });
}

router.put('/:id', authenticate, resource('tasks', 'task.edit', { scope: 'tasks:write' }), (req, res) => {
  const task = req.resource;
  const previousAssignee = task.assigneeId;
  let spawned = null;
  const result = db.transaction(() => {
    const r = applyTaskChanges(req, task, req.body, { forceOverride: req.body.forceOverride === true });
    if (r.changedFields.includes('status')) spawned = spawnRecurrence(req, task);
    return r;
  });
  finalize(req, result, previousAssignee);
  const all = db.get('tasks');
  res.json({ task: decorate(db.find('tasks', t => t.id === task.id), all), spawnedTask: spawned ? decorate(spawned, all) : null });
});

router.post('/:id/archive', authenticate, resource('tasks', 'task.edit', { scope: 'tasks:write' }), (req, res) => {
  const archive = req.body.archived !== false;
  const task = db.update('tasks', t => t.id === req.resource.id, { archivedAt: archive ? new Date().toISOString() : null });
  recordActivity({ workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, actor: req.user, type: archive ? 'task.archived' : 'task.unarchived', message: archive ? 'arquivou a tarefa' : 'desarquivou a tarefa' });
  res.json({ task: decorate(task, db.get('tasks')) });
});

router.delete('/:id', authenticate, resource('tasks', 'task.delete', { scope: 'tasks:write' }), (req, res) => {
  const now = new Date().toISOString();
  const ids = [req.resource.id, ...db.filter('tasks', t => t.subtaskOf === req.resource.id && !t.deletedAt).map(t => t.id)];
  db.transaction(() => ids.forEach(id => Object.assign(db.find('tasks', t => t.id === id), { deletedAt: now, deletedBy: req.user.id })));
  recordActivity({ workspaceId: req.resource.workspaceId, projectId: req.resource.projectId, taskId: req.resource.id, actor: req.user, type: 'task.deleted', message: 'moveu a tarefa para a lixeira' });
  audit(req, { action: 'TASK_SOFT_DELETE', entity: `Tarefa ${req.resource.id}`, workspaceId: req.resource.workspaceId, category: 'tasks' });
  emit({ type: 'task.deleted', workspaceId: req.resource.workspaceId, payload: { id: req.resource.id } });
  res.json({ success: true, deletedIds: ids });
});

// --------------------------------------------------------------- bulk

const BULK_FIELDS = { STATUS: 'status', PRIORITY: 'priority', ASSIGNEE: 'assigneeId', DUE_DATE: 'dueDate', MOVE_PROJECT: 'projectId' };

router.post('/bulk', authenticate, (req, res) => {
  const { taskIds, action, value } = req.body;
  if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.length > 500) throw badRequest('Selecione entre 1 e 500 tarefas');
  const needsDelete = ['DELETE'].includes(action);
  if (![...Object.keys(BULK_FIELDS), 'ADD_TAG', 'REMOVE_TAG', 'DELETE', 'ARCHIVE', 'UNARCHIVE'].includes(action)) throw badRequest('Ação em massa inválida');
  if (['DELETE'].includes(action) && req.body.confirm !== true) throw badRequest('Confirmação obrigatória para ações destrutivas');

  // Authorize every task first; the whole batch fails if any one is not allowed.
  const tasks = taskIds.map(id => loadResource(req, 'tasks', String(id), needsDelete ? 'task.delete' : 'task.edit', { scope: 'tasks:write' }));
  if (new Set(tasks.map(t => t.workspaceId)).size > 1) throw badRequest('Ações em massa devem envolver tarefas de um único workspace');
  const previous = tasks.map(t => ({ id: t.id, status: t.status, priority: t.priority, assigneeId: t.assigneeId, dueDate: t.dueDate, tags: [...(t.tags || [])], archivedAt: t.archivedAt, deletedAt: t.deletedAt, projectId: t.projectId }));
  const results = [];
  const now = new Date().toISOString();

  db.transaction(() => {
    tasks.forEach(task => {
      if (BULK_FIELDS[action]) {
        results.push({ prevAssignee: task.assigneeId, r: applyTaskChanges(req, task, { [BULK_FIELDS[action]]: value }, { forceOverride: req.body.forceOverride === true }) });
      } else if (action === 'ADD_TAG' || action === 'REMOVE_TAG') {
        const tag = v.str(value, 'tag', { required: true, max: 30 });
        const tags = action === 'ADD_TAG' ? [...new Set([...(task.tags || []), tag])] : (task.tags || []).filter(t => t !== tag);
        results.push({ prevAssignee: task.assigneeId, r: applyTaskChanges(req, task, { tags }) });
      } else if (action === 'ARCHIVE' || action === 'UNARCHIVE') {
        task.archivedAt = action === 'ARCHIVE' ? now : null;
        results.push({ r: { task, history: [[action === 'ARCHIVE' ? 'task.archived' : 'task.unarchived', action === 'ARCHIVE' ? 'arquivou a tarefa (em massa)' : 'desarquivou a tarefa']], events: [], ws: req.workspace, changedFields: [] } });
      } else if (action === 'DELETE') {
        task.deletedAt = now; task.deletedBy = req.user.id;
        results.push({ r: { task, history: [['task.deleted', 'moveu a tarefa para a lixeira (em massa)']], events: [], ws: req.workspace, changedFields: [] } });
      }
    });
  });
  results.forEach(({ r, prevAssignee }) => finalize(req, r, prevAssignee));
  audit(req, { action: `BULK_TASK_${action}`, entity: `${tasks.length} tarefa(s)`, workspaceId: tasks[0].workspaceId, category: 'tasks' });
  const all = db.get('tasks');
  res.json({ success: true, count: tasks.length, tasks: (idx => tasks.map(t => decorate(t, all, idx)))(buildIndex(all)), undo: { previous } });
});

// Restores the fields captured by a previous bulk action (used by "Desfazer").
router.post('/bulk/undo', authenticate, (req, res) => {
  const items = Array.isArray(req.body.previous) ? req.body.previous.slice(0, 500) : [];
  if (!items.length) throw badRequest('Nada para desfazer');
  const tasks = items.map(p => {
    const t = loadResource(req, 'tasks', String(p.id), 'task.edit', { includeDeleted: true });
    if (t.deletedAt && !p.deletedAt && !roleHas(req.wsRole, 'task.delete')) throw forbidden('Seu papel não permite restaurar tarefas excluídas');
    return t;
  });
  db.transaction(() => {
    tasks.forEach((task, i) => {
      const p = items[i];
      const ws = db.find('workspaces', w => w.id === task.workspaceId);
      if (p.projectId !== task.projectId) assertProjectInWorkspace(p.projectId, ws);
      if (p.assigneeId) assertMember(ws, p.assigneeId);
      if (!PRIORITIES.includes(p.priority)) throw badRequest('Dados de desfazer inválidos');
      Object.assign(task, {
        projectId: p.projectId, status: p.status, priority: p.priority, assigneeId: p.assigneeId || null,
        dueDate: v.date(p.dueDate, 'prazo') ?? null, tags: v.strArray(p.tags || [], 'tags', { maxItems: 20, maxLen: 30 }),
        archivedAt: p.archivedAt || null, deletedAt: p.deletedAt || null, updatedAt: new Date().toISOString()
      });
      if (task.status !== 'Done') task.completedAt = null;
    });
  });
  tasks.forEach(t => recordActivity({ workspaceId: t.workspaceId, projectId: t.projectId, taskId: t.id, actor: req.user, type: 'task.restored', message: 'desfez uma alteração em massa' }));
  const all = db.get('tasks');
  res.json({ tasks: tasks.map(t => decorate(t, all)) });
});

// ------------------------------------------------------------ comments

router.post('/:id/comments', authenticate, resource('tasks', 'task.comment', { scope: 'tasks:write' }), (req, res) => {
  const text = v.str(req.body.text, 'comentário', { min: 1, max: 5000, required: true });
  const task = req.resource;
  const ws = req.workspace;
  const comment = { id: newId('cm'), userId: req.user.id, userName: req.user.name, userAvatar: req.user.avatar || null, text, createdAt: new Date().toISOString(), editedAt: null };
  task.comments = [...(task.comments || []), comment];
  db.save();

  recordActivity({ workspaceId: ws.id, projectId: task.projectId, taskId: task.id, actor: req.user, type: 'comment.created', message: 'comentou na tarefa' });
  const mentioned = extractMentions(text, ws);
  mentioned.forEach(uid => notify(uid, { event: 'mention', title: `${req.user.name} mencionou você`, description: `${task.id}: ${text.slice(0, 160)}`, taskId: task.id, projectId: task.projectId, workspaceId: ws.id, actor: req.user }));
  const watchers = new Set([task.assigneeId, task.createdBy, ...(task.comments || []).map(c => c.userId)].filter(Boolean));
  watchers.forEach(uid => {
    if (!mentioned.includes(uid)) notify(uid, { event: 'comment', title: `Novo comentário em ${task.id}`, description: `${req.user.name}: ${text.slice(0, 160)}`, taskId: task.id, projectId: task.projectId, workspaceId: ws.id, actor: req.user });
  });
  emit({ type: 'task.commented', workspaceId: ws.id, task, payload: { taskId: task.id, comment } });
  res.status(201).json({ comment, task: decorate(task, db.get('tasks')) });
});

router.delete('/:id/comments/:commentId', authenticate, resource('tasks', 'task.comment'), (req, res) => {
  const task = req.resource;
  const comment = (task.comments || []).find(c => c.id === req.params.commentId);
  if (!comment) throw notFound('Comentário não encontrado');
  if (comment.userId !== req.user.id && !roleHas(req.wsRole, 'members.manage')) throw forbidden('Você só pode excluir seus próprios comentários');
  task.comments = task.comments.filter(c => c.id !== comment.id);
  db.save();
  recordActivity({ workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, actor: req.user, type: 'comment.deleted', message: 'excluiu um comentário' });
  res.json({ task: decorate(task, db.get('tasks')) });
});

export { authorizeWorkspace };
export default router;
