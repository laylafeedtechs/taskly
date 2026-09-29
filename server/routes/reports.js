import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, workspaceAccess, resource, rateLimit } from '../middleware/auth.js';
import { v, badRequest, PRIORITIES, TASK_TYPES, today } from '../lib/http.js';
import { projectStats, isBlocked } from '../lib/health.js';
import { audit } from '../lib/observability.js';
import { toCsv, toExcelXml, toPdf } from '../lib/exporters.js';

const router = express.Router();
const DAY = 86400000;
const iso = d => new Date(d).toISOString().slice(0, 10);

// Normalizes report filters (shared by live reports, saved reports and exports).
function parseFilters(q = {}) {
  const csv = s => (Array.isArray(s) ? s : s && s !== 'ALL' ? String(s).split(',') : []).filter(Boolean);
  const to = v.date(q.to, 'até') || today();
  const from = v.date(q.from, 'de') || iso(Date.parse(to) - 29 * DAY);
  if (from > to) throw badRequest('Período inválido');
  if ((Date.parse(to) - Date.parse(from)) / DAY > 731) throw badRequest('O período máximo é de 2 anos');
  return {
    from, to,
    projectIds: csv(q.projectIds || q.projectId),
    assigneeIds: csv(q.assigneeIds || q.assigneeId),
    priorities: csv(q.priorities || q.priority).filter(p => PRIORITIES.includes(p)),
    types: csv(q.types || q.type).filter(t => TASK_TYPES.includes(t)),
    tags: csv(q.tags || q.tag)
  };
}

function scopedTasks(wsId, f) {
  const liveProjects = new Set(db.filter('projects', p => p.workspaceId === wsId && !p.deletedAt).map(p => p.id));
  return db.filter('tasks', t => t.workspaceId === wsId && !t.deletedAt && liveProjects.has(t.projectId)).filter(t =>
    (!f.projectIds.length || f.projectIds.includes(t.projectId)) &&
    (!f.assigneeIds.length || f.assigneeIds.includes(t.assigneeId)) &&
    (!f.priorities.length || f.priorities.includes(t.priority)) &&
    (!f.types.length || f.types.includes(t.type)) &&
    (!f.tags.length || f.tags.some(tag => (t.tags || []).includes(tag))));
}

