// Publication scheduler / worker. Runs on the backend only: every minute from
// the Cloudflare Cron Trigger (worker/index.js) or a timer on the Node server.
// Nothing depends on a browser being open.
//
// Each tick:
//   1. claims due publications in ONE transaction (status → PUBLISHING, with a
//      lease) — concurrent ticks can never claim the same publication;
//   2. talks to the network API outside any transaction;
//   3. records every step in its own short transaction, checking the lease.
//
// Idempotency: the network "container" is the idempotency key. It is stored
// before publishing and `publishRequestedAt` is stored *before* calling
// media_publish. If the outcome of that call is unknown (timeout, crash,
// restart), the next tick asks the API for the container status instead of
// publishing again: PUBLISHED → mark as published; FINISHED → the call never
// happened, publish it (a container can only be published once).
import crypto from 'crypto';
import { db, newId } from '../../db.js';
import { transact } from '../runtime.js';
import { log, recordEvent } from '../observability.js';
import { getProvider, ProviderError, NEXT_ACTION } from './provider.js';
import { usableToken, setAccountStatus } from './accounts.js';
import { composeCaption } from './rules.js';
import { signedMediaUrl } from './mediaUrl.js';
import { resolveMedia, resolveCover, problemsFor, afterTransition, SYSTEM_ACTOR, publicationLink } from './publications.js';
import { notify } from '../events.js';
import './instagram.js';

const LEASE_MS = 4 * 60 * 1000;
const MAX_AUTO_RETRIES = 3;
const MAX_CONTAINER_CHECKS = 10; // Meta: poll once per minute, ~5 minutes (videos may need longer)
const IN_TICK_POLLS = 3;
const IN_TICK_POLL_MS = 3000;
// Delay before a processing container is checked again (shorter only in tests).
const RECHECK_MS = (process.env.NODE_ENV !== 'production' && Number(process.env.TASKLY_CONTAINER_RECHECK_MS)) || 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

class LeaseLost extends Error {}

// ------------------------------------------------------------------ claim

function failInClaim(pub, kind, message) {
  const previous = pub.status;
  pub.status = 'FAILED';
  pub.error = { kind, message, action: NEXT_ACTION[kind] || NEXT_ACTION.UNKNOWN, at: nowIso(), attempt: pub.publishing?.attempts || 0 };
  pub.publishing = { ...(pub.publishing || {}), lockId: null, lockedUntil: null, phase: 'FAILED' };
  pub.updatedAt = nowIso();
  db.save();
  afterTransition(SYSTEM_ACTOR, pub, 'publication.failed', { previousStatus: previous });
}

