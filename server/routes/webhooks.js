import express from 'express';
import crypto from 'crypto';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource } from '../middleware/auth.js';
import { v, badRequest, paginate } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { seal, unseal } from '../lib/secrets.js';
import { WEBHOOK_EVENTS, assertSafeWebhookUrl, deliverWebhook } from '../lib/events.js';

const router = express.Router();
router.use(authenticate, sessionOnly);

// The signing secret is needed to compute HMACs, so it is stored server-side,
// but it is only ever returned at creation or explicit rotation.
const present = ({ secret, ...w }) => ({ ...w, secretHint: `whsec_…${unseal(secret).slice(-4)}` });

async function parse(body, partial) {
  const out = {};
  const name = v.str(body.name, 'nome', { min: 2, max: 80, required: !partial });
  if (name) out.name = name;
  if (body.url !== undefined || !partial) {
    const url = v.str(body.url, 'URL', { required: true, max: 500 });
    try { await assertSafeWebhookUrl(url); } catch (err) { throw badRequest(err.message); }
    out.url = url;
  }
  if (body.events !== undefined || !partial) {
    const events = v.strArray(body.events || [], 'eventos', { maxItems: WEBHOOK_EVENTS.length });
    if (!events.length || events.some(e => !WEBHOOK_EVENTS.includes(e))) throw badRequest('Selecione eventos válidos');
    out.events = events;
  }
  if (body.active !== undefined) out.active = Boolean(body.active);
  if (body.retryPolicy !== undefined) {
    out.retryPolicy = {
      maxAttempts: v.int(body.retryPolicy.maxAttempts, 'tentativas', { min: 1, max: 10 }) || 3,
      backoffSeconds: v.int(body.retryPolicy.backoffSeconds, 'intervalo', { min: 1, max: 3600 }) || 5
    };
  }
  return out;
}

router.get('/events', (req, res) => res.json({ events: WEBHOOK_EVENTS }));

router.get('/workspace/:wsId', workspaceAccess('webhooks.manage'), (req, res) => {
  res.json({ webhooks: db.filter('webhooks', w => w.workspaceId === req.workspace.id).map(present) });
});

router.post('/workspace/:wsId', workspaceAccess('webhooks.manage'), async (req, res) => {
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const hook = { id: newId('wh'), workspaceId: req.workspace.id, active: true, retryPolicy: { maxAttempts: 3, backoffSeconds: 5 }, ...(await parse(req.body, false)), secret: seal(secret), createdBy: req.user.id, createdAt: new Date().toISOString(), lastDeliveryAt: null, lastStatus: null };
  db.insert('webhooks', hook);
  audit(req, { action: 'WEBHOOK_CREATE', entity: `Webhook ${hook.name}`, workspaceId: hook.workspaceId, category: 'webhooks', details: { events: hook.events } });
  res.status(201).json({ webhook: present(hook), secret });
});

router.put('/:id', resource('webhooks', 'webhooks.manage'), async (req, res) => {
  const updates = await parse(req.body, true);
  const updated = db.update('webhooks', w => w.id === req.resource.id, updates);
  audit(req, { action: updates.active === undefined ? 'WEBHOOK_UPDATE' : updates.active ? 'WEBHOOK_ACTIVATE' : 'WEBHOOK_DEACTIVATE', entity: `Webhook ${updated.name}`, workspaceId: updated.workspaceId, category: 'webhooks' });
  res.json({ webhook: present(updated) });
});

router.post('/:id/rotate-secret', resource('webhooks', 'webhooks.manage'), (req, res) => {
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const updated = db.update('webhooks', w => w.id === req.resource.id, { secret: seal(secret) });
  audit(req, { action: 'WEBHOOK_SECRET_ROTATE', entity: `Webhook ${updated.name}`, workspaceId: updated.workspaceId, category: 'webhooks' });
  res.json({ webhook: present(updated), secret });
});

router.delete('/:id', resource('webhooks', 'webhooks.manage'), (req, res) => {
  db.remove('webhooks', w => w.id === req.resource.id);
  audit(req, { action: 'WEBHOOK_DELETE', entity: `Webhook ${req.resource.name}`, workspaceId: req.resource.workspaceId, category: 'webhooks' });
  res.json({ success: true });
});

// Sends a real, signed test delivery and reports the outcome.
router.post('/:id/test', resource('webhooks', 'webhooks.manage'), async (req, res) => {
  const record = await deliverWebhook({ ...req.resource, retryPolicy: { maxAttempts: 1, backoffSeconds: 1 } }, 'webhook.test', { message: 'Evento de teste do Taskly', webhookId: req.resource.id });
  res.json({ delivery: record });
});

router.get('/:id/deliveries', resource('webhooks', 'webhooks.manage'), (req, res) => {
  let list = db.filter('webhookDeliveries', d => d.webhookId === req.resource.id);
  if (req.query.status === 'failed') list = list.filter(d => !d.success);
  const page = paginate(list, req.query, { defaultLimit: 20 });
  res.json({ deliveries: page.items, total: page.total, page: page.page, totalPages: page.totalPages });
});

export default router;
