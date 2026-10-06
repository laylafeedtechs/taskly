// Publications (Criativos → Feed, Calendário, Publicações, Aprovações,
// Publicados). Every state change goes through the lifecycle in
// server/lib/social/publications.js; scheduling is handled by the backend
// scheduler (server/lib/social/scheduler.js), never by the browser.
import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource, loadResource, rateLimit } from '../middleware/auth.js';
import { v, badRequest, conflict, forbidden, paginate, HttpError } from '../lib/http.js';
import { roleHas } from '../lib/rbac.js';
import { background } from '../lib/runtime.js';
import { PUBLICATION_TYPES, PUBLICATION_STATUSES } from '../lib/social/rules.js';
import {
  presentPublication, problemsFor, afterTransition, recordApproval, requiresApproval,
  CONTENT_EDITABLE, CANCELLABLE
} from '../lib/social/publications.js';
import { runPublicationScheduler, schedulerHealth } from '../lib/social/scheduler.js';
import { assertLinks } from './creatives.js';

const router = express.Router();
const CONTENT_FIELDS = ['type', 'media', 'coverCreativeId', 'caption', 'hashtags', 'location', 'shareToFeed', 'socialAccountId'];
const CAPABILITY = { POST: 'canPublishPost', CAROUSEL: 'canPublishCarousel', REEL: 'canPublishReel', STORY: 'canPublishStory' };
const HASHTAG_RE = /^[\p{L}\p{N}_]{1,100}$/u;
const TAG_RE = /^[\p{L}\p{N} _.-]{1,30}$/u;
const MIN_LEAD_MS = 60 * 1000;

const effectiveDate = p => p.publishedAt || p.scheduledAt || null;
const nowIso = () => new Date().toISOString();
const requiresConfirmation = (message, details) => new HttpError(409, message, 'REQUIRES_CONFIRMATION', details);

function invalid(problems) {
  return new HttpError(400, problems[0]?.message || 'Publicação inválida', 'PUBLICATION_INVALID', { problems });
}

// --------------------------------------------------------------- parsing

function parseHashtags(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const tags = [...new Set(list.map(t => String(t).trim().replace(/^#+/, '')).filter(Boolean))];
  if (tags.length > 30) throw badRequest('No máximo 30 hashtags');
  tags.forEach(t => { if (!HASHTAG_RE.test(t)) throw badRequest(`Hashtag inválida: #${t.slice(0, 40)}`); });
  return tags;
}

function parseDateTime(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw badRequest(`Data e hora inválidas em "${field}"`);
  return new Date(value).toISOString();
}

const isMember = (ws, userId) => ws.ownerId === userId || ws.members.some(m => m.userId === userId);

// Only whitelisted fields are read from the body (no mass assignment).
function parseInput(body, ws) {
  const out = {};
  if (body.title !== undefined) out.title = v.str(body.title, 'título', { max: 120 }) || '';
  if (body.socialAccountId !== undefined) {
    const account = db.find('socialAccounts', a => a.id === body.socialAccountId && a.workspaceId === ws.id && a.status !== 'DISCONNECTED');
    if (!account) throw badRequest('Conta inválida ou desconectada');
    out.socialAccountId = account.id;
  }
  if (body.type !== undefined) out.type = v.oneOf(body.type, 'tipo', Object.keys(PUBLICATION_TYPES), { required: true });
  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) throw badRequest('Mídias inválidas');
    if (body.media.length > 10) throw badRequest('No máximo 10 mídias');
    const ids = body.media.map(m => (typeof m === 'string' ? m : m?.creativeId));
    if (new Set(ids).size !== ids.length) throw badRequest('O mesmo criativo aparece mais de uma vez');
    ids.forEach(id => { if (!db.find('creatives', c => c.id === id && c.workspaceId === ws.id && !c.deletedAt)) throw badRequest('Criativo inválido'); });
    out.media = ids.map((creativeId, order) => ({ creativeId, order }));
  }
  if (body.coverCreativeId !== undefined) {
    out.coverCreativeId = body.coverCreativeId || null;
    if (out.coverCreativeId && !db.find('creatives', c => c.id === out.coverCreativeId && c.workspaceId === ws.id && !c.deletedAt)) throw badRequest('Capa inválida');
  }
  if (body.caption !== undefined) out.caption = v.str(body.caption, 'legenda', { max: 2200, trim: false }) || '';
  if (body.hashtags !== undefined) out.hashtags = parseHashtags(body.hashtags);
  if (body.location !== undefined) {
    if (!body.location || (!body.location.name && !body.location.id)) out.location = null;
    else {
      out.location = { name: v.str(body.location.name || '', 'localização', { max: 100 }) || '', id: body.location.id ? v.str(String(body.location.id), 'ID da localização', { max: 30 }) : null };
      if (out.location.id && !/^\d+$/.test(out.location.id)) throw badRequest('O ID de localização precisa ser numérico (ID de página do Facebook)');
    }
  }
  if (body.shareToFeed !== undefined) out.shareToFeed = body.shareToFeed !== false;
  ['campaignId', 'projectId', 'taskId'].forEach(k => { if (body[k] !== undefined) out[k] = body[k] || null; });
  if (body.responsibleId !== undefined) {
    out.responsibleId = body.responsibleId || null;
    if (out.responsibleId && !isMember(ws, out.responsibleId)) throw badRequest('Responsável inválido');
  }
  if (body.tags !== undefined) {
    const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map(t => String(t).trim()).filter(Boolean))];
    if (tags.length > 20) throw badRequest('No máximo 20 tags');
    tags.forEach(t => { if (!TAG_RE.test(t)) throw badRequest('Tag inválida'); });
    out.tags = tags;
  }
  if (body.scheduledAt !== undefined) out.scheduledAt = parseDateTime(body.scheduledAt, 'data de publicação');
  return out;
}