function claimDue(limit) {
  const now = nowIso();
  const due = db.filter('publications', p => !p.deletedAt && (
    (p.status === 'SCHEDULED' && p.scheduledAt && p.scheduledAt <= now && (!p.publishing?.nextAttemptAt || p.publishing.nextAttemptAt <= now))
    || (p.status === 'PUBLISHING' && (!p.publishing?.lockedUntil || p.publishing.lockedUntil <= now) && (!p.publishing?.nextCheckAt || p.publishing.nextCheckAt <= now))
  )).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).slice(0, limit);

  const jobs = [];
  for (const pub of due) {
    const account = db.find('socialAccounts', a => a.id === pub.socialAccountId && a.workspaceId === pub.workspaceId);
    const token = usableToken(account);
    const fresh = pub.status === 'SCHEDULED';
    pub.publishing = pub.publishing || {};

    if (!account || !token) {
      const reason = !account ? 'A conta desta publicação não existe mais' : account.status === 'DISCONNECTED' ? 'A conta do Instagram foi desconectada' : 'A autorização do Instagram expirou ou precisa ser renovada';
      failInClaim(pub, 'ACCOUNT', `${reason}. Reconecte a conta e tente novamente.`);
      continue;
    }
    // Content is re-validated at publishing time (a creative may have been removed).
    if (fresh) {
      const problems = problemsFor(pub);
      if (problems.length) { failInClaim(pub, 'MEDIA', problems.map(p => p.message).join('; ')); continue; }
    }

    const lockId = crypto.randomBytes(12).toString('hex');
    if (fresh) {
      const attempt = (pub.publishing.attempts || 0) + 1;
      const attemptId = newId('patt');
      pub.publishing.attempts = attempt;
      pub.publishing.currentAttemptId = attemptId;
      pub.publishing.startedAt = now;
      pub.publishing.phase = pub.publishing.containerId ? pub.publishing.phase : 'STARTED';
      db.insert('publicationAttempts', {
        id: attemptId, publicationId: pub.id, workspaceId: pub.workspaceId, attempt,
        idempotencyKey: `${pub.id}:${attempt}`, startedAt: now, finishedAt: null, outcome: 'IN_PROGRESS',
        phase: pub.publishing.phase, containerId: pub.publishing.containerId || null, externalId: null, error: null, durationMs: null
      });
    }
    pub.status = 'PUBLISHING';
    pub.publishing.lockId = lockId;
    pub.publishing.lockedUntil = new Date(Date.now() + LEASE_MS).toISOString();
    pub.publishing.nextCheckAt = null;
    pub.updatedAt = now;
    if (fresh) afterTransition(SYSTEM_ACTOR, pub, 'publication.publishing', { previousStatus: 'SCHEDULED' });

    const media = resolveMedia(pub);
    const cover = resolveCover(pub);
    jobs.push({
      pubId: pub.id, lockId, provider: account.provider, accountId: account.providerAccountId, socialAccountId: account.id, token,
      type: pub.type, caption: pub.type === 'STORY' ? undefined : composeCaption(pub),
      locationId: pub.location?.id || undefined, shareToFeed: pub.shareToFeed !== false,
      items: media.map(c => ({ kind: c.kind, creativeId: c.id })), coverId: cover?.id || null,
      publishing: { ...pub.publishing }, startedAtMs: Date.now()
    });
  }
  db.save();
  return jobs;
}

// --------------------------------------------------------------- progress

function withLease(job, fn) {
  return transact(() => {
    const pub = db.find('publications', p => p.id === job.pubId);
    if (!pub || pub.status !== 'PUBLISHING' || pub.publishing?.lockId !== job.lockId) throw new LeaseLost();
    pub.publishing.lockedUntil = new Date(Date.now() + LEASE_MS).toISOString();
    const result = fn(pub);
    pub.updatedAt = nowIso();
    db.save();
    return result;
  });
}

function updateAttempt(pub, patch) {
  const attempt = db.find('publicationAttempts', a => a.id === pub.publishing.currentAttemptId);
  if (attempt) Object.assign(attempt, patch);
}

const saveProgress = (job, patch) => withLease(job, pub => {
  Object.assign(pub.publishing, patch);
  Object.assign(job.publishing, patch);
  updateAttempt(pub, { phase: pub.publishing.phase, containerId: pub.publishing.containerId || null });
});

// Container still processing: release the lease and look again in a minute.
const waitForContainer = job => withLease(job, pub => {
  pub.publishing.checks = (pub.publishing.checks || 0) + 1;
  pub.publishing.nextCheckAt = new Date(Date.now() + RECHECK_MS).toISOString();
  pub.publishing.lockId = null;
  pub.publishing.lockedUntil = null;
  updateAttempt(pub, { phase: pub.publishing.phase });
  return { pubId: pub.id, outcome: 'WAITING' };
});

