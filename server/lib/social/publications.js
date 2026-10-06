// Publication domain: lifecycle rules, presentation and the side effects of
// each transition (approval history, notifications, audit, automations).
// Routes and the scheduler both go through these helpers, so a publication
// can only move along the documented state machine:
//
//   DRAFT ─► PENDING_APPROVAL ─► APPROVED ─► SCHEDULED ─► PUBLISHING ─► PUBLISHED
//     ▲            │ (rejeitar, com motivo)        │             │
//     └────────────┘                               │             └─► FAILED ─► (retry) ─► SCHEDULED
//   CANCELLED ◄── (cancelar) ── DRAFT / PENDING_APPROVAL / APPROVED / SCHEDULED / FAILED
//
// PUBLISHED is only ever set after the network API confirms the publication.
import { db, newId } from '../../db.js';
import { notify, recordActivity, emit } from '../events.js';
import { audit } from '../observability.js';
import { roleHas, workspaceRole } from '../rbac.js';
import { PUBLICATION_TYPES, validatePublication, publicationWarnings } from './rules.js';

export const SYSTEM_ACTOR = { auditActor: 'Sistema (agendador de publicações)', headers: {} };

// Statuses whose content (media, caption, type) may still be edited.
export const CONTENT_EDITABLE = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'FAILED', 'CANCELLED'];
// Statuses that can still be cancelled.
export const CANCELLABLE = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'FAILED'];

export const requiresApproval = workspace => workspace?.settings?.creatives?.requireApproval !== false;

export const publicationLink = pub => `/creatives/${pub.socialAccountId}/publications?pub=${encodeURIComponent(pub.id)}`;

export function slimCreative(c) {
  if (!c) return null;
  return {
    id: c.id, name: c.name, kind: c.kind, mimeType: c.mimeType, width: c.width, height: c.height,
    durationMs: c.durationMs, size: c.size, hasThumb: Boolean(c.thumbKey), available: !c.deletedAt && Boolean(c.storageKey),
    warnings: c.warnings || []
  };
}

export function resolveMedia(pub) {
  return [...(pub.media || [])].sort((a, b) => a.order - b.order).map(m => db.find('creatives', c => c.id === m.creativeId && c.workspaceId === pub.workspaceId) || null);
}

export function resolveCover(pub) {
  return pub.coverCreativeId ? db.find('creatives', c => c.id === pub.coverCreativeId && c.workspaceId === pub.workspaceId) || null : null;
}

export function problemsFor(pub) {
  return validatePublication(pub, resolveMedia(pub), { cover: resolveCover(pub) });
}

// What the browser receives. Locks and internal ids stay on the server.
export function presentPublication(pub) {
  const media = resolveMedia(pub);
  const { publishing = {} } = pub;
  return {
    ...pub,
    media: [...(pub.media || [])].sort((a, b) => a.order - b.order).map((m, i) => ({ creativeId: m.creativeId, order: m.order, creative: slimCreative(media[i]) })),
    cover: slimCreative(resolveCover(pub)),
    publishing: {
      phase: publishing.phase || null,
      attempts: publishing.attempts || 0,
      nextAttemptAt: publishing.nextAttemptAt || null,
      startedAt: publishing.startedAt || null
    },
    problems: CONTENT_EDITABLE.includes(pub.status) ? validatePublication(pub, media, { cover: resolveCover(pub) }) : [],
    warnings: publicationWarnings(pub, media)
  };
}

// --------------------------------------------------------------- people

function membersWith(workspace, permission) {
  const ids = [workspace.ownerId, ...workspace.members.map(m => m.userId)];
  return [...new Set(ids)].filter(id => {
    const user = db.find('users', u => u.id === id);
    return user && roleHas(workspaceRole(user, workspace), permission);
  });
}

function notifyMany(ids, payload, actor) {
  [...new Set(ids.filter(Boolean))].forEach(id => notify(id, { event: 'creatives', actor, ...payload }));
}

const label = pub => pub.title || 'Publicação sem título';

export function accountLabel(pub) {
  const account = db.find('socialAccounts', a => a.id === pub.socialAccountId);
  return account ? `@${account.username}` : 'conta removida';
}

// ------------------------------------------------------------ side effects

export function recordApproval(pub, action, actor, reason = null) {
  db.insert('publicationApprovals', {
    id: newId('pap'), publicationId: pub.id, workspaceId: pub.workspaceId, action,
    actorId: actor?.id || null, actorName: actor?.name || 'Sistema', reason, at: new Date().toISOString()
  });
}

/**
 * Applies side effects of a transition. `req` is the Express request (or
 * SYSTEM_ACTOR for the scheduler). `event` is one of the automation triggers.
 */
