// Social accounts (Criativos → Contas): OAuth connection through the official
// provider, sync, disconnection, avatars and the signed public media URLs the
// network uses to fetch files at publishing time.
import express from 'express';
import { db, newId } from '../db.js';
import { authenticate, sessionOnly, workspaceAccess, resource, authorizeWorkspace, rateLimit, sha256, randomToken } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/http.js';
import { audit, recordEvent } from '../lib/observability.js';
import { background, commitBeforeStreaming } from '../lib/runtime.js';
import { streamStored, storageAvailable } from '../lib/storage.js';
import { getProvider, listProviders, ProviderError } from '../lib/social/provider.js';
import { presentAccount, upsertConnectedAccount, syncAccount, disconnectAccount } from '../lib/social/accounts.js';
import { verifyMediaToken } from '../lib/social/mediaUrl.js';
import '../lib/social/instagram.js';

const router = express.Router();
const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const isProd = process.env.NODE_ENV === 'production';
const STATE_COOKIE = 'taskly_social_oauth';
const callbackPath = provider => `/api/social/${provider}/callback`;
const redirectUri = provider => `${APP_URL()}${callbackPath(provider)}`;

function integrationStatus() {
  return listProviders().map(p => ({
    provider: p.id, label: p.label, configured: p.isConfigured(),
    // Names of the settings an operator must define (never their values).
    requiredConfig: p.requiredConfig(), redirectUri: redirectUri(p.id)
  }));
}

router.get('/workspace/:wsId/accounts', authenticate, sessionOnly, workspaceAccess('creatives.view'), (req, res) => {
  const accounts = db.filter('socialAccounts', a => a.workspaceId === req.workspace.id && a.status !== 'DISCONNECTED')
    .sort((a, b) => a.username.localeCompare(b.username)).map(presentAccount);
  res.json({ accounts, integrations: integrationStatus(), storageAvailable: storageAvailable() });
});

// Starts the OAuth authorization. The browser gets the provider URL and an
// HttpOnly state cookie; the state's purpose (workspace, user) lives server-side.
router.post('/workspace/:wsId/accounts/connect', authenticate, sessionOnly, workspaceAccess('creatives.manage_accounts'),
  rateLimit({ windowMs: 10 * 60 * 1000, max: 10, key: req => `social-connect:${req.user.id}` }), (req, res) => {
    const providerId = String(req.body.provider || 'instagram');
    const provider = getProvider(providerId);
    if (!provider.isConfigured()) {
      throw Object.assign(badRequest(`A integração com ${provider.label} ainda não foi configurada neste ambiente.`), { code: 'INTEGRATION_NOT_CONFIGURED', details: { requiredConfig: provider.requiredConfig() } });
    }
    const state = randomToken(24);
    db.remove('oauthStates', s => Date.parse(s.expiresAt) < Date.now());
    db.insert('oauthStates', {
      id: newId('oas'), stateHash: sha256(state), mode: 'social', provider: providerId,
      workspaceId: req.workspace.id, linkUserId: req.user.id, expiresAt: new Date(Date.now() + 10 * 60000).toISOString()
    });
    res.cookie(STATE_COOKIE, state, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: callbackPath(providerId) });
    audit(req, { action: 'SOCIAL_CONNECT_STARTED', entity: `${provider.label}`, workspaceId: req.workspace.id, category: 'creatives' });
    res.json({ authorizationUrl: provider.authorizationUrl({ state, redirectUri: redirectUri(providerId) }) });
  });