function checkLinks(ws, pub) {
  assertLinks(ws, { campaignId: pub.campaignId, projectId: pub.projectId, taskId: pub.taskId });
}

// Everything that must hold before a publication may enter SCHEDULED.
function assertPublishable(pub, { at }) {
  const problems = problemsFor(pub);
  if (problems.length) throw invalid(problems);
  const account = db.find('socialAccounts', a => a.id === pub.socialAccountId && a.workspaceId === pub.workspaceId);
  if (!account || account.status !== 'CONNECTED') throw new HttpError(409, 'A conta precisa estar conectada para agendar ou publicar.', 'ACCOUNT_NOT_CONNECTED');
  if (!account.capabilities?.[CAPABILITY[pub.type]]) throw new HttpError(409, `A integração desta conta não permite publicar ${PUBLICATION_TYPES[pub.type].label.toLowerCase()}.`, 'CAPABILITY_MISSING');
  if (!at) throw badRequest('Defina a data e o horário da publicação');
}

function touch(pub, req) { pub.updatedAt = nowIso(); pub.updatedBy = req.user.id; }

function resetPublishing(pub) {
  pub.publishing = { attempts: pub.publishing?.attempts || 0 };
  pub.error = null;
}

const perm = (req, p) => roleHas(req.wsRole, p);
const requirePerm = (req, p) => { if (!perm(req, p)) throw forbidden('Seu papel neste workspace não permite esta ação'); };

// ------------------------------------------------------------------ list

function filterList(req) {
  const { accountId, status, type, campaignId, projectId, responsibleId, tag, from, to, q, approval, taskId } = req.query;
  let list = db.filter('publications', p => p.workspaceId === req.workspace.id && !p.deletedAt);
  if (accountId) list = list.filter(p => p.socialAccountId === accountId);
  if (status && status !== 'ALL') { const set = new Set(String(status).split(',')); list = list.filter(p => set.has(p.status)); }
  if (type && type !== 'ALL') list = list.filter(p => p.type === type);
  if (campaignId) list = list.filter(p => (campaignId === 'none' ? !p.campaignId : p.campaignId === campaignId));
  if (projectId) list = list.filter(p => p.projectId === projectId);
  if (taskId) list = list.filter(p => p.taskId === taskId);
  if (responsibleId) list = list.filter(p => p.responsibleId === responsibleId);
  if (tag) list = list.filter(p => (p.tags || []).includes(String(tag)));
  if (approval) list = list.filter(p => p.approval?.state === approval);
  if (from) list = list.filter(p => effectiveDate(p) && effectiveDate(p) >= String(from));
  if (to) list = list.filter(p => effectiveDate(p) && effectiveDate(p) <= String(to));
  if (q) { const s = String(q).toLowerCase().slice(0, 100); list = list.filter(p => `${p.title} ${p.caption} ${(p.hashtags || []).join(' ')}`.toLowerCase().includes(s)); }
  return list;
}

