import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource } from '../middleware/auth.js';
import { v, badRequest, paginate, PRIORITIES, TASK_TYPES } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { AUTOMATION_TRIGGERS, AUTOMATION_FIELDS, AUTOMATION_OPS, AUTOMATION_ACTIONS, PUBLICATION_FIELDS, PUBLICATION_ACTIONS, isPublicationTrigger, describeAutomation } from '../lib/events.js';
import { PUBLICATION_TYPES } from '../lib/social/rules.js';
import { CAMPAIGN_STATUSES } from './campaigns.js';

const router = express.Router();

const isMember = (ws, id) => ws.ownerId === id || ws.members.some(m => m.userId === id);

// Rules triggered by publications (Criativos) use their own fields and actions.
function parsePublicationDefinition(def, ws, trigger) {
  const triggerValue = trigger.value ? v.oneOf(trigger.value, 'tipo de publicação', Object.keys(PUBLICATION_TYPES)) : null;
  const conditions = (Array.isArray(def.conditions) ? def.conditions : []).slice(0, 10).map(c => {
    if (!PUBLICATION_FIELDS.includes(c.field)) throw badRequest('Campo de condição (IF) inválido para publicações');
    if (!AUTOMATION_OPS.includes(c.op)) throw badRequest('Operador de condição inválido');
    const value = v.str(c.value, 'valor da condição', { required: true, max: 60 });
    if (c.field === 'publicationType' && !PUBLICATION_TYPES[value]) throw badRequest('Tipo de publicação inválido');
    if (c.field === 'socialAccountId' && !db.find('socialAccounts', a => a.id === value && a.workspaceId === ws.id)) throw badRequest('Conta inválida na condição');
    if (c.field === 'campaignId' && !db.find('campaigns', x => x.id === value && x.workspaceId === ws.id)) throw badRequest('Campanha inválida na condição');
    if (c.field === 'projectId' && !db.find('projects', p => p.id === value && p.workspaceId === ws.id)) throw badRequest('Projeto inválido na condição');
    return { field: c.field, op: c.op, value };
  });
  const actions = (Array.isArray(def.actions) ? def.actions : []).slice(0, 10).map(a => {
    if (!PUBLICATION_ACTIONS[a.type]) throw badRequest('Ação (THEN) inválida para publicações');
    if (a.type === 'notify') {
      const target = v.str(a.target, 'destinatário', { required: true, max: 64 });
      if (!['responsible', 'creator', 'project_managers'].includes(target) && !isMember(ws, target)) throw badRequest('Destinatário da notificação inválido');
      return { type: 'notify', target };
    }
    if (a.type === 'request_approval') return { type: a.type };
    const value = v.str(a.value, 'valor da ação', { required: true, max: a.type === 'add_task_comment' ? 2000 : 200 });
    if (a.type === 'set_campaign_status' && !CAMPAIGN_STATUSES.includes(value)) throw badRequest('Status de campanha inválido');
    return { type: a.type, value };
  });
  if (!actions.length) throw badRequest('Adicione ao menos uma ação (THEN)');
  return { trigger: { type: trigger.type, value: triggerValue }, conditions, actions };
}

function parseDefinition(def, ws) {
  if (!def || typeof def !== 'object') throw badRequest('Defina WHEN, IF e THEN');
  const trigger = def.trigger || {};
  if (!AUTOMATION_TRIGGERS[trigger.type]) throw badRequest('Gatilho (WHEN) inválido');
  if (isPublicationTrigger(trigger.type)) return parsePublicationDefinition(def, ws, trigger);
  const triggerValue = trigger.value ? v.str(trigger.value, 'valor do gatilho', { max: 60 }) : null;
  if (trigger.type === 'task.priority_changed' && triggerValue && !PRIORITIES.includes(triggerValue)) throw badRequest('Prioridade inválida no gatilho');

  const conditions = (Array.isArray(def.conditions) ? def.conditions : []).slice(0, 10).map(c => {
    if (!AUTOMATION_FIELDS.includes(c.field)) throw badRequest('Campo de condição (IF) inválido');
    if (!AUTOMATION_OPS.includes(c.op)) throw badRequest('Operador de condição inválido');
    const value = v.str(c.value, 'valor da condição', { required: true, max: 60 });
    if (c.field === 'priority' && !PRIORITIES.includes(value)) throw badRequest('Prioridade inválida na condição');
    if (c.field === 'type' && !TASK_TYPES.includes(value)) throw badRequest('Tipo inválido na condição');
    return { field: c.field, op: c.op, value };
  });

  const actions = (Array.isArray(def.actions) ? def.actions : []).slice(0, 10).map(a => {
    if (!AUTOMATION_ACTIONS[a.type]) throw badRequest('Ação (THEN) inválida');
    if (a.type === 'notify') {
      const target = v.str(a.target, 'destinatário', { required: true, max: 64 });
      if (!['assignee', 'project_managers'].includes(target) && !ws.members.some(m => m.userId === target)) throw badRequest('Destinatário da notificação inválido');
      return { type: 'notify', target };
    }
    const value = v.str(a.value, 'valor da ação', { required: true, max: 60 });
    if (a.type === 'set_priority' && !PRIORITIES.includes(value)) throw badRequest('Prioridade inválida na ação');
    if (a.type === 'assign' && !ws.members.some(m => m.userId === value)) throw badRequest('Responsável inválido na ação');
    return { type: a.type, value };
  });
  if (!actions.length) throw badRequest('Adicione ao menos uma ação (THEN)');
  return { trigger: { type: trigger.type, value: triggerValue }, conditions, actions };
}

