import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource, loadResource, authorizeWorkspace } from '../middleware/auth.js';
import { v, badRequest, notFound, TASK_TYPES, PRIORITIES, today } from '../lib/http.js';
import { withStats } from '../lib/health.js';
import { audit } from '../lib/observability.js';
import { emit, recordActivity } from '../lib/events.js';

const router = express.Router();
const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'];
const MILESTONE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'MISSED'];
const COLUMN_COLORS = ['#666666', '#A0A0A0', '#3B82F6', '#F59E0B', '#EC4899', '#10B981'];

const addDays = (days, from = today()) => new Date(Date.parse(from) + days * 86400000).toISOString().slice(0, 10);

function templatesFor(wsId) {
  return db.filter('projectTemplates', t => t.workspaceId === null || t.workspaceId === wsId);
}

function milestoneProgress(m) {
  const tasks = db.filter('tasks', t => t.milestoneId === m.id && !t.deletedAt);
  if (!tasks.length) return m.progress || 0;
  return Math.round((tasks.filter(t => t.status === 'Done').length / tasks.length) * 100);
}

function statusKeyFor(name, idx, total) {
  // Map template column names onto canonical statuses so reports stay consistent.
  const canonical = ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'];
  if (canonical.includes(name)) return name;
  if (idx === total - 1) return 'Done';
  return name;
}

function createColumns(projectId, names) {
  names.forEach((name, order) => {
    db.get('columns').push({
      id: newId('col'), projectId, name, statusKey: statusKeyFor(name, order, names.length),
      wipLimit: null, color: COLUMN_COLORS[Math.min(order, COLUMN_COLORS.length - 1)], order
    });
  });
}

function serialize(project, req) {
  const p = withStats(project, req.user, db.get('tasks'));
  p.milestones = p.milestones.map(m => ({ ...m, progress: milestoneProgress(m) }));
  return p;
}

// -------------------------------------------------------------- listing

router.get('/workspace/:wsId', authenticate, workspaceAccess('project.view', 'projects:read'), (req, res) => {
  const includeArchived = req.query.archived === '1';
  const projects = db.filter('projects', p => p.workspaceId === req.workspace.id && !p.deletedAt && (includeArchived || !p.archivedAt));
  res.json({ projects: projects.map(p => serialize(p, req)) });
});

// Favorites across every workspace the user belongs to (sidebar quick access).
router.get('/favorites', authenticate, sessionOnly, (req, res) => {
  const favs = (req.user.favoriteProjects || []).map(id => {
    try { return loadResource(req, 'projects', id, 'project.view'); } catch { return null; }
  }).filter(p => p && !p.archivedAt);
  res.json({ projects: favs.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.icon, workspaceId: p.workspaceId })) });
});

// ------------------------------------------------------------ templates

router.get('/templates', authenticate, (req, res) => {
  const wsId = req.query.workspaceId;
  if (wsId) {
    authorizeWorkspace(req, String(wsId), 'project.view');
    return res.json({ templates: templatesFor(wsId) });
  }
  res.json({ templates: db.filter('projectTemplates', t => t.workspaceId === null) });
});

function parseTemplate(body) {
  const columns = v.strArray(body.columns, 'colunas', { maxItems: 12, maxLen: 40 });
  if (!columns || columns.length < 2) throw badRequest('O template precisa de pelo menos 2 colunas');
  return {
    name: v.str(body.name, 'nome', { min: 2, max: 80, required: true }),
    description: v.str(body.description, 'descrição', { max: 300 }) || '',
    icon: v.str(body.icon, 'ícone', { max: 40 }) || 'dashboard_customize',
    columns,
    defaultTags: v.strArray(body.defaultTags || [], 'tags', { maxItems: 20, maxLen: 30 }),
    taskTypes: (v.strArray(body.taskTypes || TASK_TYPES, 'tipos', { maxItems: 6 })).filter(t => TASK_TYPES.includes(t)),
    milestones: (Array.isArray(body.milestones) ? body.milestones : []).slice(0, 20).map(m => ({ name: v.str(m.name, 'marco', { required: true, max: 80 }), offsetDays: v.int(m.offsetDays, 'dias', { min: 0, max: 730 }) || 0 })),
    tasks: (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 50).map(t => ({ title: v.str(t.title, 'tarefa', { required: true, max: 200 }), type: TASK_TYPES.includes(t.type) ? t.type : 'Task', priority: PRIORITIES.includes(t.priority) ? t.priority : 'Normal' })),
    automations: []
  };
}

