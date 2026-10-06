// Creatives library (Criativos → Biblioteca) and the module's static metadata.
// Uploads are raw binary bodies (no base64 inflation); type, dimensions and
// duration are read from the bytes. Files are private and only served through
// these authorized routes.
import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource, rateLimit } from '../middleware/auth.js';
import { v, badRequest, conflict, notFound, forbidden, paginate } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { commitBeforeStreaming } from '../lib/runtime.js';
import { storeBuffer, readStored, deleteStored, streamStored, sanitizeFileName, extensionOf, formatSize, storageAvailable } from '../lib/storage.js';
import { inspectMedia, inspectThumbnail, MEDIA_TYPES } from '../lib/media.js';
import { roleHas } from '../lib/rbac.js';
import { PUBLICATION_TYPES, PUBLICATION_STATUSES, LIMITS } from '../lib/social/rules.js';
import { slimCreative } from '../lib/social/publications.js';

const router = express.Router();

// Upload pipeline limits (the Worker buffers the body in memory).
export const UPLOAD_LIMITS = { imageMaxBytes: 20 * 1024 * 1024, videoMaxBytes: 50 * 1024 * 1024, thumbMaxBytes: 512 * 1024 };
const ACTIVE_USE = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'FAILED'];
const TAG_RE = /^[\p{L}\p{N} _.-]{1,30}$/u;

function parseTags(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : [];
  const tags = [...new Set(list.map(t => String(t).trim()).filter(Boolean))];
  if (tags.length > 20) throw badRequest('No máximo 20 tags');
  tags.forEach(t => { if (!TAG_RE.test(t)) throw badRequest(`Tag inválida: ${t.slice(0, 30)}`); });
  return tags;
}

// Optional links must point inside the same workspace (no cross-tenant ids).
export function assertLinks(ws, { campaignId, projectId, taskId }) {
  if (campaignId && !db.find('campaigns', c => c.id === campaignId && c.workspaceId === ws.id && !c.deletedAt)) throw badRequest('Campanha inválida');
  if (projectId && !db.find('projects', p => p.id === projectId && p.workspaceId === ws.id && !p.deletedAt)) throw badRequest('Projeto inválido');
  if (taskId) {
    const task = db.find('tasks', t => t.id === taskId && t.workspaceId === ws.id && !t.deletedAt);
    if (!task) throw badRequest('Tarefa inválida');
    if (projectId && task.projectId !== projectId) throw badRequest('A tarefa não pertence ao projeto selecionado');
  }
}

function presentCreative(c) {
  const usage = db.filter('publications', p => !p.deletedAt && p.workspaceId === c.workspaceId && ((p.media || []).some(m => m.creativeId === c.id) || p.coverCreativeId === c.id));
  return {
    ...slimCreative(c),
    ext: c.ext, formattedSize: formatSize(c.size), tags: c.tags || [], campaignId: c.campaignId || null, projectId: c.projectId || null, taskId: c.taskId || null,
    createdBy: c.createdBy, createdByName: c.createdByName, createdAt: c.createdAt, updatedAt: c.updatedAt || null, archivedAt: c.archivedAt || null,
    usage: { total: usage.length, active: usage.filter(p => ACTIVE_USE.includes(p.status)).length, published: usage.filter(p => p.status === 'PUBLISHED').length }
  };
}

const canManage = (req, creative, perm) => roleHas(req.wsRole, perm) || (creative.createdBy === req.user.id && roleHas(req.wsRole, 'creatives.edit'));

// ------------------------------------------------------------------ meta

router.get('/meta', authenticate, (req, res) => {
  res.json({
    types: PUBLICATION_TYPES, statuses: PUBLICATION_STATUSES, limits: LIMITS,
    upload: { ...UPLOAD_LIMITS, extensions: Object.keys(MEDIA_TYPES) }
  });
});

router.patch('/workspace/:wsId/settings', authenticate, sessionOnly, workspaceAccess('creatives.manage_integrations'), (req, res) => {
  const ws = req.workspace;
  ws.settings = ws.settings || {};
  ws.settings.creatives = { ...(ws.settings.creatives || {}), requireApproval: req.body.requireApproval !== false };
  db.save();
  audit(req, { action: 'CREATIVES_SETTINGS_UPDATED', entity: `Workspace ${ws.name}`, workspaceId: ws.id, category: 'creatives', details: ws.settings.creatives });
  res.json({ settings: ws.settings.creatives });
});

router.get('/workspace/:wsId/settings', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  res.json({ settings: { requireApproval: req.workspace.settings?.creatives?.requireApproval !== false }, storageAvailable: storageAvailable() });
});

// --------------------------------------------------------------- library

