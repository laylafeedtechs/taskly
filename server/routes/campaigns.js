// Campaigns (Criativos → Campanhas): group publications and creatives,
// optionally tied to a client account and to a Taskly project.
import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource } from '../middleware/auth.js';
import { v, badRequest } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { PUBLICATION_TYPES } from '../lib/social/rules.js';

const router = express.Router();
export const CAMPAIGN_STATUSES = ['PLANNING', 'ACTIVE', 'FINISHED'];

function parseCampaign(body, ws, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = v.str(body.name, 'nome', { min: 2, max: 120, required: true });
  if (body.description !== undefined) out.description = v.str(body.description, 'descrição', { max: 2000 }) || '';
  if (body.client !== undefined) out.client = v.str(body.client, 'cliente', { max: 120 }) || '';
  if (body.status !== undefined || !partial) out.status = v.oneOf(body.status || 'PLANNING', 'status', CAMPAIGN_STATUSES);
  if (body.startDate !== undefined) out.startDate = v.date(body.startDate, 'data inicial');
  if (body.endDate !== undefined) out.endDate = v.date(body.endDate, 'data final');
  if (body.color !== undefined) out.color = v.color(body.color, 'cor');
  if (body.socialAccountId !== undefined) {
    out.socialAccountId = body.socialAccountId || null;
    if (out.socialAccountId && !db.find('socialAccounts', a => a.id === out.socialAccountId && a.workspaceId === ws.id)) throw badRequest('Conta inválida');
  }
  if (body.projectId !== undefined) {
    out.projectId = body.projectId || null;
    if (out.projectId && !db.find('projects', p => p.id === out.projectId && p.workspaceId === ws.id && !p.deletedAt)) throw badRequest('Projeto inválido');
  }
  if (body.responsibleId !== undefined) {
    out.responsibleId = body.responsibleId || null;
    if (out.responsibleId && ws.ownerId !== out.responsibleId && !ws.members.some(m => m.userId === out.responsibleId)) throw badRequest('Responsável inválido');
  }
  if (body.budget !== undefined) {
    if (body.budget === null || body.budget === '') out.budget = null;
    else {
      const amount = Number(body.budget.amount ?? body.budget);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) throw badRequest('Orçamento inválido');
      out.budget = { amount: Math.round(amount * 100) / 100, currency: v.oneOf(body.budget.currency || 'BRL', 'moeda', ['BRL', 'USD', 'EUR']) };
    }
  }
  return out;
}

function present(c) {
  const pubs = db.filter('publications', p => p.campaignId === c.id && !p.deletedAt && p.status !== 'CANCELLED');
  const byType = Object.fromEntries(Object.keys(PUBLICATION_TYPES).map(t => [t, pubs.filter(p => p.type === t).length]));
  const byStatus = pubs.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {});
  return {
    ...c,
    stats: {
      publications: pubs.length, byType, byStatus,
      creatives: db.filter('creatives', x => x.campaignId === c.id && !x.deletedAt).length,
      nextScheduledAt: pubs.filter(p => p.status === 'SCHEDULED').map(p => p.scheduledAt).sort()[0] || null
    }
  };
}

router.get('/workspace/:wsId', authenticate, workspaceAccess('creatives.view'), (req, res) => {
  const { status, socialAccountId, q } = req.query;
  let list = db.filter('campaigns', c => c.workspaceId === req.workspace.id && !c.deletedAt);
  if (status && status !== 'ALL') list = list.filter(c => c.status === status);
  // In an account context: that client's campaigns plus workspace-wide ones.
  if (socialAccountId) list = list.filter(c => !c.socialAccountId || c.socialAccountId === socialAccountId);
  if (q) { const s = String(q).toLowerCase(); list = list.filter(c => `${c.name} ${c.client || ''}`.toLowerCase().includes(s)); }
  list.sort((a, b) => CAMPAIGN_STATUSES.indexOf(a.status) - CAMPAIGN_STATUSES.indexOf(b.status) || String(b.startDate || '').localeCompare(String(a.startDate || '')));
  res.json({ campaigns: list.map(present) });
});

router.post('/workspace/:wsId', authenticate, sessionOnly, workspaceAccess('creatives.manage_campaigns'), (req, res) => {
  const data = parseCampaign(req.body, req.workspace);
  if (data.startDate && data.endDate && data.endDate < data.startDate) throw badRequest('A data final deve ser posterior à inicial');
  const now = new Date().toISOString();
  const campaign = {
    id: newId('cmp'), workspaceId: req.workspace.id, description: '', client: '', socialAccountId: null, projectId: null,
    responsibleId: null, startDate: null, endDate: null, budget: null, color: '#3B82F6', ...data,
    createdBy: req.user.id, createdAt: now, updatedAt: now, deletedAt: null
  };
  db.insert('campaigns', campaign);
  audit(req, { action: 'CAMPAIGN_CREATED', entity: `Campanha ${campaign.name}`, workspaceId: campaign.workspaceId, category: 'creatives', details: { campaignId: campaign.id } });
  res.status(201).json({ campaign: present(campaign) });
});

router.patch('/:id', authenticate, sessionOnly, resource('campaigns', 'creatives.manage_campaigns'), (req, res) => {
  const data = parseCampaign(req.body, req.workspace, { partial: true });
  const merged = { ...req.resource, ...data };
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) throw badRequest('A data final deve ser posterior à inicial');
  const updated = db.update('campaigns', c => c.id === req.resource.id, data);
  audit(req, { action: 'CAMPAIGN_UPDATED', entity: `Campanha ${updated.name}`, workspaceId: updated.workspaceId, category: 'creatives', details: { campaignId: updated.id, fields: Object.keys(data) } });
  res.json({ campaign: present(updated) });
});

router.post('/:id/duplicate', authenticate, sessionOnly, resource('campaigns', 'creatives.manage_campaigns'), (req, res) => {
  const src = req.resource;
  const data = parseCampaign({ name: req.body.name || `${src.name} (cópia)`.slice(0, 120), startDate: req.body.startDate, endDate: req.body.endDate }, req.workspace, { partial: true });
  const now = new Date().toISOString();
  const copy = { ...src, ...data, id: newId('cmp'), status: 'PLANNING', createdBy: req.user.id, createdAt: now, updatedAt: now };
  db.insert('campaigns', copy);
  audit(req, { action: 'CAMPAIGN_DUPLICATED', entity: `Campanha ${copy.name}`, workspaceId: copy.workspaceId, category: 'creatives', details: { from: src.id, campaignId: copy.id } });
  res.status(201).json({ campaign: present(copy) });
});

// Deleting a campaign keeps its publications and creatives (unlinked).
router.delete('/:id', authenticate, sessionOnly, resource('campaigns', 'creatives.manage_campaigns'), (req, res) => {
  const c = req.resource;
  db.filter('publications', p => p.campaignId === c.id).forEach(p => { p.campaignId = null; });
  db.filter('creatives', x => x.campaignId === c.id).forEach(x => { x.campaignId = null; });
  c.deletedAt = new Date().toISOString();
  db.save();
  audit(req, { action: 'CAMPAIGN_DELETED', entity: `Campanha ${c.name}`, workspaceId: c.workspaceId, category: 'creatives', details: { campaignId: c.id } });
  res.json({ success: true });
});

export default router;