router.post('/templates/workspace/:wsId', authenticate, sessionOnly, workspaceAccess('project.create'), (req, res) => {
  const tpl = { id: newId('tpl'), workspaceId: req.workspace.id, createdBy: req.user.id, createdAt: new Date().toISOString(), ...parseTemplate(req.body) };
  db.insert('projectTemplates', tpl);
  audit(req, { action: 'TEMPLATE_CREATE', entity: `Template ${tpl.name}`, workspaceId: req.workspace.id, category: 'projects' });
  res.status(201).json({ template: tpl });
});

router.delete('/templates/:id', authenticate, sessionOnly, (req, res) => {
  const tpl = db.find('projectTemplates', t => t.id === req.params.id);
  if (!tpl || tpl.workspaceId === null) throw notFound('Template não encontrado');
  loadResource(req, 'projectTemplates', tpl.id, 'project.delete');
  db.remove('projectTemplates', t => t.id === tpl.id);
  res.json({ success: true });
});

// Saves the structure of an existing project as a reusable template.
router.post('/:id/save-as-template', authenticate, sessionOnly, resource('projects', 'project.create'), (req, res) => {
  const p = req.resource;
  const cols = db.filter('columns', c => c.projectId === p.id).sort((a, b) => a.order - b.order);
  const tasks = db.filter('tasks', t => t.projectId === p.id && !t.deletedAt);
  const tpl = {
    id: newId('tpl'), workspaceId: p.workspaceId, createdBy: req.user.id, createdAt: new Date().toISOString(),
    name: v.str(req.body.name, 'nome', { max: 80 }) || `${p.name} (template)`,
    description: p.description?.slice(0, 300) || '', icon: p.icon || 'dashboard_customize',
    columns: cols.map(c => c.name),
    defaultTags: [...new Set(tasks.flatMap(t => t.tags || []))].slice(0, 20),
    taskTypes: TASK_TYPES,
    milestones: db.filter('milestones', m => m.projectId === p.id).map(m => ({ name: m.name, offsetDays: Math.max(0, Math.round((Date.parse(m.dueDate) - Date.parse(p.startDate || today())) / 86400000)) })),
    tasks: req.body.includeTasks ? tasks.slice(0, 50).map(t => ({ title: t.title, type: t.type, priority: t.priority })) : [],
    automations: []
  };
  db.insert('projectTemplates', tpl);
  res.status(201).json({ template: tpl });
});

// ---------------------------------------------------------------- CRUD

router.post('/workspace/:wsId', authenticate, workspaceAccess('project.create', 'projects:write'), (req, res) => {
  const name = v.str(req.body.name, 'nome', { min: 2, max: 100, required: true });
  const template = req.body.templateId ? templatesFor(req.workspace.id).find(t => t.id === req.body.templateId) : null;
  if (req.body.templateId && !template) throw badRequest('Template inválido');
  const startDate = v.date(req.body.startDate, 'início') || today();
  const now = new Date().toISOString();

  const project = {
    id: newId('proj'),
    name,
    slug: name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    workspaceId: req.workspace.id,
    description: v.str(req.body.description, 'descrição', { max: 2000 }) || '',
    status: 'ACTIVE',
    members: [req.user.id],
    startDate,
    dueDate: v.date(req.body.dueDate, 'prazo') || addDays(30, startDate),
    color: v.color(req.body.color) || '#3B82F6',
    icon: v.str(req.body.icon, 'ícone', { max: 40 }) || template?.icon || 'folder',
    templateId: template?.id || null,
    tags: template?.defaultTags || [],
    archivedAt: null,
    deletedAt: null,
    createdBy: req.user.id,
    createdAt: now
  };

  db.transaction(() => {
    db.get('projects').push(project);
    createColumns(project.id, template?.columns || ['Backlog', 'To Do', 'In Progress', 'Review', 'Done']);
    (template?.milestones || []).forEach(m => db.get('milestones').push({ id: newId('ms'), projectId: project.id, name: m.name, description: '', dueDate: addDays(m.offsetDays, startDate), status: 'PLANNED', progress: 0 }));
    const firstStatus = db.filter('columns', c => c.projectId === project.id).sort((a, b) => a.order - b.order)[0]?.statusKey || 'To Do';
    (template?.tasks || []).forEach(t => db.get('tasks').push(blankTask({ id: db.nextTaskId(), title: t.title, type: t.type, priority: t.priority, status: firstStatus, projectId: project.id, workspaceId: project.workspaceId, createdBy: req.user.id })));
  });

  audit(req, { action: 'PROJECT_CREATE', entity: `Projeto ${project.name}`, workspaceId: project.workspaceId, category: 'projects' });
  recordActivity({ workspaceId: project.workspaceId, projectId: project.id, actor: req.user, type: 'project.created', message: `criou o projeto ${project.name}` });
  emit({ type: 'project.created', workspaceId: project.workspaceId, payload: { id: project.id, name: project.name } });
  res.status(201).json({ project: serialize(project, req) });
});