export function buildReport(ws, f) {
  const all = db.get('tasks');
  const tasks = scopedTasks(ws.id, f);
  const now = today();
  const inPeriod = d => d && d.slice(0, 10) >= f.from && d.slice(0, 10) <= f.to;
  const created = tasks.filter(t => inPeriod(t.createdAt));
  const completed = tasks.filter(t => t.status === 'Done' && inPeriod(t.completedAt));
  const open = tasks.filter(t => t.status !== 'Done' && !t.archivedAt);
  const overdue = open.filter(t => t.dueDate && t.dueDate < now);
  const blocked = open.filter(t => isBlocked(t, all));
  const durations = completed.map(t => (Date.parse(t.completedAt) - Date.parse(t.createdAt)) / DAY).filter(d => d >= 0);
  const avgDays = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Daily series (or weekly when the period is longer than 90 days).
  const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / DAY) + 1;
  const step = days > 90 ? 7 : 1;
  const series = [];
  for (let d = Date.parse(f.from); d <= Date.parse(f.to); d += step * DAY) {
    const start = iso(d);
    const end = iso(Math.min(d + (step - 1) * DAY, Date.parse(f.to)));
    const within = x => x && x.slice(0, 10) >= start && x.slice(0, 10) <= end;
    series.push({ date: start, created: tasks.filter(t => within(t.createdAt)).length, completed: tasks.filter(t => t.status === 'Done' && within(t.completedAt)).length });
  }

  const columns = db.filter('columns', c => db.find('projects', p => p.id === c.projectId)?.workspaceId === ws.id);
  const statusNames = {};
  columns.forEach(c => { statusNames[c.statusKey] = statusNames[c.statusKey] || c.name; });
  const countBy = (list, key) => list.reduce((acc, t) => { acc[t[key]] = (acc[t[key]] || 0) + 1; return acc; }, {});
  const byStatus = countBy(tasks.filter(t => !t.archivedAt), 'status');
  const byPriority = countBy(open, 'priority');
  const byType = countBy(tasks, 'type');

  const projects = db.filter('projects', p => p.workspaceId === ws.id && !p.deletedAt && !p.archivedAt && (!f.projectIds.length || f.projectIds.includes(p.id)));
  const members = ws.members.map(m => db.find('users', u => u.id === m.userId)).filter(Boolean);
  const workload = [...members, { id: null, name: 'Sem responsável', avatar: null }].map(u => {
    const mine = tasks.filter(t => (t.assigneeId || null) === u.id);
    const mineCompleted = mine.filter(t => t.status === 'Done' && inPeriod(t.completedAt));
    const mineDur = mineCompleted.map(t => (Date.parse(t.completedAt) - Date.parse(t.createdAt)) / DAY);
    return {
      userId: u.id, userName: u.name, userAvatar: u.avatar,
      open: mine.filter(t => t.status !== 'Done').length,
      completed: mineCompleted.length,
      overdue: mine.filter(t => t.status !== 'Done' && t.dueDate && t.dueDate < now).length,
      avgCompletionDays: mineDur.length ? +(mineDur.reduce((a, b) => a + b, 0) / mineDur.length).toFixed(1) : null
    };
  }).filter(w => w.open || w.completed);

  return {
    filters: f,
    metrics: {
      tasksCreated: created.length,
      tasksCompleted: completed.length,
      openTasks: open.length,
      overdueTasks: overdue.length,
      blockedTasks: blocked.length,
      completionRate: created.length ? Math.round((completed.filter(t => inPeriod(t.createdAt)).length / created.length) * 100) : null,
      avgCompletionDays: avgDays === null ? null : +avgDays.toFixed(1),
      activeProjects: projects.filter(p => p.status === 'ACTIVE').length
    },
    series,
    seriesStep: step === 7 ? 'week' : 'day',
    statusDistribution: Object.entries(byStatus).map(([status, count]) => ({ status, label: statusNames[status] || status, count })),
    priorityDistribution: PRIORITIES.map(p => ({ priority: p, count: byPriority[p] || 0 })),
    typeDistribution: TASK_TYPES.map(t => ({ type: t, count: byType[t] || 0 })),
    projectProgress: projects.map(p => ({ id: p.id, name: p.name, color: p.color, dueDate: p.dueDate, ...projectStats(p, all) })),
    workload,
    overdueList: overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 50).map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, assigneeId: t.assigneeId, projectId: t.projectId })),
    blockedList: blocked.slice(0, 50).map(t => ({ id: t.id, title: t.title, blockedBy: t.blockedBy, projectId: t.projectId }))
  };
}

router.get('/workspace/:wsId', authenticate, workspaceAccess('reports.view', 'reports:read'), (req, res) => {
  res.json(buildReport(req.workspace, parseFilters(req.query)));
});

// ------------------------------------------------------- saved reports

// `preset` keeps saved reports relative to today (e.g. 'last 30 days').
const PRESETS = ['7', '30', '90', 'month', 'custom'];
const parseSaved = body => ({
  name: v.str(body.name, 'nome', { min: 2, max: 100, required: true }),
  filters: { ...parseFilters(body.filters || {}), preset: v.oneOf(body.filters?.preset, 'período', PRESETS) || 'custom' }
});

router.get('/saved/:wsId', authenticate, workspaceAccess('reports.view'), (req, res) => {
  res.json({ savedReports: db.filter('savedReports', r => r.workspaceId === req.workspace.id && (r.shared !== false || r.createdBy === req.user.id)) });
});

router.post('/saved/:wsId', authenticate, workspaceAccess('reports.view'), (req, res) => {
  const report = { id: newId('rep'), workspaceId: req.workspace.id, ...parseSaved(req.body), shared: req.body.shared !== false, createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.insert('savedReports', report);
  res.status(201).json({ savedReport: report });
});

router.put('/saved/item/:id', authenticate, resource('savedReports', 'reports.view'), (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) updates.name = v.str(req.body.name, 'nome', { min: 2, max: 100, required: true });
  if (req.body.filters !== undefined) updates.filters = { ...parseFilters(req.body.filters), preset: v.oneOf(req.body.filters.preset, 'período', PRESETS) || 'custom' };
  res.json({ savedReport: db.update('savedReports', r => r.id === req.resource.id, updates) });
});