const SORTS = {
  date: (a, b) => String(effectiveDate(a) || '9999').localeCompare(String(effectiveDate(b) || '9999')),
  '-date': (a, b) => String(effectiveDate(b) || '').localeCompare(String(effectiveDate(a) || '')),
  updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
  title: (a, b) => String(a.title).localeCompare(String(b.title)),
  status: (a, b) => PUBLICATION_STATUSES.indexOf(a.status) - PUBLICATION_STATUSES.indexOf(b.status)
};

router.get('/workspace/:wsId', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  const list = filterList(req).sort(SORTS[req.query.sort] || SORTS.updated);
  const page = paginate(list, req.query, { defaultLimit: 50, maxLimit: 200 });
  res.json({ publications: page.items.map(presentPublication), total: page.total, page: page.page, totalPages: page.totalPages });
});

// Dashboard numbers for the hub (whole workspace) or one account.
router.get('/workspace/:wsId/overview', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  const { accountId } = req.query;
  const all = db.filter('publications', p => p.workspaceId === req.workspace.id && !p.deletedAt && (!accountId || p.socialAccountId === accountId));
  const now = new Date();
  const monthKey = d => d.slice(0, 7);
  const thisMonth = now.toISOString().slice(0, 7);
  const live = all.filter(p => p.status !== 'CANCELLED');
  const months = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, count: live.filter(p => effectiveDate(p) && monthKey(effectiveDate(p)) === key).length });
  }
  const nowStr = now.toISOString();
  res.json({
    metrics: {
      thisMonth: live.filter(p => effectiveDate(p) && monthKey(effectiveDate(p)) === thisMonth).length,
      scheduled: all.filter(p => p.status === 'SCHEDULED').length,
      pendingApproval: all.filter(p => p.status === 'PENDING_APPROVAL').length,
      published: all.filter(p => p.status === 'PUBLISHED').length,
      publishedThisMonth: all.filter(p => p.status === 'PUBLISHED' && monthKey(p.publishedAt || '') === thisMonth).length,
      failed: all.filter(p => p.status === 'FAILED').length,
      drafts: all.filter(p => p.status === 'DRAFT').length,
      activeCampaigns: db.filter('campaigns', c => c.workspaceId === req.workspace.id && !c.deletedAt && c.status === 'ACTIVE' && (!accountId || !c.socialAccountId || c.socialAccountId === accountId)).length
    },
    upcoming: all.filter(p => ['SCHEDULED', 'APPROVED', 'PUBLISHING'].includes(p.status) && p.scheduledAt && p.scheduledAt >= new Date(Date.now() - 3600000).toISOString())
      .sort(SORTS.date).slice(0, 10).map(presentPublication),
    attention: all.filter(p => p.status === 'FAILED' || (p.status === 'SCHEDULED' && p.scheduledAt < nowStr && !p.publishing?.nextAttemptAt)).slice(0, 10).map(presentPublication),
    months,
    health: schedulerHealth(req.workspace.id)
  });
});

// Feed planner: planned (future) feed items in planned order + published ones.
router.get('/workspace/:wsId/feed', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  const { accountId } = req.query;
  if (!accountId || !db.find('socialAccounts', a => a.id === accountId && a.workspaceId === req.workspace.id)) throw badRequest('Conta inválida');
  const inFeed = p => PUBLICATION_TYPES[p.type]?.inFeed && !(p.type === 'REEL' && p.shareToFeed === false);
  const pubs = db.filter('publications', p => p.workspaceId === req.workspace.id && p.socialAccountId === accountId && !p.deletedAt && inFeed(p));
  const planned = pubs.filter(p => !['PUBLISHED', 'CANCELLED'].includes(p.status))
    .sort((a, b) => (a.feedPosition ?? Infinity) - (b.feedPosition ?? Infinity) || String(effectiveDate(b) || '9999').localeCompare(String(effectiveDate(a) || '9999')));
  const published = pubs.filter(p => p.status === 'PUBLISHED').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const known = new Set(published.map(p => p.externalId).filter(Boolean));
  const external = db.filter('socialMedia', m => m.accountId === accountId && !known.has(m.externalId))
    .map(m => ({ id: m.id, externalId: m.externalId, mediaType: m.mediaType, caption: m.caption, permalink: m.permalink, timestamp: m.timestamp, hasPreview: Boolean(m.previewKey) }));
  // Does the planned order disagree with the scheduled dates?
  const dated = planned.filter(p => p.scheduledAt);
  const mismatch = dated.some((p, i) => i > 0 && dated[i - 1].scheduledAt < p.scheduledAt);
  res.json({ planned: planned.map(presentPublication), published: published.map(presentPublication), external, orderMatchesSchedule: !mismatch });
});