export function blankTask(fields) {
  return {
    description: '', status: 'To Do', priority: 'Normal', type: 'Task', tags: [], assigneeId: null,
    dueDate: null, startDate: today(), blockedBy: [], recurrence: null, isRecurring: false, checklist: [], comments: [],
    milestoneId: null, subtaskOf: null, completedAt: null, archivedAt: null, deletedAt: null,
    createdAt: new Date().toISOString(), ...fields
  };
}

router.get('/:id', authenticate, resource('projects', 'project.view', { scope: 'projects:read' }), (req, res) => {
  res.json({ project: serialize(req.resource, req), columns: db.filter('columns', c => c.projectId === req.resource.id).sort((a, b) => a.order - b.order) });
});

router.put('/:id', authenticate, resource('projects', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const p = req.resource;
  const updates = {};
  const name = v.str(req.body.name, 'nome', { min: 2, max: 100 });
  if (name) updates.name = name;
  if (req.body.description !== undefined) updates.description = v.str(req.body.description, 'descrição', { max: 2000 });
  if (req.body.status !== undefined) updates.status = v.oneOf(req.body.status, 'status', PROJECT_STATUSES);
  if (req.body.dueDate !== undefined) updates.dueDate = v.date(req.body.dueDate, 'prazo');
  if (req.body.startDate !== undefined) updates.startDate = v.date(req.body.startDate, 'início');
  if (req.body.color !== undefined) updates.color = v.color(req.body.color);
  if (req.body.icon !== undefined) updates.icon = v.str(req.body.icon, 'ícone', { max: 40 });
  if (req.body.members !== undefined) {
    const members = v.strArray(req.body.members, 'membros', { maxItems: 200 });
    if (members.some(id => !req.workspace.members.some(m => m.userId === id))) throw badRequest('Todos os membros do projeto precisam pertencer ao workspace');
    updates.members = members;
  }
  const updated = db.update('projects', x => x.id === p.id, updates);
  audit(req, { action: 'PROJECT_UPDATE', entity: `Projeto ${updated.name}`, workspaceId: p.workspaceId, category: 'projects', details: Object.keys(updates) });
  emit({ type: 'project.updated', workspaceId: p.workspaceId, payload: { id: p.id, changes: Object.keys(updates) } });
  res.json({ project: serialize(updated, req) });
});

router.post('/:id/archive', authenticate, sessionOnly, resource('projects', 'project.delete'), (req, res) => {
  const archive = req.body.archived !== false;
  const updated = db.update('projects', x => x.id === req.resource.id, { archivedAt: archive ? new Date().toISOString() : null });
  audit(req, { action: archive ? 'PROJECT_ARCHIVE' : 'PROJECT_UNARCHIVE', entity: `Projeto ${updated.name}`, workspaceId: updated.workspaceId, category: 'projects' });
  res.json({ project: serialize(updated, req) });
});

router.delete('/:id', authenticate, sessionOnly, resource('projects', 'project.delete'), (req, res) => {
  const updated = db.update('projects', x => x.id === req.resource.id, { deletedAt: new Date().toISOString(), deletedBy: req.user.id });
  audit(req, { action: 'PROJECT_SOFT_DELETE', entity: `Projeto ${updated.name}`, workspaceId: updated.workspaceId, category: 'projects' });
  res.json({ success: true, project: { id: updated.id, name: updated.name } });
});

router.post('/:id/favorite', authenticate, sessionOnly, resource('projects', 'project.view'), (req, res) => {
  const favs = new Set(req.user.favoriteProjects || []);
  const favorite = req.body.favorite ?? !favs.has(req.resource.id);
  if (favorite) favs.add(req.resource.id); else favs.delete(req.resource.id);
  req.user.favoriteProjects = [...favs];
  db.save();
  res.json({ projectId: req.resource.id, isFavorite: favorite });
});