function complete(job, { externalId, permalink, timestamp, recovered = false }) {
  return withLease(job, pub => {
    pub.status = 'PUBLISHED';
    pub.publishedAt = timestamp || nowIso();
    pub.externalId = externalId || null;
    pub.permalink = permalink || null;
    pub.error = null;
    pub.publishing = { ...pub.publishing, phase: 'DONE', lockId: null, lockedUntil: null, nextAttemptAt: null, nextCheckAt: null, confirmedAt: nowIso(), recovered };
    updateAttempt(pub, { outcome: 'SUCCESS', phase: 'DONE', externalId: pub.externalId, finishedAt: nowIso(), durationMs: Date.now() - job.startedAtMs });
    afterTransition(SYSTEM_ACTOR, pub, 'publication.published', { previousStatus: 'PUBLISHING', details: { externalId: pub.externalId, recovered } });
    recordEvent('social.published', 'Publicação confirmada pela API', { publicationId: pub.id, ms: Date.now() - job.startedAtMs, attempt: pub.publishing.attempts, recovered });
    return { pubId: pub.id, outcome: 'PUBLISHED', externalId: pub.externalId };
  });
}

function backoffMs(kind, retry) {
  if (kind === 'RATE_LIMIT') return 30 * 60 * 1000;
  return Math.min(2 ** retry, 16) * 60 * 1000; // 2, 4, 8 minutes
}

function failOrRetry(job, err) {
  const kind = err instanceof ProviderError ? err.kind : 'UNKNOWN';
  const message = err instanceof ProviderError ? err.message : 'Erro inesperado ao publicar';
  const retryable = err instanceof ProviderError ? err.retryable : true;
  return withLease(job, pub => {
    const account = db.find('socialAccounts', a => a.id === pub.socialAccountId);
    if (kind === 'AUTH' && account) setAccountStatus(account, 'REAUTH_REQUIRED', message);
    const autoRetries = pub.publishing.autoRetries || 0;
    const error = { kind, message, code: err.providerCode || null, action: NEXT_ACTION[kind] || NEXT_ACTION.UNKNOWN, at: nowIso(), attempt: pub.publishing.attempts };
    updateAttempt(pub, { outcome: 'FAILED', error: { kind, message, code: err.providerCode || null }, finishedAt: nowIso(), durationMs: Date.now() - job.startedAtMs });
    // The publish call was answered with an error, so it did not happen.
    pub.publishing.publishRequestedAt = null;
    if (kind === 'MEDIA' || kind === 'INVALID') { pub.publishing.containerId = null; pub.publishing.childIds = []; }
    if (retryable && autoRetries < MAX_AUTO_RETRIES) {
      pub.status = 'SCHEDULED';
      pub.error = { ...error, retrying: true };
      pub.publishing = { ...pub.publishing, autoRetries: autoRetries + 1, nextAttemptAt: new Date(Date.now() + backoffMs(kind, autoRetries + 1)).toISOString(), lockId: null, lockedUntil: null, phase: 'RETRY_SCHEDULED' };
      recordEvent('social.publish_retry', 'Nova tentativa de publicação agendada', { publicationId: pub.id, kind, retry: autoRetries + 1 }, 'warn');
      return { pubId: pub.id, outcome: 'RETRY', kind };
    }
    pub.status = 'FAILED';
    pub.error = error;
    pub.publishing = { ...pub.publishing, lockId: null, lockedUntil: null, phase: 'FAILED', nextAttemptAt: null };
    afterTransition(SYSTEM_ACTOR, pub, 'publication.failed', { previousStatus: 'PUBLISHING', details: { kind } });
    recordEvent('social.publish_failed', 'Falha ao publicar', { publicationId: pub.id, kind, code: err.providerCode || null }, 'error');
    return { pubId: pub.id, outcome: 'FAILED', kind };
  });
}

// ------------------------------------------------------------------ steps

async function verifyRequestedPublish(job, provider) {
  // media_publish was called before but its outcome was not recorded.
  const status = await provider.containerStatus(job.token, job.publishing.containerId);
  if (status.status === 'PUBLISHED') {
    const found = await provider.findPublished(job.token, job.accountId, { caption: job.caption, since: job.publishing.publishRequestedAt }).catch(() => null);
    return complete(job, { externalId: found?.externalId, permalink: found?.permalink, timestamp: found?.timestamp, recovered: true });
  }
  return status;
}

