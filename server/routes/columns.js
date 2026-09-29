import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, resource } from '../middleware/auth.js';
import { v, badRequest, conflict } from '../lib/http.js';
import { recordActivity } from '../lib/events.js';

const router = express.Router();
const byOrder = (a, b) => a.order - b.order;
const colsOf = projectId => db.filter('columns', c => c.projectId === projectId).sort(byOrder);

router.get('/project/:id', authenticate, resource('projects', 'project.view', { scope: 'projects:read' }), (req, res) => {
  res.json({ columns: colsOf(req.resource.id) });
});

router.post('/project/:id', authenticate, resource('projects', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const name = v.str(req.body.name, 'nome', { min: 1, max: 40, required: true });
  const cols = colsOf(req.resource.id);
  if (cols.length >= 20) throw badRequest('Máximo de 20 colunas por projeto');
  // The status key is fixed at creation so renaming a column never orphans tasks.
  let statusKey = name;
  while (cols.some(c => c.statusKey === statusKey)) statusKey = `${name} ${Math.random().toString(36).slice(2, 5)}`;
  const col = { id: newId('col'), projectId: req.resource.id, name, statusKey, wipLimit: v.int(req.body.wipLimit, 'limite WIP', { min: 1, max: 999 }) ?? null, color: v.color(req.body.color) || '#A0A0A0', order: cols.length };
  db.insert('columns', col);
  recordActivity({ workspaceId: req.resource.workspaceId, projectId: req.resource.id, actor: req.user, type: 'column.created', message: `criou a coluna ${name}` });
  res.status(201).json({ column: col });
});

router.put('/project/:id/order', authenticate, resource('projects', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const ids = v.strArray(req.body.columnIds, 'colunas', { maxItems: 20 });
  const cols = colsOf(req.resource.id);
  if (!ids || ids.length !== cols.length || !cols.every(c => ids.includes(c.id))) throw badRequest('Envie todas as colunas do projeto na nova ordem');
  db.transaction(() => ids.forEach((id, order) => { cols.find(c => c.id === id).order = order; }));
  res.json({ columns: colsOf(req.resource.id) });
});

router.put('/:id', authenticate, resource('columns', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const updates = {};
  const name = v.str(req.body.name, 'nome', { min: 1, max: 40 });
  if (name) updates.name = name;
  if (req.body.color !== undefined) updates.color = v.color(req.body.color);
  if (req.body.wipLimit !== undefined) updates.wipLimit = v.int(req.body.wipLimit, 'limite WIP', { min: 1, max: 999 });
  const updated = db.update('columns', c => c.id === req.resource.id, updates);
  res.json({ column: updated });
});

// Deleting a column that still has tasks requires choosing where they go.
router.delete('/:id', authenticate, resource('columns', 'project.edit', { scope: 'projects:write' }), (req, res) => {
  const col = req.resource;
  const cols = colsOf(col.projectId);
  if (cols.length <= 1) throw badRequest('O projeto precisa de pelo menos uma coluna');
  const tasks = db.filter('tasks', t => t.projectId === col.projectId && t.status === col.statusKey && !t.deletedAt);
  const moveTo = req.body?.moveTo || req.query.moveTo;
  if (tasks.length && !moveTo) throw conflict(`A coluna possui ${tasks.length} tarefa(s). Escolha para qual coluna movê-las.`, { taskCount: tasks.length });
  const target = moveTo ? cols.find(c => c.statusKey === moveTo && c.id !== col.id) : null;
  if (tasks.length && !target) throw badRequest('Coluna de destino inválida');

  db.transaction(() => {
    tasks.forEach(t => { t.status = target.statusKey; t.completedAt = target.statusKey === 'Done' ? (t.completedAt || new Date().toISOString()) : null; });
    db.remove('columns', c => c.id === col.id);
    colsOf(col.projectId).forEach((c, order) => { c.order = order; });
  });
  recordActivity({ workspaceId: req.workspace.id, projectId: col.projectId, actor: req.user, type: 'column.deleted', message: `excluiu a coluna ${col.name}${tasks.length ? ` e moveu ${tasks.length} tarefa(s) para ${target.name}` : ''}` });
  res.json({ success: true, movedTasks: tasks.length });
});

export default router;