// Visual planning only: stores the planned order, never touches dates.
router.put('/workspace/:wsId/feed-order', authenticate, sessionOnly, workspaceAccess('creatives.edit'), (req, res) => {
  const { accountId } = req.body;
  const order = v.strArray(req.body.order, 'ordem', { maxItems: 500, maxLen: 40 }) || [];
  const pubs = order.map(id => db.find('publications', p => p.id === id && p.workspaceId === req.workspace.id && p.socialAccountId === accountId && !p.deletedAt));
  if (pubs.some(p => !p)) throw badRequest('Ordem contém publicações inválidas');
  if (pubs.some(p => p.status === 'PUBLISHED')) throw badRequest('Publicações já publicadas não podem ser reordenadas');
  pubs.forEach((p, i) => { p.feedPosition = i + 1; });
  db.save();
  res.json({ success: true });
});

// Applies the planned order to the schedule: the existing dates are kept but
// redistributed so the top of the grid is the latest. Requires confirmation.
router.post('/workspace/:wsId/feed-apply-dates', authenticate, sessionOnly, workspaceAccess('creatives.edit'), (req, res) => {
  const { accountId } = req.body;
  const order = v.strArray(req.body.order, 'ordem', { maxItems: 500, maxLen: 40 }) || [];
  const pubs = order.map(id => db.find('publications', p => p.id === id && p.workspaceId === req.workspace.id && p.socialAccountId === accountId && !p.deletedAt))
    .filter(p => p && p.scheduledAt && !['PUBLISHED', 'PUBLISHING', 'CANCELLED'].includes(p.status));
  if (pubs.some(p => p.status === 'SCHEDULED')) requirePerm(req, 'creatives.publish');
  const dates = pubs.map(p => p.scheduledAt).sort().reverse(); // latest first = top of the grid
  const changes = pubs.map((p, i) => ({ pub: p, from: p.scheduledAt, to: dates[i] })).filter(c => c.from !== c.to);
  if (changes.some(c => c.pub.status === 'SCHEDULED' && Date.parse(c.to) < Date.now() + MIN_LEAD_MS)) throw badRequest('Uma das novas datas já passou; ajuste o agendamento manualmente');
  if (!req.body.confirm) throw requiresConfirmation(`${changes.length} publicação(ões) terão data/horário alterados.`, { changes: changes.map(c => ({ id: c.pub.id, title: c.pub.title, from: c.from, to: c.to, status: c.pub.status })) });
  changes.forEach(c => {
    c.pub.scheduledAt = c.to;
    touch(c.pub, req);
    if (c.pub.status === 'SCHEDULED') afterTransition(req, c.pub, 'publication.rescheduled', { previousStatus: 'SCHEDULED', details: { from: c.from, to: c.to, reason: 'feed planner' } });
  });
  db.save();
  res.json({ changed: changes.length });
});

// ------------------------------------------------------------------ CRUD