const present = a => ({ ...a, summary: describeAutomation(a.definition) });

router.get('/meta', authenticate, (req, res) => {
  res.json({ triggers: AUTOMATION_TRIGGERS, fields: AUTOMATION_FIELDS, ops: AUTOMATION_OPS, actions: AUTOMATION_ACTIONS, publicationFields: PUBLICATION_FIELDS, publicationActions: PUBLICATION_ACTIONS, publicationTypes: Object.fromEntries(Object.entries(PUBLICATION_TYPES).map(([k, t]) => [k, t.label])), campaignStatuses: CAMPAIGN_STATUSES });
});

router.get('/workspace/:wsId', authenticate, workspaceAccess('project.view'), (req, res) => {
  res.json({ automations: db.filter('automations', a => a.workspaceId === req.workspace.id).map(present) });
});

router.get('/logs/:wsId', authenticate, workspaceAccess('project.view'), (req, res) => {
  const { status, automationId, from, to, q } = req.query;
  let logs = db.filter('automationLogs', l => l.workspaceId === req.params.wsId);
  if (status && status !== 'ALL') logs = logs.filter(l => l.status === status);
  if (automationId && automationId !== 'ALL') logs = logs.filter(l => l.automationId === automationId);
  if (from) logs = logs.filter(l => l.timestamp >= from);
  if (to) logs = logs.filter(l => l.timestamp.slice(0, 10) <= to);
  if (q) { const s = String(q).toLowerCase(); logs = logs.filter(l => `${l.automationTitle} ${l.taskId || ''} ${l.result || ''} ${l.error || ''}`.toLowerCase().includes(s)); }
  logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const page = paginate(logs, req.query, { defaultLimit: 20 });
  res.json({ logs: page.items, total: page.total, page: page.page, totalPages: page.totalPages });
});

router.post('/workspace/:wsId', authenticate, sessionOnly, workspaceAccess('automations.manage'), (req, res) => {
  const projectId = req.body.projectId || null;
  if (projectId && !db.find('projects', p => p.id === projectId && p.workspaceId === req.workspace.id)) throw badRequest('Projeto inválido');
  const rule = {
    id: newId('aut'), workspaceId: req.workspace.id, projectId,
    title: v.str(req.body.title, 'título', { min: 3, max: 120, required: true }),
    description: v.str(req.body.description, 'descrição', { max: 500 }) || '',
    enabled: req.body.enabled !== false,
    definition: parseDefinition(req.body.definition, req.workspace),
    executionsCount: 0, lastTriggeredAt: null, createdBy: req.user.id, createdAt: new Date().toISOString()
  };
  db.insert('automations', rule);
  audit(req, { action: 'AUTOMATION_CREATE', entity: `Automação ${rule.title}`, workspaceId: rule.workspaceId, category: 'automations' });
  res.status(201).json({ automation: present(rule) });
});

router.put('/:id', authenticate, sessionOnly, resource('automations', 'automations.manage'), (req, res) => {
  const updates = {};
  if (req.body.title !== undefined) updates.title = v.str(req.body.title, 'título', { min: 3, max: 120, required: true });
  if (req.body.description !== undefined) updates.description = v.str(req.body.description, 'descrição', { max: 500 }) || '';
  if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
  if (req.body.definition !== undefined) updates.definition = parseDefinition(req.body.definition, req.workspace);
  if (req.body.projectId !== undefined) {
    const projectId = req.body.projectId || null;
    if (projectId && !db.find('projects', p => p.id === projectId && p.workspaceId === req.workspace.id)) throw badRequest('Projeto inválido');
    updates.projectId = projectId;
  }
  const updated = db.update('automations', a => a.id === req.resource.id, updates);
  audit(req, { action: updates.enabled === undefined ? 'AUTOMATION_UPDATE' : updates.enabled ? 'AUTOMATION_ENABLE' : 'AUTOMATION_DISABLE', entity: `Automação ${updated.title}`, workspaceId: updated.workspaceId, category: 'automations' });
  res.json({ automation: present(updated) });
});

router.delete('/:id', authenticate, sessionOnly, resource('automations', 'automations.manage'), (req, res) => {
  db.remove('automations', a => a.id === req.resource.id);
  audit(req, { action: 'AUTOMATION_DELETE', entity: `Automação ${req.resource.title}`, workspaceId: req.resource.workspaceId, category: 'automations' });
  res.json({ success: true });
});

router.post('/:id/duplicate', authenticate, sessionOnly, resource('automations', 'automations.manage'), (req, res) => {
  const copy = { ...req.resource, id: newId('aut'), title: `${req.resource.title} (cópia)`.slice(0, 120), enabled: false, executionsCount: 0, lastTriggeredAt: null, createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.insert('automations', copy);
  res.status(201).json({ automation: present(copy) });
});

export default router;