export function afterTransition(req, pub, event, { reason = null, previousStatus = null, details = {} } = {}) {
  const workspace = db.find('workspaces', w => w.id === pub.workspaceId);
  if (!workspace) return;
  const actor = req?.user || null;
  const link = publicationLink(pub);
  const common = { workspaceId: pub.workspaceId, projectId: pub.projectId || null, link };
  const who = actor?.name || 'Sistema';

  const AUDIT = {
    'publication.created': 'PUBLICATION_CREATED',
    'publication.submitted': 'PUBLICATION_SUBMITTED',
    'publication.approved': 'PUBLICATION_APPROVED',
    'publication.rejected': 'PUBLICATION_REJECTED',
    'publication.scheduled': 'PUBLICATION_SCHEDULED',
    'publication.rescheduled': 'PUBLICATION_RESCHEDULED',
    'publication.unscheduled': 'PUBLICATION_UNSCHEDULED',
    'publication.publishing': 'PUBLICATION_PUBLISHING',
    'publication.published': 'PUBLICATION_PUBLISHED',
    'publication.failed': 'PUBLICATION_FAILED',
    'publication.cancelled': 'PUBLICATION_CANCELLED',
    'publication.reopened': 'PUBLICATION_REOPENED',
    'publication.retry': 'PUBLICATION_RETRY',
    'publication.edited': 'PUBLICATION_EDITED',
    'publication.deleted': 'PUBLICATION_DELETED'
  };
  if (AUDIT[event]) {
    audit(req || SYSTEM_ACTOR, {
      action: AUDIT[event],
      entity: `Publicação ${pub.id} — ${label(pub)} (${accountLabel(pub)})`,
      workspaceId: pub.workspaceId,
      category: 'creatives',
      result: event === 'publication.failed' ? 'FAILURE' : 'SUCCESS',
      details: { publicationId: pub.id, from: previousStatus, to: pub.status, reason: reason || undefined, ...details }
    });
  }

  const ACTIVITY = {
    'publication.created': 'criou a publicação',
    'publication.submitted': 'enviou para aprovação',
    'publication.approved': 'aprovou a publicação',
    'publication.rejected': 'rejeitou a publicação',
    'publication.scheduled': 'agendou a publicação',
    'publication.published': 'publicação confirmada pelo Instagram',
    'publication.failed': 'falha ao publicar',
    'publication.cancelled': 'cancelou a publicação'
  };
  if (ACTIVITY[event]) {
    recordActivity({ workspaceId: pub.workspaceId, projectId: pub.projectId || null, taskId: pub.taskId || null, actor: actor || { name: 'Agendador' }, type: event, message: `${ACTIVITY[event]} "${label(pub)}" (${accountLabel(pub)})` });
  }

  const owners = [pub.responsibleId, pub.createdBy];
  switch (event) {
    case 'publication.submitted':
      notifyMany(membersWith(workspace, 'creatives.approve'), { title: 'Publicação aguardando aprovação', description: `${who} enviou "${label(pub)}" (${accountLabel(pub)}) para aprovação`, ...common }, actor);
      break;
    case 'publication.approved':
      notifyMany(owners, { title: 'Publicação aprovada', description: `"${label(pub)}" foi aprovada por ${who}`, ...common }, actor);
      break;
    case 'publication.rejected':
      notifyMany(owners, { title: 'Publicação rejeitada', description: `"${label(pub)}" foi rejeitada por ${who}. Motivo: ${reason}`, ...common }, actor);
      break;
    case 'publication.published':
      notifyMany(owners, { title: 'Publicação no ar', description: `"${label(pub)}" foi publicada em ${accountLabel(pub)}`, ...common }, null);
      break;
    case 'publication.failed':
      notifyMany([...owners, ...membersWith(workspace, 'creatives.publish')], { title: 'Falha ao publicar', description: `"${label(pub)}" (${accountLabel(pub)}): ${pub.error?.message || 'erro desconhecido'}`, ...common, dedupeKey: `pub-failed:${pub.id}:${pub.publishing?.attempts || 0}` }, null);
      break;
    default:
  }

  const AUTOMATION_EVENT = {
    'publication.created': 'publication.created',
    'publication.approved': 'publication.approved',
    'publication.rejected': 'publication.rejected',
    'publication.scheduled': 'publication.scheduled',
    'publication.publishing': 'publication.publishing',
    'publication.published': 'publication.published',
    'publication.failed': 'publication.failed'
  }[event];
  if (AUTOMATION_EVENT) emit({ type: AUTOMATION_EVENT, workspaceId: pub.workspaceId, publication: pub, actor });
}

// Account-level problems (token expired, revoked…) reach the people who can fix them.
export function notifyAccountProblem(account, title, description) {
  const workspace = db.find('workspaces', w => w.id === account.workspaceId);
  if (!workspace) return;
  notifyMany(membersWith(workspace, 'creatives.manage_accounts'), {
    title, description, workspaceId: account.workspaceId, link: `/creatives/${account.id}/feed`,
    dedupeKey: `acct:${account.id}:${account.status}:${(account.statusChangedAt || '').slice(0, 10)}`
  }, null);
}

export { PUBLICATION_TYPES };
