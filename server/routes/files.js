import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, resource, loadResource } from '../middleware/auth.js';
import { v, badRequest, notFound, HttpError } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { recordActivity } from '../lib/events.js';
import { decodeUpload, storeBuffer, readStored, PREVIEWABLE, formatSize, extensionOf, sanitizeFileName } from '../lib/storage.js';

const router = express.Router();
const ALLOWED = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json'];
const MAX_BYTES = 25 * 1024 * 1024;

const present = f => ({ ...f, storageKey: undefined, available: Boolean(f.storageKey), previewable: PREVIEWABLE.includes(f.mimeType) });

router.get('/project/:id', authenticate, resource('projects', 'project.view'), (req, res) => {
  const { q, type, taskId } = req.query;
  let files = db.filter('files', f => f.projectId === req.resource.id && !f.deletedAt);
  if (taskId) files = files.filter(f => f.taskId === taskId);
  if (q) files = files.filter(f => f.name.toLowerCase().includes(String(q).toLowerCase()));
  if (type && type !== 'ALL') {
    const groups = { image: ['image/'], pdf: ['application/pdf'], document: ['wordprocessingml', 'presentationml', 'text/'], spreadsheet: ['spreadsheetml', 'text/csv'], archive: ['application/zip'] };
    files = files.filter(f => (groups[type] || []).some(g => f.mimeType.includes(g)));
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ files: files.map(present) });
});

// Upload: JSON body { name, data (base64), taskId? }. Content is validated
// against the extension by magic bytes before anything is written to disk.
router.post('/project/:id', authenticate, express.json({ limit: '36mb' }), resource('projects', 'files.upload'), async (req, res) => {
  const project = req.resource;
  const taskId = req.body.taskId || null;
  if (taskId && !db.find('tasks', t => t.id === taskId && t.projectId === project.id && !t.deletedAt)) throw badRequest('Tarefa inválida para este projeto');
  const file = decodeUpload(req.body, { allowed: ALLOWED, maxBytes: MAX_BYTES });
  const storageKey = await storeBuffer('files', file.buffer, file.ext, file.mime);
  const record = {
    id: newId('file'), projectId: project.id, workspaceId: project.workspaceId, taskId,
    name: file.fileName, size: file.buffer.length, formattedSize: formatSize(file.buffer.length), mimeType: file.mime,
    storageKey, uploadedBy: req.user.name, uploadedById: req.user.id, createdAt: new Date().toISOString(), deletedAt: null
  };
  db.insert('files', record);
  recordActivity({ workspaceId: project.workspaceId, projectId: project.id, taskId, actor: req.user, type: 'file.uploaded', message: `anexou ${record.name}` });
  audit(req, { action: 'FILE_UPLOAD', entity: `Arquivo ${record.name} (${record.formattedSize})`, workspaceId: project.workspaceId, category: 'files' });
  res.status(201).json({ file: present(record) });
});

async function sendStored(req, res, inline) {
  const file = req.resource;
  const content = await readStored(file.storageKey);
  if (!content) throw new HttpError(410, 'O conteúdo deste arquivo não está disponível (registro de demonstração)', 'GONE');
  const canInline = inline && PREVIEWABLE.includes(file.mimeType);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Sandbox previews so uploaded content can never run scripts in our origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Content-Disposition', `${canInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(content);
}

router.get('/:id/download', authenticate, resource('files', 'project.view'), (req, res) => sendStored(req, res, false));
router.get('/:id/preview', authenticate, resource('files', 'project.view'), (req, res) => sendStored(req, res, true));

router.put('/:id', authenticate, resource('files', 'files.upload'), (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) {
    const name = sanitizeFileName(v.str(req.body.name, 'nome', { min: 1, max: 180, required: true }));
    if (extensionOf(name) !== extensionOf(req.resource.name)) throw badRequest('A extensão do arquivo não pode ser alterada');
    updates.name = name;
  }
  if (req.body.taskId !== undefined) {
    if (req.body.taskId && !db.find('tasks', t => t.id === req.body.taskId && t.projectId === req.resource.projectId)) throw badRequest('Tarefa inválida');
    updates.taskId = req.body.taskId || null;
  }
  const updated = db.update('files', f => f.id === req.resource.id, updates);
  res.json({ file: present(updated) });
});

router.delete('/:id', authenticate, resource('files', 'files.upload'), (req, res) => {
  const file = req.resource;
  // Members may delete their own uploads; others need files.delete.
  if (file.uploadedById !== req.user.id) loadResource(req, 'files', file.id, 'files.delete');
  db.update('files', f => f.id === file.id, { deletedAt: new Date().toISOString(), deletedBy: req.user.id });
  recordActivity({ workspaceId: file.workspaceId, projectId: file.projectId, taskId: file.taskId, actor: req.user, type: 'file.deleted', message: `moveu ${file.name} para a lixeira` });
  audit(req, { action: 'FILE_SOFT_DELETE', entity: `Arquivo ${file.name}`, workspaceId: file.workspaceId, category: 'files' });
  res.json({ success: true });
});

export default router;
