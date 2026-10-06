// Social account lifecycle: connection (OAuth result), profile/media sync,
// token refresh and disconnection. Network calls happen outside database
// transactions; every write goes through transact().
import { db, newId } from '../../db.js';
import { seal, unseal } from '../secrets.js';
import { transact } from '../runtime.js';
import { storeBuffer, deleteStored, storageAvailable } from '../storage.js';
import { log, recordEvent } from '../observability.js';
import { getProvider, ProviderError } from './provider.js';
import { notifyAccountProblem } from './publications.js';
import './instagram.js';

export const ACCOUNT_STATUSES = ['CONNECTED', 'REAUTH_REQUIRED', 'EXPIRED', 'DISCONNECTED', 'ERROR'];
const MEDIA_CACHE = 30; // recent network posts kept per account (feed planner)
const REFRESH_WINDOW_MS = 15 * 86400000;
const MIN_TOKEN_AGE_MS = 24 * 3600000;

// What the browser may see about an account. Credentials never leave the server.
export function presentAccount(a) {
  return {
    id: a.id, workspaceId: a.workspaceId, provider: a.provider, username: a.username, name: a.name,
    accountType: a.accountType, status: a.status, statusReason: a.statusReason || null,
    hasAvatar: Boolean(a.avatarKey), connectedAt: a.connectedAt, connectedBy: a.connectedBy,
    lastSyncAt: a.lastSyncAt || null, tokenExpiresAt: a.tokenExpiresAt || null,
    capabilities: a.status === 'CONNECTED' ? a.capabilities || {} : {},
    metadata: { followersCount: a.metadata?.followersCount ?? null, mediaCount: a.metadata?.mediaCount ?? null },
    quota: a.quota || null
  };
}

export const credentialFor = account => db.find('socialCredentials', c => c.accountId === account.id);

// Decrypted token for an account that can be used right now, or null.
export function usableToken(account) {
  if (!account || account.status !== 'CONNECTED') return null;
  const cred = credentialFor(account);
  if (!cred?.accessToken) return null;
  if (cred.expiresAt && Date.parse(cred.expiresAt) <= Date.now()) return null;
  return unseal(cred.accessToken);
}

export function setAccountStatus(account, status, reason = null) {
  if (account.status === status && account.statusReason === reason) return;
  account.status = status;
  account.statusReason = reason;
  account.statusChangedAt = new Date().toISOString();
  db.save();
  if (['REAUTH_REQUIRED', 'EXPIRED', 'ERROR'].includes(status)) {
    const titles = { REAUTH_REQUIRED: 'Instagram precisa ser reconectado', EXPIRED: 'Autorização do Instagram expirou', ERROR: 'Problema na conta do Instagram' };
    notifyAccountProblem(account, titles[status], `@${account.username}: ${reason || 'reconecte a conta para continuar publicando'}`);
    recordEvent('social.account_problem', `Conta @${account.username} em ${status}`, { accountId: account.id, status }, 'warn');
  }
}

/**
 * Stores the result of a successful OAuth authorization (runs inside the
 * callback request). Reconnecting the same network account in the same
 * workspace reuses its record, so its publications stay attached to it.
 */
export function upsertConnectedAccount({ workspaceId, userId, provider, grant, profile }) {
  const now = new Date().toISOString();
  const providerImpl = getProvider(provider);
  let account = db.find('socialAccounts', a => a.workspaceId === workspaceId && a.provider === provider && a.providerAccountId === grant.providerAccountId);
  const fields = {
    username: profile.username, name: profile.name, accountType: profile.accountType,
    capabilities: providerImpl.capabilities({ scopes: grant.scopes, accountType: profile.accountType }),
    grantedScopes: grant.scopes,
    metadata: { followersCount: profile.followersCount, mediaCount: profile.mediaCount },
    tokenExpiresAt: grant.expiresAt, status: 'CONNECTED', statusReason: null, statusChangedAt: now, updatedAt: now
  };
  const isNew = !account;
  if (account) Object.assign(account, fields, { connectedAt: now, connectedBy: userId, disconnectedAt: null });
  else {
    account = { id: newId('sac'), workspaceId, provider, providerAccountId: grant.providerAccountId, ...fields, connectedAt: now, connectedBy: userId, createdAt: now, lastSyncAt: null, avatarKey: null };
    db.insert('socialAccounts', account);
  }
  db.remove('socialCredentials', c => c.accountId === account.id);
  db.insert('socialCredentials', {
    id: newId('scr'), accountId: account.id, workspaceId, provider,
    accessToken: seal(grant.accessToken), expiresAt: grant.expiresAt, obtainedAt: now, refreshedAt: now, scopes: grant.scopes
  });
  account.credentialId = db.find('socialCredentials', c => c.accountId === account.id).id;
  db.save();
  return { account, isNew };
}

