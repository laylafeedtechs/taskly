import express from 'express';
import { db } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, loadResource } from '../middleware/auth.js';
import { badRequest } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { recordActivity } from '../lib/events.js';
import { purgeTask, purgeProject, purgeFile } from '../lib/purge.js';

const router = express.Router();
router.use(authenticate, sessionOnly);

const TYPES = { task: 'tasks', project: 'projects', file: 'files' };
const RESTORE_PERMISSION = { task: 'task.delete', project: 'project.delete', file: 'files.upload' };

router.get('/workspace/:wsId', workspaceAccess('project.view'), (req, res) => {
  const ws = req.workspace.id;
  const deletedBy = id => db.find('users', u => u.id === id)?.name || null;
  const tasks = db.filter('tasks', t => t.workspaceId === ws && t.deletedAt).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, projectId: t.projectId, deletedAt: t.deletedAt, deletedBy: deletedBy(t.deletedBy) }));
  const projects = db.filter('projects', p => p.workspaceId === ws && p.deletedAt).map(p => ({ id: p.id, name: p.name, color: p.color, deletedAt: p.deletedAt, deletedBy: deletedBy(p.deletedBy), taskCount: db.filter('tasks', t => t.projectId === p.id).length }));
  const files = db.filter('files', f => f.workspaceId === ws && f.deletedAt).map(f => ({ id: f.id, name: f.name, formattedSize: f.formattedSize, projectId: f.projectId, deletedAt: f.deletedAt, deletedBy: deletedBy(f.deletedBy) }));
  res.json({ tasks, projects, files, totalDeleted: tasks.length + projects.length + files.length });
});

function target(req) {
  const collection = TYPES[req.body.type];
  if (!collection) throw badRequest('Tipo de item inválido');
  return { collection, type: req.body.type, id: String(req.body.id || '') };
}

router.post('/restore', (req, res) => {
  const { collection, type, id } = target(req);
  const item = loadResource(req, collection, id, RESTORE_PERMISSION[type], { includeDeleted: true });
  if (!item.deletedAt) throw badRequest('O item não está na lixeira');
  if (type === 'task' && db.find('projects', p => p.id === item.projectId)?.deletedAt) throw badRequest('Restaure o projeto desta tarefa primeiro');
  db.transaction(() => {
    item.deletedAt = null; item.deletedBy = null;
    // Restoring a parent task also restores the subtasks deleted with it.
    if (type === 'task') db.filter('tasks', t => t.subtaskOf === item.id && t.deletedAt).forEach(t => { t.deletedAt = null; });
  });
  recordActivity({ workspaceId: req.workspace.id, projectId: item.projectId || item.id, taskId: type === 'task' ? item.id : null, actor: req.user, type: `${type}.restored`, message: `restaurou ${item.title || item.name} da lixeira` });
  audit(req, { action: `${type.toUpperCase()}_RESTORE`, entity: `${type} ${id}`, workspaceId: req.workspace.id, category: type === 'project' ? 'projects' : 'tasks' });
  res.json({ success: true });
});

// Permanent deletion is irreversible and therefore needs explicit confirmation.
router.delete('/permanent', (req, res) => {
  const { collection, type, id } = target(req);
  if (req.body.confirm !== true) throw badRequest('Confirmação explícita obrigatória para exclusão permanente');
  const item = loadResource(req, collection, id, 'trash.purge', { includeDeleted: true });
  if (!item.deletedAt) throw badRequest('Apenas itens na lixeira podem ser excluídos permanentemente');

  ({ task: purgeTask, project: purgeProject, file: purgeFile })[type](id);
  audit(req, { action: `${type.toUpperCase()}_PERMANENT_DELETE`, entity: `${type} ${item.title || item.name} (${id})`, workspaceId: req.workspace.id, category: 'security' });
  res.json({ success: true });
});

export default router;