async function processJob(job) {
  const provider = getProvider(job.provider);
  try {
    if ((job.publishing.checks || 0) > MAX_CONTAINER_CHECKS + 5) throw new ProviderError('TRANSIENT', 'Não foi possível confirmar a publicação junto ao Instagram após várias verificações', { retryable: false });
    let status = null;
    if (job.publishing.publishRequestedAt && job.publishing.containerId) {
      const r = await verifyRequestedPublish(job, provider);
      if (r.outcome) return r;
      status = r;
      if (status.status === 'EXPIRED') await saveProgress(job, { containerId: null, childIds: [], publishRequestedAt: null, phase: 'STARTED' });
    }

    if (!job.publishing.containerId && !(job.publishing.childIds || []).length) {
      const quota = await provider.publishingQuota(job.token, job.accountId).catch(() => null);
      if (quota && quota.used >= quota.total) throw new ProviderError('RATE_LIMIT', `Limite de ${quota.total} publicações pela API em 24 horas atingido para esta conta.`);
      const created = await provider.createContainer(job.token, job.accountId, {
        type: job.type, caption: job.caption, locationId: job.locationId, shareToFeed: job.shareToFeed,
        items: job.items.map(i => ({ kind: i.kind, url: signedMediaUrl(i.creativeId) })),
        coverUrl: job.coverId ? signedMediaUrl(job.coverId) : undefined
      });
      await saveProgress(job, { containerId: created.containerId, childIds: created.childIds || [], phase: created.containerId ? 'CONTAINER_CREATED' : 'CHILDREN_CREATED', checks: 0 });
    }

    if (job.type === 'CAROUSEL' && !job.publishing.containerId) {
      const states = [];
      for (const id of job.publishing.childIds) states.push((await provider.containerStatus(job.token, id)).status);
      if (states.some(s => s === 'ERROR')) throw new ProviderError('MEDIA', 'Um dos itens do carrossel foi recusado pelo Instagram', { retryable: false });
      if (states.some(s => s === 'EXPIRED')) { await saveProgress(job, { childIds: [], phase: 'STARTED' }); throw new ProviderError('TRANSIENT', 'Os itens do carrossel expiraram antes da publicação'); }
      if (states.some(s => s !== 'FINISHED')) {
        if ((job.publishing.checks || 0) >= MAX_CONTAINER_CHECKS) throw new ProviderError('TRANSIENT', 'O Instagram demorou demais para processar os vídeos do carrossel');
        return waitForContainer(job);
      }
      const parent = await provider.createCarouselParent(job.token, job.accountId, { childIds: job.publishing.childIds, caption: job.caption, locationId: job.locationId });
      await saveProgress(job, { containerId: parent, phase: 'CONTAINER_CREATED', checks: 0 });
    }

    // Images are usually ready within seconds; videos are checked every minute.
    for (let i = 0; i < IN_TICK_POLLS; i++) {
      status = await provider.containerStatus(job.token, job.publishing.containerId);
      if (status.status !== 'IN_PROGRESS') break;
      if (job.items.some(it => it.kind === 'video')) break;
      await sleep(IN_TICK_POLL_MS);
    }
    if (status.status === 'IN_PROGRESS') {
      if ((job.publishing.checks || 0) >= MAX_CONTAINER_CHECKS) throw new ProviderError('TRANSIENT', 'O Instagram demorou demais para processar a mídia');
      await saveProgress(job, { phase: 'WAITING_CONTAINER' });
      return waitForContainer(job);
    }
    if (status.status === 'ERROR') throw new ProviderError('MEDIA', `O Instagram não conseguiu processar a mídia${status.detail ? `: ${status.detail}` : ''}`, { retryable: false });
    if (status.status === 'EXPIRED') { await saveProgress(job, { containerId: null, childIds: [], phase: 'STARTED' }); throw new ProviderError('TRANSIENT', 'O container expirou antes da publicação'); }
    if (status.status === 'PUBLISHED') return complete(job, { recovered: true });

    // FINISHED: record the intent first, then publish.
    await saveProgress(job, { publishRequestedAt: nowIso(), phase: 'PUBLISH_REQUESTED' });
    let published;
    try {
      published = await provider.publishContainer(job.token, job.accountId, job.publishing.containerId);
    } catch (err) {
      // No answer: it may or may not have been published. Verify next tick
      // (container status) instead of publishing again.
      // A 5xx answer is just as ambiguous as a timeout.
      if (err instanceof ProviderError && err.kind === 'TRANSIENT') return waitForContainer(job);
      throw err;
    }
    const details = await provider.mediaDetails(job.token, published.externalId).catch(() => ({}));
    return complete(job, { externalId: published.externalId, permalink: details.permalink, timestamp: details.timestamp });
  } catch (err) {
    if (err instanceof LeaseLost) return { pubId: job.pubId, outcome: 'LEASE_LOST' };
    if (!(err instanceof ProviderError)) log('error', 'publication worker error', { publicationId: job.pubId, error: err.message });
    try {
      return await failOrRetry(job, err);
    } catch (inner) {
      if (inner instanceof LeaseLost) return { pubId: job.pubId, outcome: 'LEASE_LOST' };
      throw inner;
    }
  }
}