// Downloads an image the provider pointed to (avatar, post preview). Only
// HTTPS URLs on Meta's CDN are fetched, so a crafted URL cannot make Taskly
// call internal addresses.
const CDN_HOSTS = [/\.cdninstagram\.com$/i, /\.fbcdn\.net$/i];
async function fetchProviderImage(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  const allowTest = process.env.NODE_ENV !== 'production' && process.env.INSTAGRAM_CDN_TEST_HOST && url.host === process.env.INSTAGRAM_CDN_TEST_HOST;
  if (!allowTest && (url.protocol !== 'https:' || !CDN_HOSTS.some(re => re.test(url.hostname)))) return null;
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    if (!ext) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return null;
    return { buffer, ext, mime: type };
  } catch {
    return null;
  }
}

/**
 * Refreshes profile data and the recent posts already on the network (used by
 * the feed planner). Safe to call from routes (in background) and from jobs.
 */
export async function syncAccount(accountId) {
  const snapshot = await transact(() => {
    const account = db.find('socialAccounts', a => a.id === accountId);
    const token = usableToken(account);
    if (!account || !token) return null;
    const known = new Set(db.filter('socialMedia', m => m.accountId === account.id && m.previewKey).map(m => m.externalId));
    return { account: { id: account.id, provider: account.provider, providerAccountId: account.providerAccountId, avatarKey: account.avatarKey }, token, known };
  });
  if (!snapshot) return { synced: false, reason: 'Conta não conectada' };
  const provider = getProvider(snapshot.account.provider);
  let profile;
  let media = [];
  try {
    profile = await provider.fetchProfile(snapshot.token);
    media = await provider.fetchRecentMedia(snapshot.token, snapshot.account.providerAccountId, MEDIA_CACHE);
  } catch (err) {
    await transact(() => {
      const account = db.find('socialAccounts', a => a.id === accountId);
      if (account && err instanceof ProviderError && err.kind === 'AUTH') setAccountStatus(account, 'REAUTH_REQUIRED', err.message);
    });
    return { synced: false, reason: err.message };
  }

  const canStore = storageAvailable();
  const avatar = canStore && profile.avatarUrl ? await fetchProviderImage(profile.avatarUrl) : null;
  const avatarKey = avatar ? await storeBuffer('social', avatar.buffer, avatar.ext, avatar.mime) : null;
  const previews = {};
  if (canStore) {
    for (const m of media) {
      if (snapshot.known.has(m.externalId) || !m.previewUrl) continue;
      const img = await fetchProviderImage(m.previewUrl);
      if (img) previews[m.externalId] = await storeBuffer('social', img.buffer, img.ext, img.mime);
    }
  }

  const removedKeys = await transact(() => {
    const account = db.find('socialAccounts', a => a.id === accountId);
    if (!account || account.status === 'DISCONNECTED') return [...Object.values(previews), avatarKey].filter(Boolean);
    const stale = [];
    Object.assign(account, {
      username: profile.username || account.username, name: profile.name || account.name, accountType: profile.accountType || account.accountType,
      metadata: { followersCount: profile.followersCount, mediaCount: profile.mediaCount }, lastSyncAt: new Date().toISOString()
    });
    if (avatarKey) { if (account.avatarKey) stale.push(account.avatarKey); account.avatarKey = avatarKey; }
    const list = db.get('socialMedia');
    for (const m of media) {
      const existing = list.find(x => x.accountId === account.id && x.externalId === m.externalId);
      const record = { accountId: account.id, workspaceId: account.workspaceId, externalId: m.externalId, mediaType: m.mediaType, caption: (m.caption || '').slice(0, 2200), permalink: m.permalink, timestamp: m.timestamp, syncedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, record, previews[m.externalId] ? { previewKey: previews[m.externalId] } : {});
      else list.push({ id: newId('smd'), ...record, previewKey: previews[m.externalId] || null });
    }
    // Keep only the most recent posts per account.
    const mine = list.filter(x => x.accountId === account.id).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const drop = new Set(mine.slice(MEDIA_CACHE).map(x => x.id));
    mine.slice(MEDIA_CACHE).forEach(x => { if (x.previewKey) stale.push(x.previewKey); });
    db.data.socialMedia = list.filter(x => !drop.has(x.id));
    // Taskly publications confirmed by the API are matched to synced posts by external id.
    db.save();
    return stale;
  });
  removedKeys.forEach(deleteStored);
  return { synced: true, count: media.length, previewsStored: canStore };
}