router.get('/workspace/:wsId', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  const { kind, campaignId, projectId, tag, q, createdBy, from, to, archived, sort = 'recent' } = req.query;
  let list = db.filter('creatives', c => c.workspaceId === req.workspace.id && !c.deletedAt);
  list = list.filter(c => (archived === 'true' ? Boolean(c.archivedAt) : archived === 'all' ? true : !c.archivedAt));
  if (kind && kind !== 'ALL') list = list.filter(c => c.kind === kind);
  if (campaignId) list = list.filter(c => (campaignId === 'none' ? !c.campaignId : c.campaignId === campaignId));
  if (projectId) list = list.filter(c => c.projectId === projectId);
  if (tag) list = list.filter(c => (c.tags || []).includes(String(tag)));
  if (createdBy) list = list.filter(c => c.createdBy === createdBy);
  if (from) list = list.filter(c => c.createdAt.slice(0, 10) >= String(from));
  if (to) list = list.filter(c => c.createdAt.slice(0, 10) <= String(to));
  if (q) { const s = String(q).toLowerCase().slice(0, 100); list = list.filter(c => c.name.toLowerCase().includes(s) || (c.tags || []).some(t => t.toLowerCase().includes(s))); }
  list.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'size' ? (a, b) => b.size - a.size : (a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = paginate(list, req.query, { defaultLimit: 40, maxLimit: 100 });
  const tags = [...new Set(db.filter('creatives', c => c.workspaceId === req.workspace.id && !c.deletedAt).flatMap(c => c.tags || []))].sort();
  res.json({ creatives: page.items.map(presentCreative), total: page.total, page: page.page, totalPages: page.totalPages, tags });
});

// Raw upload: body = file bytes, X-File-Name = URI-encoded name.
router.post('/workspace/:wsId/upload', authenticate, sessionOnly, workspaceAccess('creatives.create'),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 120, key: req => `creative-upload:${req.user.id}` }),
  express.raw({ type: 'application/octet-stream', limit: UPLOAD_LIMITS.videoMaxBytes }), async (req, res) => {
    const ws = req.workspace;
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Envie o arquivo no corpo da requisição (application/octet-stream)');
    let name;
    try { name = sanitizeFileName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { throw badRequest('Nome de arquivo inválido'); }
    const ext = extensionOf(name);
    if (!MEDIA_TYPES[ext]) throw badRequest(`Formato .${ext || '?'} não aceito. Use JPG, PNG, WebP, GIF, MP4 ou MOV.`);
    const max = MEDIA_TYPES[ext].kind === 'video' ? UPLOAD_LIMITS.videoMaxBytes : UPLOAD_LIMITS.imageMaxBytes;
    if (req.body.length > max) throw badRequest(`O arquivo excede o limite de ${Math.round(max / 1048576)} MB`);
    let info;
    try { info = inspectMedia(req.body, ext); } catch (err) { throw badRequest(err.message); }

    const links = { campaignId: req.query.campaignId || null, projectId: req.query.projectId || null, taskId: req.query.taskId || null };
    assertLinks(ws, links);
    const tags = parseTags(req.query.tags);
    const storageKey = await storeBuffer('creatives', req.body, ext === 'jpeg' ? 'jpg' : ext, info.mime);
    const now = new Date().toISOString();
    const creative = {
      id: newId('crv'), workspaceId: ws.id, name, ext, mimeType: info.mime, kind: info.kind, size: req.body.length,
      width: info.width, height: info.height, durationMs: info.durationMs, warnings: info.warnings,
      storageKey, thumbKey: null, tags, ...links, createdBy: req.user.id, createdByName: req.user.name, createdAt: now, updatedAt: now,
      archivedAt: null, deletedAt: null
    };
    db.insert('creatives', creative);
    audit(req, { action: 'CREATIVE_CREATED', entity: `Criativo ${creative.name} (${formatSize(creative.size)})`, workspaceId: ws.id, category: 'creatives', details: { creativeId: creative.id, kind: creative.kind } });
    res.status(201).json({ creative: presentCreative(creative) });
  });

// Browser-generated JPEG thumbnail (keeps the library and feed light).
router.post('/:id/thumbnail', authenticate, sessionOnly, resource('creatives', 'creatives.create'),
  express.raw({ type: 'image/jpeg', limit: UPLOAD_LIMITS.thumbMaxBytes }), async (req, res) => {
    const creative = req.resource;
    if (!canManage(req, creative, 'creatives.edit')) throw forbidden();
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Miniatura ausente');
    try { inspectThumbnail(req.body); } catch (err) { throw badRequest(err.message); }
    const old = creative.thumbKey;
    creative.thumbKey = await storeBuffer('thumbs', req.body, 'jpg', 'image/jpeg');
    creative.updatedAt = new Date().toISOString();
    db.save();
    if (old) deleteStored(old);
    res.json({ creative: presentCreative(creative) });
  });

router.get('/:id', authenticate, resource('creatives', 'creatives.view'), (req, res) => {
  res.json({ creative: presentCreative(req.resource) });
});