router.post('/workspace/:wsId', authenticate, sessionOnly, workspaceAccess('creatives.create'), (req, res) => {
  const ws = req.workspace;
  const data = parseInput(req.body, ws);
  if (!data.socialAccountId) throw badRequest('Escolha a conta do Instagram');
  const now = nowIso();
  const pub = {
    id: newId('pub'), workspaceId: ws.id, socialAccountId: data.socialAccountId,
    title: '', type: 'POST', media: [], coverCreativeId: null, caption: '', hashtags: [], location: null, shareToFeed: true,
    campaignId: null, projectId: null, taskId: null, responsibleId: req.user.id, tags: [], scheduledAt: null,
    ...data,
    status: 'DRAFT', approval: null, feedPosition: null, publishedAt: null, externalId: null, permalink: null, error: null,
    publishing: { attempts: 0 }, createdBy: req.user.id, updatedBy: req.user.id, createdAt: now, updatedAt: now, deletedAt: null
  };
  if (!pub.title) pub.title = `${PUBLICATION_TYPES[pub.type].label} — ${new Date(pub.scheduledAt || now).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  checkLinks(ws, pub);
  db.insert('publications', pub);
  afterTransition(req, pub, 'publication.created');
  res.status(201).json({ publication: presentPublication(pub) });
});

router.get('/by-task/:taskId', authenticate, (req, res) => {
  const task = loadResource(req, 'tasks', req.params.taskId, 'project.view');
  if (!perm(req, 'creatives.view')) return res.json({ publications: [] });
  res.json({ publications: db.filter('publications', p => p.taskId === task.id && p.workspaceId === task.workspaceId && !p.deletedAt).map(presentPublication) });
});

router.get('/:id', authenticate, resource('publications', 'creatives.view'), (req, res) => {
  res.json({ publication: presentPublication(req.resource) });
});

// Full story of a publication: who did what, when, every attempt and error.
router.get('/:id/history', authenticate, resource('publications', 'creatives.view'), (req, res) => {
  const pub = req.resource;
  const approvals = db.filter('publicationApprovals', a => a.publicationId === pub.id);
  const attempts = db.filter('publicationAttempts', a => a.publicationId === pub.id).sort((a, b) => b.attempt - a.attempt);
  const events = db.filter('auditLogs', l => l.workspaceId === pub.workspaceId && l.details?.publicationId === pub.id)
    .map(l => ({ id: l.id, action: l.action, actor: l.actor, actorId: l.actorId, timestamp: l.timestamp, result: l.result, details: { from: l.details.from, to: l.details.to, reason: l.details.reason, externalId: l.details.externalId } }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ approvals, attempts, events });
});

router.get('/:id/attempts', authenticate, resource('publications', 'creatives.view'), (req, res) => {
  res.json({ attempts: db.filter('publicationAttempts', a => a.publicationId === req.resource.id).sort((a, b) => b.attempt - a.attempt) });
});

router.patch('/:id', authenticate, sessionOnly, resource('publications', 'creatives.edit'), (req, res) => {
  const ws = req.workspace;
  const pub = req.resource;
  if (pub.status === 'PUBLISHING') throw conflict('A publicação está sendo enviada ao Instagram neste momento.');
  const patch = parseInput(req.body, ws);
  const changed = k => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(pub[k]);
  const contentChanged = CONTENT_FIELDS.some(changed);
  const dateChanged = changed('scheduledAt');
  if (pub.status === 'PUBLISHED' && (contentChanged || dateChanged)) throw conflict('Publicações já publicadas não podem ter conteúdo ou data alterados.');
  if (pub.status === 'CANCELLED' && (contentChanged || dateChanged)) throw conflict('Reabra a publicação para editá-la.');
  if (pub.status === 'SCHEDULED' && (contentChanged || dateChanged)) requirePerm(req, 'creatives.publish');
  if (dateChanged && pub.status === 'SCHEDULED') {
    if (!patch.scheduledAt) throw badRequest('Para remover a data, desfaça o agendamento');
    if (Date.parse(patch.scheduledAt) < Date.now() + MIN_LEAD_MS) throw badRequest('Escolha um horário futuro');
    if (!req.body.confirmReschedule) throw requiresConfirmation('Esta publicação já está agendada. Confirme o novo horário.', { from: pub.scheduledAt, to: patch.scheduledAt });
  }
  const resetApproval = contentChanged && ['APPROVED', 'SCHEDULED'].includes(pub.status) && requiresApproval(ws);
  if (resetApproval && !req.body.confirmReset) throw requiresConfirmation('Alterar o conteúdo remove a aprovação e o agendamento atuais. A publicação volta para rascunho.');

  const before = { status: pub.status, scheduledAt: pub.scheduledAt };
  Object.assign(pub, patch);
  checkLinks(ws, pub);
  if (contentChanged) resetPublishing(pub); // containers were built from the old content
  if (resetApproval) {
    pub.status = 'DRAFT';
    pub.approval = { state: 'RESET', reason: 'Conteúdo alterado após a aprovação', at: nowIso(), by: req.user.id };
    recordApproval(pub, 'RESET', req.user, 'Conteúdo alterado após a aprovação');
  }
  if (pub.status === 'SCHEDULED') {
    const problems = problemsFor(pub);
    if (problems.length) throw invalid(problems);
  }
  touch(pub, req);
  db.save();
  if (dateChanged && before.status === 'SCHEDULED' && pub.status === 'SCHEDULED') afterTransition(req, pub, 'publication.rescheduled', { previousStatus: 'SCHEDULED', details: { from: before.scheduledAt, to: pub.scheduledAt } });
  else afterTransition(req, pub, 'publication.edited', { previousStatus: before.status, details: { fields: Object.keys(patch), approvalReset: resetApproval } });
  res.json({ publication: presentPublication(pub) });
});

router.delete('/:id', authenticate, sessionOnly, resource('publications', 'creatives.edit'), (req, res) => {
  const pub = req.resource;
  const ownDraft = pub.status === 'DRAFT' && pub.createdBy === req.user.id;
  if (!ownDraft) requirePerm(req, 'creatives.delete');
  if (pub.status === 'SCHEDULED') throw conflict('Cancele o agendamento antes de excluir.');
  if (pub.status === 'PUBLISHING') throw conflict('A publicação está sendo enviada ao Instagram neste momento.');
  pub.deletedAt = nowIso();
  touch(pub, req);
  db.save();
  afterTransition(req, pub, 'publication.deleted', { previousStatus: pub.status, details: { note: pub.status === 'PUBLISHED' ? 'Removida do Taskly; o post continua no Instagram' : undefined } });
  res.json({ success: true });
});

router.post('/:id/duplicate', authenticate, sessionOnly, resource('publications', 'creatives.create'), (req, res) => {
  const ws = req.workspace;
  const src = req.resource;
  const overrides = parseInput({
    scheduledAt: req.body.scheduledAt, campaignId: req.body.campaignId, responsibleId: req.body.responsibleId, socialAccountId: req.body.socialAccountId
  }, ws);
  const now = nowIso();
  const copy = {
    ...src, ...overrides,
    id: newId('pub'), title: `${src.title || 'Publicação'} (cópia)`.slice(0, 120), status: 'DRAFT', approval: null, feedPosition: null,
    media: (src.media || []).map(m => ({ ...m })), hashtags: [...(src.hashtags || [])], tags: [...(src.tags || [])],
    scheduledAt: overrides.scheduledAt !== undefined ? overrides.scheduledAt : null,
    publishedAt: null, externalId: null, permalink: null, error: null, publishing: { attempts: 0 },
    createdBy: req.user.id, updatedBy: req.user.id, createdAt: now, updatedAt: now, deletedAt: null
  };
  checkLinks(ws, copy);
  db.insert('publications', copy);
  afterTransition(req, copy, 'publication.created', { details: { duplicatedFrom: src.id } });
  res.status(201).json({ publication: presentPublication(copy) });
});

// ------------------------------------------------------------ transitions

function transition(name, permission, handler) {
  router.post(`/:id/${name}`, authenticate, sessionOnly, resource('publications', permission),
    rateLimit({ windowMs: 60 * 1000, max: 60, key: req => `pub-action:${req.user.id}` }), (req, res) => {
      const pub = req.resource;
      const previousStatus = pub.status;
      const event = handler(req, pub);
      touch(pub, req);
      db.save();
      if (event) afterTransition(req, pub, event, { previousStatus, reason: req.body?.reason || null });
      res.json({ publication: presentPublication(pub) });
    });
}

transition('submit', 'creatives.edit', (req, pub) => {
  if (pub.status !== 'DRAFT') throw conflict('Somente rascunhos podem ser enviados para aprovação.');
  const problems = problemsFor(pub);
  if (problems.length) throw invalid(problems);
  pub.status = 'PENDING_APPROVAL';
  pub.approval = { state: 'PENDING', requestedBy: req.user.id, requestedAt: nowIso() };
  recordApproval(pub, 'REQUESTED', req.user);
  return 'publication.submitted';
});

transition('withdraw', 'creatives.edit', (req, pub) => {
  if (pub.status !== 'PENDING_APPROVAL') throw conflict('A publicação não está aguardando aprovação.');
  pub.status = 'DRAFT';
  pub.approval = { ...pub.approval, state: 'WITHDRAWN', decidedBy: req.user.id, decidedAt: nowIso() };
  recordApproval(pub, 'WITHDRAWN', req.user);
  return 'publication.edited';
});

transition('approve', 'creatives.approve', (req, pub) => {
  if (pub.status !== 'PENDING_APPROVAL') throw conflict('Somente publicações aguardando aprovação podem ser aprovadas.');
  const note = v.str(req.body.comment, 'comentário', { max: 500 }) || null;
  pub.status = 'APPROVED';
  pub.approval = { ...pub.approval, state: 'APPROVED', decidedBy: req.user.id, decidedByName: req.user.name, decidedAt: nowIso(), comment: note };
  recordApproval(pub, 'APPROVED', req.user, note);
  return 'publication.approved';
});

transition('reject', 'creatives.approve', (req, pub) => {
  if (pub.status !== 'PENDING_APPROVAL') throw conflict('Somente publicações aguardando aprovação podem ser rejeitadas.');
  const reason = v.str(req.body.reason, 'motivo', { min: 3, max: 1000, required: true });
  pub.status = 'DRAFT'; // back to editing
  pub.approval = { ...pub.approval, state: 'REJECTED', decidedBy: req.user.id, decidedByName: req.user.name, decidedAt: nowIso(), reason };
  recordApproval(pub, 'REJECTED', req.user, reason);
  return 'publication.rejected';
});

transition('schedule', 'creatives.publish', (req, pub) => {
  const ws = req.workspace;
  if (req.body.scheduledAt !== undefined) pub.scheduledAt = parseDateTime(req.body.scheduledAt, 'data de publicação');
  const allowed = requiresApproval(ws) ? ['APPROVED'] : ['APPROVED', 'DRAFT'];
  if (!allowed.includes(pub.status)) throw conflict(requiresApproval(ws) ? 'A publicação precisa ser aprovada antes de ser agendada.' : 'Esta publicação não pode ser agendada no status atual.');
  assertPublishable(pub, { at: pub.scheduledAt });
  if (Date.parse(pub.scheduledAt) < Date.now() + MIN_LEAD_MS) throw badRequest('Escolha um horário futuro (ou use "Publicar agora")');
  pub.status = 'SCHEDULED';
  resetPublishing(pub);
  pub.publishing.autoRetries = 0;
  return 'publication.scheduled';
});

transition('unschedule', 'creatives.publish', (req, pub) => {
  if (pub.status !== 'SCHEDULED') throw conflict('A publicação não está agendada.');
  pub.status = pub.approval?.state === 'APPROVED' ? 'APPROVED' : 'DRAFT';
  resetPublishing(pub);
  return 'publication.unscheduled';
});

router.post('/:id/publish', authenticate, sessionOnly, resource('publications', 'creatives.publish'),
  rateLimit({ windowMs: 60 * 1000, max: 20, key: req => `pub-now:${req.user.id}` }), (req, res) => {
    const pub = req.resource;
    const ws = req.workspace;
    const allowed = requiresApproval(ws) ? ['APPROVED', 'SCHEDULED'] : ['APPROVED', 'SCHEDULED', 'DRAFT'];
    if (!allowed.includes(pub.status)) throw conflict(requiresApproval(ws) ? 'A publicação precisa ser aprovada antes de ser publicada.' : 'Esta publicação não pode ser publicada no status atual.');
    const previousStatus = pub.status;
    pub.scheduledAt = nowIso();
    assertPublishable(pub, { at: pub.scheduledAt });
    pub.status = 'SCHEDULED';
    resetPublishing(pub);
    pub.publishing.autoRetries = 0;
    touch(pub, req);
    db.save();
    afterTransition(req, pub, 'publication.scheduled', { previousStatus, details: { immediate: true } });
    res.json({ publication: presentPublication(pub), queued: true });
    // The backend worker takes it from here (also picked up by the next cron tick).
    background(Promise.resolve().then(() => runPublicationScheduler()));
  });

transition('cancel', 'creatives.edit', (req, pub) => {
  if (pub.status === 'PUBLISHING') throw conflict('A publicação já está sendo enviada ao Instagram e não pode ser cancelada.');
  if (!CANCELLABLE.includes(pub.status)) throw conflict('Esta publicação não pode ser cancelada.');
  if (pub.status === 'SCHEDULED') requirePerm(req, 'creatives.publish');
  pub.status = 'CANCELLED';
  pub.cancelledAt = nowIso();
  pub.cancelledBy = req.user.id;
  resetPublishing(pub);
  return 'publication.cancelled';
});

transition('reopen', 'creatives.edit', (req, pub) => {
  if (pub.status !== 'CANCELLED') throw conflict('Somente publicações canceladas podem ser reabertas.');
  pub.status = 'DRAFT';
  pub.approval = null;
  return 'publication.reopened';
});

transition('retry', 'creatives.publish', (req, pub) => {
  if (pub.status !== 'FAILED') throw conflict('Somente publicações com falha podem ser reenviadas.');
  const at = req.body.scheduledAt ? parseDateTime(req.body.scheduledAt, 'data de publicação') : nowIso();
  pub.scheduledAt = at;
  assertPublishable(pub, { at });
  pub.status = 'SCHEDULED';
  pub.error = null;
  pub.publishing = { ...pub.publishing, autoRetries: 0, nextAttemptAt: null, lockId: null, lockedUntil: null, phase: 'RETRY_REQUESTED' };
  if (at <= nowIso()) background(Promise.resolve().then(() => runPublicationScheduler()));
  return 'publication.retry';
});

// ------------------------------------------------------------------ bulk

const BULK = {
  APPROVE: { permission: 'creatives.approve', confirm: true },
  REJECT: { permission: 'creatives.approve', confirm: true },
  DELETE: { permission: 'creatives.delete', confirm: true },
  MOVE_CAMPAIGN: { permission: 'creatives.edit' },
  SET_RESPONSIBLE: { permission: 'creatives.edit' }
};

router.post('/workspace/:wsId/bulk', authenticate, sessionOnly, workspaceAccess('creatives.view'), (req, res) => {
  const ws = req.workspace;
  const action = v.oneOf(req.body.action, 'ação', Object.keys(BULK), { required: true });
  const ids = v.strArray(req.body.ids, 'publicações', { maxItems: 100, maxLen: 40 }) || [];
  if (!ids.length) throw badRequest('Selecione ao menos uma publicação');
  requirePerm(req, BULK[action].permission);
  if (BULK[action].confirm && req.body.confirm !== true) throw requiresConfirmation(`Confirme a ação em ${ids.length} publicação(ões).`);
  const reason = action === 'REJECT' ? v.str(req.body.reason, 'motivo', { min: 3, max: 1000, required: true }) : null;
  if (action === 'MOVE_CAMPAIGN' && req.body.value && !db.find('campaigns', c => c.id === req.body.value && c.workspaceId === ws.id && !c.deletedAt)) throw badRequest('Campanha inválida');
  if (action === 'SET_RESPONSIBLE' && req.body.value && !isMember(ws, req.body.value)) throw badRequest('Responsável inválido');

  const results = ids.map(id => {
    const pub = db.find('publications', p => p.id === id && p.workspaceId === ws.id && !p.deletedAt);
    if (!pub) return { id, ok: false, error: 'Não encontrada' };
    const previousStatus = pub.status;
    let event = null;
    if (action === 'APPROVE') {
      if (pub.status !== 'PENDING_APPROVAL') return { id, ok: false, error: 'Não está aguardando aprovação' };
      pub.status = 'APPROVED';
      pub.approval = { ...pub.approval, state: 'APPROVED', decidedBy: req.user.id, decidedByName: req.user.name, decidedAt: nowIso(), bulk: true };
      recordApproval(pub, 'APPROVED', req.user, 'Aprovação em lote');
      event = 'publication.approved';
    } else if (action === 'REJECT') {
      if (pub.status !== 'PENDING_APPROVAL') return { id, ok: false, error: 'Não está aguardando aprovação' };
      pub.status = 'DRAFT';
      pub.approval = { ...pub.approval, state: 'REJECTED', decidedBy: req.user.id, decidedByName: req.user.name, decidedAt: nowIso(), reason, bulk: true };
      recordApproval(pub, 'REJECTED', req.user, reason);
      event = 'publication.rejected';
    } else if (action === 'DELETE') {
      if (['SCHEDULED', 'PUBLISHING'].includes(pub.status)) return { id, ok: false, error: 'Cancele o agendamento antes de excluir' };
      pub.deletedAt = nowIso();
      event = 'publication.deleted';
    } else if (action === 'MOVE_CAMPAIGN') {
      pub.campaignId = req.body.value || null;
      event = 'publication.edited';
    } else if (action === 'SET_RESPONSIBLE') {
      pub.responsibleId = req.body.value || null;
      event = 'publication.edited';
    }
    touch(pub, req);
    afterTransition(req, pub, event, { previousStatus, reason, details: { bulk: true, action } });
    return { id, ok: true };
  });
  db.save();
  res.json({ results, count: results.filter(r => r.ok).length });
});

export default router;
export { CONTENT_EDITABLE };