/** Daily: renews tokens that expire within 15 days; flags expired ones. */
export async function refreshExpiringTokens() {
  const due = await transact(() => db.filter('socialAccounts', a => a.status === 'CONNECTED').map(a => {
    const cred = credentialFor(a);
    if (!cred) { setAccountStatus(a, 'REAUTH_REQUIRED', 'Credencial ausente'); return null; }
    const expires = cred.expiresAt ? Date.parse(cred.expiresAt) : Infinity;
    if (expires <= Date.now()) { setAccountStatus(a, 'EXPIRED', 'A autorização de 60 dias expirou'); return null; }
    const age = Date.now() - Date.parse(cred.refreshedAt || cred.obtainedAt);
    if (expires - Date.now() > REFRESH_WINDOW_MS || age < MIN_TOKEN_AGE_MS) return null;
    return { accountId: a.id, provider: a.provider, token: unseal(cred.accessToken) };
  }).filter(Boolean));

  const results = [];
  for (const job of due) {
    try {
      const fresh = await getProvider(job.provider).refreshToken(job.token);
      await transact(() => {
        const cred = db.find('socialCredentials', c => c.accountId === job.accountId);
        const account = db.find('socialAccounts', a => a.id === job.accountId);
        if (!cred || !account || account.status !== 'CONNECTED') return;
        Object.assign(cred, { accessToken: seal(fresh.accessToken), expiresAt: fresh.expiresAt, refreshedAt: new Date().toISOString() });
        account.tokenExpiresAt = fresh.expiresAt;
        db.save();
      });
      results.push({ accountId: job.accountId, refreshed: true });
    } catch (err) {
      await transact(() => {
        const account = db.find('socialAccounts', a => a.id === job.accountId);
        if (account && err instanceof ProviderError && err.kind === 'AUTH') setAccountStatus(account, 'REAUTH_REQUIRED', err.message);
      });
      log('warn', 'social token refresh failed', { accountId: job.accountId, kind: err.kind });
      results.push({ accountId: job.accountId, refreshed: false });
    }
  }
  return results;
}

/**
 * Disconnects an account (runs inside the request): the stored token is
 * deleted immediately and cached network posts are removed (data
 * minimization). Publications stay, so their history is preserved.
 */
export function disconnectAccount(account) {
  const keys = db.filter('socialMedia', m => m.accountId === account.id).map(m => m.previewKey).filter(Boolean);
  if (account.avatarKey) keys.push(account.avatarKey);
  db.remove('socialCredentials', c => c.accountId === account.id);
  db.remove('socialMedia', m => m.accountId === account.id);
  Object.assign(account, {
    status: 'DISCONNECTED', statusReason: null, statusChangedAt: new Date().toISOString(), disconnectedAt: new Date().toISOString(),
    credentialId: null, avatarKey: null, capabilities: {}, tokenExpiresAt: null
  });
  db.save();
  keys.forEach(deleteStored);
  return db.filter('publications', p => p.socialAccountId === account.id && ['SCHEDULED', 'PUBLISHING'].includes(p.status) && !p.deletedAt).length;
}