router.get('/:id/file', authenticate, resource('creatives', 'creatives.view'), async (req, res) => {
  const c = req.resource;
  await commitBeforeStreaming(res);
  const ok = await streamStored(req, res, c.storageKey, { contentType: c.mimeType, fileName: c.name, disposition: req.query.download === '1' ? 'attachment' : 'inline' });
  if (!ok && !res.headersSent) res.status(410).json({ error: 'O arquivo deste criativo não está disponível', code: 'GONE' });
});

router.get('/:id/thumb', authenticate, resource('creatives', 'creatives.view'), async (req, res) => {
  const c = req.resource;
  await commitBeforeStreaming(res);
  // Images without a generated thumbnail fall back to the original file.
  const key = c.thumbKey || (c.kind !== 'video' ? c.storageKey : null);
  if (!key) return res.status(404).json({ error: 'Sem miniatura', code: 'NOT_FOUND' });
  const ok = await streamStored(req, res, key, { contentType: c.thumbKey ? 'image/jpeg' : c.mimeType, fileName: `thumb-${c.name}`, cache: 'private, max-age=86400' });
  if (!ok && !res.headersSent) res.status(404).end();
});

router.patch('/:id', authenticate, sessionOnly, resource('creatives', 'creatives.create'), (req, res) => {
  const c = req.resource;
  if (!canManage(req, c, 'creatives.edit')) throw forbidden();
  const ws = req.workspace;
  const updates = {};
  if (req.body.name !== undefined) {
    const name = sanitizeFileName(v.str(req.body.name, 'nome', { min: 1, max: 180, required: true }));
    if (extensionOf(name) !== extensionOf(c.name)) throw badRequest('A extensão do arquivo não pode ser alterada');
    updates.name = name;
  }
  if (req.body.tags !== undefined) updates.tags = parseTags(req.body.tags);
  const links = {};
  ['campaignId', 'projectId', 'taskId'].forEach(k => { if (req.body[k] !== undefined) links[k] = req.body[k] || null; });
  assertLinks(ws, { campaignId: links.campaignId, projectId: links.projectId ?? (links.taskId ? c.projectId : undefined), taskId: links.taskId });
  Object.assign(updates, links);
  if (req.body.archived !== undefined) updates.archivedAt = req.body.archived ? new Date().toISOString() : null;
  const updated = db.update('creatives', x => x.id === c.id, updates);
  audit(req, { action: 'CREATIVE_UPDATED', entity: `Criativo ${updated.name}`, workspaceId: ws.id, category: 'creatives', details: { creativeId: c.id, fields: Object.keys(updates) } });
  res.json({ creative: presentCreative(updated) });
});

router.post('/:id/duplicate', authenticate, sessionOnly, resource('creatives', 'creatives.create'), async (req, res) => {
  const c = req.resource;
  const bytes = await readStored(c.storageKey);
  if (!bytes) throw notFound('O arquivo original não está disponível');
  const thumb = c.thumbKey ? await readStored(c.thumbKey) : null;
  const now = new Date().toISOString();
  const base = c.name.replace(/\.[^.]+$/, '');
  const copy = {
    ...c, id: newId('crv'), name: `${base} (cópia).${c.ext}`.slice(0, 180),
    storageKey: await storeBuffer('creatives', bytes, c.storageKey.split('.').pop(), c.mimeType),
    thumbKey: thumb ? await storeBuffer('thumbs', thumb, 'jpg', 'image/jpeg') : null,
    createdBy: req.user.id, createdByName: req.user.name, createdAt: now, updatedAt: now, archivedAt: null
  };
  db.insert('creatives', copy);
  audit(req, { action: 'CREATIVE_DUPLICATED', entity: `Criativo ${copy.name}`, workspaceId: c.workspaceId, category: 'creatives', details: { from: c.id, creativeId: copy.id } });
  res.status(201).json({ creative: presentCreative(copy) });
});

router.delete('/:id', authenticate, sessionOnly, resource('creatives', 'creatives.create'), (req, res) => {
  const c = req.resource;
  if (!canManage(req, c, 'creatives.delete')) throw forbidden();
  const inUse = db.filter('publications', p => !p.deletedAt && p.workspaceId === c.workspaceId && ACTIVE_USE.includes(p.status) && ((p.media || []).some(m => m.creativeId === c.id) || p.coverCreativeId === c.id));
  if (inUse.length) throw conflict('Este criativo está em publicações ativas. Remova-o delas ou arquive o criativo.', { publications: inUse.map(p => ({ id: p.id, title: p.title, status: p.status })) });
  c.deletedAt = new Date().toISOString();
  const keys = [c.storageKey, c.thumbKey].filter(Boolean);
  c.storageKey = null;
  c.thumbKey = null;
  db.save();
  keys.forEach(deleteStored);
  audit(req, { action: 'CREATIVE_DELETED', entity: `Criativo ${c.name}`, workspaceId: c.workspaceId, category: 'creatives', details: { creativeId: c.id } });
  res.json({ success: true });
});

export default router;