router.post('/:id/duplicate', authenticate, sessionOnly, resource('projects', 'project.view'), (req, res) => {
  // Duplicating requires permission to create projects in the same workspace.
  loadResource(req, 'projects', req.resource.id, 'project.create');
  const src = req.resource;
  const o = { copyTasks: true, copyColumns: true, copyTags: true, copyAutomations: false, copyMilestones: true, copyMembers: false, ...req.body };
  const now = new Date().toISOString();
  const project = {
    ...src,
    id: newId('proj'),
    name: v.str(req.body.name, 'nome', { max: 100 }) || `${src.name} (cópia)`,
    members: o.copyMembers ? [...new Set([...(src.members || []), req.user.id])] : [req.user.id],
    tags: o.copyTags ? src.tags || [] : [],
    archivedAt: null, deletedAt: null, createdBy: req.user.id, createdAt: now
  };

  db.transaction(() => {
    db.get('projects').push(project);
    const srcCols = db.filter('columns', c => c.projectId === src.id).sort((a, b) => a.order - b.order);
    if (o.copyColumns) srcCols.forEach(c => db.get('columns').push({ ...c, id: newId('col'), projectId: project.id }));
    else createColumns(project.id, ['Backlog', 'To Do', 'In Progress', 'Review', 'Done']);

    const msMap = {};
    if (o.copyMilestones) db.filter('milestones', m => m.projectId === src.id).forEach(m => {
      const id = newId('ms'); msMap[m.id] = id;
      db.get('milestones').push({ ...m, id, projectId: project.id, status: 'PLANNED' });
    });

    if (o.copyTasks) {
      const validStatuses = new Set(db.filter('columns', c => c.projectId === project.id).map(c => c.statusKey));
      const fallback = db.filter('columns', c => c.projectId === project.id).sort((a, b) => a.order - b.order)[0]?.statusKey;
      const idMap = {};
      const srcTasks = db.filter('tasks', t => t.projectId === src.id && !t.deletedAt && !t.archivedAt);
      srcTasks.forEach(t => { idMap[t.id] = db.nextTaskId(); });
      srcTasks.forEach(t => db.get('tasks').push({
        ...t,
        id: idMap[t.id],
        projectId: project.id,
        status: validStatuses.has(t.status) ? t.status : fallback,
        tags: o.copyTags ? t.tags : [],
        assigneeId: o.copyMembers ? t.assigneeId : null,
        blockedBy: (t.blockedBy || []).map(id => idMap[id]).filter(Boolean),
        subtaskOf: t.subtaskOf ? idMap[t.subtaskOf] || null : null,
        milestoneId: t.milestoneId ? msMap[t.milestoneId] || null : null,
        comments: [], completedAt: t.status === 'Done' ? t.completedAt : null,
        createdBy: req.user.id, createdAt: now
      }));
    }

    if (o.copyAutomations) {
      db.filter('automations', a => a.projectId === src.id).forEach(a => db.get('automations').push({ ...a, id: newId('aut'), projectId: project.id, executionsCount: 0, lastTriggeredAt: null, createdAt: now }));
    }
  });

  audit(req, { action: 'PROJECT_DUPLICATE', entity: `${src.name} → ${project.name}`, workspaceId: src.workspaceId, category: 'projects', details: o });
  res.status(201).json({ project: serialize(project, req) });
});

// ------------------------------------------------------------ milestones

function parseMilestone(body, partial = false) {
  const out = {};
  const name = v.str(body.name, 'nome', { min: 2, max: 120, required: !partial });
  if (name) out.name = name;
  if (body.description !== undefined) out.description = v.str(body.description, 'descrição', { max: 1000 }) || '';
  const due = v.date(body.dueDate, 'prazo');
  if (!partial && !due) throw badRequest('O marco precisa de uma data');
  if (due !== undefined) out.dueDate = due;
  if (body.status !== undefined) out.status = v.oneOf(body.status, 'status', MILESTONE_STATUSES);
  return out;
}

router.get('/:id/milestones', authenticate, resource('projects', 'project.view', { scope: 'projects:read' }), (req, res) => {
  res.json({ milestones: db.filter('milestones', m => m.projectId === req.resource.id).map(m => ({ ...m, progress: milestoneProgress(m) })) });
});

router.post('/:id/milestones', authenticate, resource('projects', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const ms = { id: newId('ms'), projectId: req.resource.id, description: '', status: 'PLANNED', progress: 0, ...parseMilestone(req.body) };
  db.insert('milestones', ms);
  recordActivity({ workspaceId: req.resource.workspaceId, projectId: req.resource.id, actor: req.user, type: 'milestone.created', message: `criou o marco ${ms.name}` });
  res.status(201).json({ milestone: ms });
});

router.put('/milestones/:id', authenticate, resource('milestones', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const updated = db.update('milestones', m => m.id === req.resource.id, parseMilestone(req.body, true));
  res.json({ milestone: { ...updated, progress: milestoneProgress(updated) } });
});

router.delete('/milestones/:id', authenticate, resource('milestones', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  db.transaction(() => {
    db.remove('milestones', m => m.id === req.resource.id);
    db.filter('tasks', t => t.milestoneId === req.resource.id).forEach(t => { t.milestoneId = null; });
  });
  res.json({ success: true });
});

export default router;