// ------------------------------------------------------------- reminders

// "Publication coming up" reminders, once per publication and schedule.
function remindUpcoming() {
  const now = Date.now();
  const soon = new Date(now + 60 * 60 * 1000).toISOString();
  const nowStr = new Date(now).toISOString();
  db.filter('publications', p => p.status === 'SCHEDULED' && !p.deletedAt && p.scheduledAt > nowStr && p.scheduledAt <= soon).forEach(p => {
    const to = p.responsibleId || p.createdBy;
    if (!to) return;
    notify(to, {
      event: 'creatives', title: 'Publicação em menos de 1 hora',
      description: `"${p.title || 'Publicação'}" será publicada às ${new Date(p.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`,
      workspaceId: p.workspaceId, projectId: p.projectId || null, link: publicationLink(p), dedupeKey: `pub-soon:${p.id}:${p.scheduledAt}`
    });
  });
}

/** One scheduler tick. Returns what happened to each claimed publication. */
export async function runPublicationScheduler({ limit = 5 } = {}) {
  const jobs = await transact(() => { remindUpcoming(); return claimDue(limit); });
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await processJob(job));
    } catch (err) {
      log('error', 'publication job crashed', { publicationId: job.pubId, error: err.message });
      results.push({ pubId: job.pubId, outcome: 'ERROR' });
    }
  }
  return results;
}

// Internal health numbers for the dashboard (no personal data).
export function schedulerHealth(workspaceId) {
  const pubs = db.filter('publications', p => p.workspaceId === workspaceId && !p.deletedAt);
  const attempts = db.filter('publicationAttempts', a => a.workspaceId === workspaceId && a.finishedAt);
  const recent = attempts.filter(a => Date.parse(a.startedAt) > Date.now() - 30 * 86400000);
  const ok = recent.filter(a => a.outcome === 'SUCCESS');
  const now = new Date(Date.now() - 5 * 60000).toISOString();
  return {
    attempts30d: recent.length,
    successRate: recent.length ? Math.round((ok.length / recent.length) * 100) : null,
    avgPublishMs: ok.length ? Math.round(ok.reduce((s, a) => s + (a.durationMs || 0), 0) / ok.length) : null,
    delayed: pubs.filter(p => p.status === 'SCHEDULED' && p.scheduledAt < now && !p.publishing?.nextAttemptAt).length,
    retrying: pubs.filter(p => p.status === 'SCHEDULED' && p.publishing?.nextAttemptAt).length,
    failed: pubs.filter(p => p.status === 'FAILED').length,
    accountsNeedingAction: db.filter('socialAccounts', a => a.workspaceId === workspaceId && ['REAUTH_REQUIRED', 'EXPIRED', 'ERROR'].includes(a.status)).length
  };
}