// Provider redirects back here (top-level GET, so the Lax session cookie is sent).
router.get('/:provider/callback', async (req, res) => {
  const providerId = req.params.provider;
  const token = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: callbackPath(providerId) });
  const flow = token ? db.find('oauthStates', s => s.mode === 'social' && s.stateHash === sha256(token)) : null;
  if (flow) db.remove('oauthStates', s => s.id === flow.id); // single use
  const fail = (code, detail) => {
    recordEvent('social.oauth_failed', `Falha ao conectar conta social: ${code}`, { provider: providerId, detail }, 'warn');
    return res.redirect(`${APP_URL()}/creatives?social_error=${encodeURIComponent(code)}`);
  };

  if (!flow || Date.parse(flow.expiresAt) < Date.now() || flow.provider !== providerId) return fail('oauth_state');
  if (req.query.error) return fail(req.query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed', String(req.query.error_reason || req.query.error).slice(0, 80));
  if (!req.query.state || sha256(String(req.query.state)) !== flow.stateHash) return fail('oauth_state');
  if (!req.query.code) return fail('oauth_failed', 'missing code');

  // The connection must finish in the same session and with the same rights.
  const sessionErr = await new Promise(resolve => authenticate(req, res, resolve));
  if (sessionErr || req.user?.id !== flow.linkUserId) return fail('session_required');
  try {
    authorizeWorkspace(req, flow.workspaceId, 'creatives.manage_accounts');
  } catch {
    return fail('forbidden');
  }

  let provider;
  try { provider = getProvider(providerId); } catch { return fail('oauth_failed', 'unknown provider'); }
  try {
    // Instagram appends "#_" to the code in some flows.
    const code = String(req.query.code).replace(/#_$/, '');
    const grant = await provider.exchangeCode({ code, redirectUri: redirectUri(providerId) });
    const profile = await provider.fetchProfile(grant.accessToken);
    if (!profile.username) return fail('oauth_failed', 'profile without username');
    const { account, isNew } = upsertConnectedAccount({ workspaceId: flow.workspaceId, userId: req.user.id, provider: providerId, grant: { ...grant, providerAccountId: profile.providerAccountId || grant.providerAccountId }, profile });
    audit(req, { action: 'SOCIAL_ACCOUNT_CONNECTED', entity: `${provider.label} @${account.username}`, workspaceId: account.workspaceId, category: 'creatives', details: { accountId: account.id, reconnected: !isNew, scopes: grant.scopes } });
    // Profile picture and recent posts are fetched after the redirect.
    background(syncAccount(account.id));
    return res.redirect(`${APP_URL()}/creatives/${account.id}/feed?social=connected`);
  } catch (err) {
    return fail(err instanceof ProviderError && err.kind === 'PERMISSION' ? 'oauth_permission' : 'oauth_failed', err.message);
  }
});

router.post('/accounts/:id/sync', authenticate, sessionOnly, resource('socialAccounts', 'creatives.manage_accounts'),
  rateLimit({ windowMs: 60 * 1000, max: 5, key: req => `social-sync:${req.params.id}` }), (req, res) => {
    if (req.resource.status === 'DISCONNECTED') throw notFound();
    background(syncAccount(req.resource.id));
    res.status(202).json({ accepted: true });
  });

router.delete('/accounts/:id', authenticate, sessionOnly, resource('socialAccounts', 'creatives.manage_accounts'), (req, res) => {
  const account = req.resource;
  if (account.status === 'DISCONNECTED') throw notFound();
  const affected = disconnectAccount(account);
  audit(req, { action: 'SOCIAL_ACCOUNT_DISCONNECTED', entity: `${account.provider} @${account.username}`, workspaceId: account.workspaceId, category: 'creatives', details: { accountId: account.id, scheduledAffected: affected } });
  res.json({ success: true, scheduledAffected: affected });
});

router.get('/accounts/:id/avatar', authenticate, resource('socialAccounts', 'creatives.view'), async (req, res) => {
  const key = req.resource.avatarKey;
  if (!key) throw notFound();
  await commitBeforeStreaming(res);
  const ok = await streamStored(req, res, key, { contentType: key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg', fileName: 'avatar', cache: 'private, max-age=3600' });
  if (!ok && !res.headersSent) res.status(404).end();
});

// Posts already on the network (synced), shown in the feed planner.
router.get('/accounts/:id/media', authenticate, resource('socialAccounts', 'creatives.view'), (req, res) => {
  const media = db.filter('socialMedia', m => m.accountId === req.resource.id)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map(m => ({ id: m.id, externalId: m.externalId, mediaType: m.mediaType, caption: m.caption, permalink: m.permalink, timestamp: m.timestamp, hasPreview: Boolean(m.previewKey) }));
  res.json({ media });
});

router.get('/media-preview/:id', authenticate, resource('socialMedia', 'creatives.view'), async (req, res) => {
  const key = req.resource.previewKey;
  if (!key) throw notFound();
  await commitBeforeStreaming(res);
  const ok = await streamStored(req, res, key, { contentType: key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg', fileName: 'preview', cache: 'private, max-age=86400' });
  if (!ok && !res.headersSent) res.status(404).end();
});

// Signed, expiring URL used by the network to fetch a creative (no session).
router.get('/media/:token', rateLimit({ windowMs: 60 * 1000, max: 120, key: req => `social-media:${req.ip}` }), async (req, res) => {
  const creativeId = verifyMediaToken(req.params.token);
  const creative = creativeId ? db.find('creatives', c => c.id === creativeId && !c.deletedAt) : null;
  if (!creative?.storageKey) return res.status(404).json({ error: 'Link inválido ou expirado', code: 'NOT_FOUND' });
  await commitBeforeStreaming(res);
  const ext = creative.storageKey.split('.').pop();
  const ok = await streamStored(req, res, creative.storageKey, { contentType: creative.mimeType, fileName: `media.${ext}`, cache: 'no-store' });
  if (!ok && !res.headersSent) res.status(404).end();
});

export default router;
