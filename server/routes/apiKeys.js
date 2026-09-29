import express from 'express';
import crypto from 'crypto';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource, sha256 } from '../middleware/auth.js';
import { v, badRequest } from '../lib/http.js';
import { API_SCOPES } from '../lib/rbac.js';
import { audit } from '../lib/observability.js';

const router = express.Router();
router.use(authenticate, sessionOnly);

// Only a SHA-256 hash of the secret is stored; the secret is shown once.
function generateSecret() {
  const secret = `tsk_live_${crypto.randomBytes(24).toString('hex')}`;
  return { secret, keyPrefix: `${secret.slice(0, 13)}…${secret.slice(-4)}`, keyHash: sha256(secret) };
}

const present = ({ keyHash, ...k }) => ({ ...k, createdByName: db.find('users', u => u.id === k.createdBy)?.name || null });

router.get('/scopes', (req, res) => res.json({ scopes: API_SCOPES }));

router.get('/workspace/:wsId', workspaceAccess('apikeys.manage'), (req, res) => {
  res.json({ apiKeys: db.filter('apiKeys', k => k.workspaceId === req.workspace.id).map(present) });
});

router.post('/workspace/:wsId', workspaceAccess('apikeys.manage'), (req, res) => {
  const name = v.str(req.body.name, 'nome', { min: 2, max: 80, required: true });
  const scopes = v.strArray(req.body.scopes || ['tasks:read'], 'escopos', { maxItems: API_SCOPES.length });
  if (!scopes.length || scopes.some(s => !API_SCOPES.includes(s))) throw badRequest('Escopos inválidos');
  const expiresInDays = v.int(req.body.expiresInDays, 'validade', { min: 1, max: 730 });
  const { secret, keyPrefix, keyHash } = generateSecret();
  const key = {
    id: newId('key'), workspaceId: req.workspace.id, name, keyPrefix, keyHash, scopes, createdBy: req.user.id,
    createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null
  };
  db.insert('apiKeys', key);
  audit(req, { action: 'API_KEY_CREATE', entity: `Chave ${name} (${keyPrefix})`, workspaceId: key.workspaceId, category: 'api', details: { scopes } });
  res.status(201).json({ apiKey: present(key), secret });
});

router.put('/:id', resource('apiKeys', 'apikeys.manage'), (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) updates.name = v.str(req.body.name, 'nome', { min: 2, max: 80, required: true });
  if (req.body.scopes !== undefined) {
    const scopes = v.strArray(req.body.scopes, 'escopos', { maxItems: API_SCOPES.length });
    if (!scopes.length || scopes.some(s => !API_SCOPES.includes(s))) throw badRequest('Escopos inválidos');
    updates.scopes = scopes;
  }
  const updated = db.update('apiKeys', k => k.id === req.resource.id, updates);
  audit(req, { action: 'API_KEY_UPDATE', entity: `Chave ${updated.name}`, workspaceId: updated.workspaceId, category: 'api', details: updates });
  res.json({ apiKey: present(updated) });
});

router.post('/:id/rotate', resource('apiKeys', 'apikeys.manage'), (req, res) => {
  if (req.resource.revokedAt) throw badRequest('Chaves revogadas não podem ser rotacionadas');
  const { secret, keyPrefix, keyHash } = generateSecret();
  const updated = db.update('apiKeys', k => k.id === req.resource.id, { keyPrefix, keyHash, rotatedAt: new Date().toISOString() });
  audit(req, { action: 'API_KEY_ROTATE', entity: `Chave ${updated.name}`, workspaceId: updated.workspaceId, category: 'api' });
  res.json({ apiKey: present(updated), secret });
});

router.delete('/:id', resource('apiKeys', 'apikeys.manage'), (req, res) => {
  const updated = db.update('apiKeys', k => k.id === req.resource.id, { revokedAt: new Date().toISOString() });
  audit(req, { action: 'API_KEY_REVOKE', entity: `Chave ${updated.name}`, workspaceId: updated.workspaceId, category: 'api' });
  res.json({ success: true, apiKey: present(updated) });
});

export default router;