router.post('/saved/item/:id/duplicate', authenticate, resource('savedReports', 'reports.view'), (req, res) => {
  const copy = { ...req.resource, id: newId('rep'), name: `${req.resource.name} (cópia)`.slice(0, 100), createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.insert('savedReports', copy);
  res.status(201).json({ savedReport: copy });
});

router.delete('/saved/item/:id', authenticate, resource('savedReports', 'reports.view'), (req, res) => {
  db.remove('savedReports', r => r.id === req.resource.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------- export

router.post('/export/:wsId', authenticate, workspaceAccess('reports.export', 'reports:read'), rateLimit({ windowMs: 60 * 60 * 1000, max: 30, key: req => `export:${req.user.id}` }), (req, res) => {
  const format = v.oneOf(req.body.format || 'csv', 'formato', ['csv', 'xlsx', 'pdf']);
  const f = parseFilters(req.body.filters || {});
  const report = buildReport(req.workspace, f);
  const tasks = scopedTasks(req.workspace.id, f).filter(t => !t.archivedAt);
  const users = Object.fromEntries(db.get('users').map(u => [u.id, u.name]));
  const projects = Object.fromEntries(db.get('projects').map(p => [p.id, p.name]));
  const headers = ['ID', 'Título', 'Projeto', 'Status', 'Prioridade', 'Tipo', 'Responsável', 'Prazo', 'Criada em', 'Concluída em', 'Tags'];
  const rows = tasks.map(t => [t.id, t.title, projects[t.projectId] || '', t.status, t.priority, t.type, users[t.assigneeId] || '', t.dueDate || '', t.createdAt.slice(0, 10), t.completedAt?.slice(0, 10) || '', (t.tags || []).join('; ')]);
  const stamp = `${req.workspace.slug || 'taskly'}-${f.from}_${f.to}`;
  audit(req, { action: 'REPORT_EXPORT', entity: `Relatório ${format.toUpperCase()} (${rows.length} tarefas)`, workspaceId: req.workspace.id, category: 'reports', details: f });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="taskly-${stamp}.csv"`);
    return res.send(toCsv(headers, rows));
  }
  const m = report.metrics;
  const summary = [
    ['Tarefas criadas', m.tasksCreated], ['Tarefas concluídas', m.tasksCompleted], ['Em aberto', m.openTasks],
    ['Atrasadas', m.overdueTasks], ['Bloqueadas', m.blockedTasks], ['Taxa de conclusão (%)', m.completionRate ?? '—'],
    ['Tempo médio de conclusão (dias)', m.avgCompletionDays ?? '—'], ['Projetos ativos', m.activeProjects]
  ];
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="taskly-${stamp}.xls"`);
    return res.send(toExcelXml([
      { name: 'Resumo', headers: ['Métrica', 'Valor'], rows: summary },
      { name: 'Tarefas', headers, rows },
      { name: 'Projetos', headers: ['Projeto', 'Progresso (%)', 'Saúde', 'Tarefas', 'Atrasadas', 'Bloqueadas'], rows: report.projectProgress.map(p => [p.name, p.progress, p.health, p.totalTasks, p.overdueTasks, p.blockedTasks]) },
      { name: 'Carga de trabalho', headers: ['Pessoa', 'Em aberto', 'Concluídas', 'Atrasadas', 'Média (dias)'], rows: report.workload.map(w => [w.userName, w.open, w.completed, w.overdue, w.avgCompletionDays ?? '—']) }
    ]));
  }
  const pdf = toPdf({
    title: `Relatório — ${req.workspace.name}`,
    subtitle: `Período ${f.from} a ${f.to} · Gerado em ${new Date().toLocaleString('pt-BR')} por ${req.user.name}`,
    metrics: summary.map(([label, value]) => ({ label, value: String(value) })),
    table: { headers: ['ID', 'Título', 'Projeto', 'Status', 'Prioridade', 'Responsável', 'Prazo'], widths: [60, 250, 130, 80, 60, 120, 70], rows: rows.map(r => [r[0], r[1], r[2], r[3], r[4], r[6], r[7]]) }
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="taskly-${stamp}.pdf"`);
  res.send(pdf);
});

export default router;
