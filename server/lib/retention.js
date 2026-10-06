// Data retention: removes or pseudonymizes data whose retention period has
// expired. Periods are configurable in the Admin Center (systemSettings.retention)
// and documented in docs/lgpd/retencao.md. 0 means "keep indefinitely".
import { db } from '../db.js';
import { trimAudit, recordEvent } from './observability.js';
import { purgeProject, purgeTask, purgeFile } from './purge.js';

export const DEFAULT_RETENTION = {
  notificationsDays: 180,
  trashDays: 30,
  invitationsDays: 30,
  systemEventsDays: 90,
  webhookDeliveriesDays: 30,
  automationLogsDays: 90,
  auditLogsDays: 730,
  auditIpDays: 90,
  closedIncidentsDays: 1825,
  privacyRequestsDays: 1825,
  backupsKeep: 14,
  publicationAttemptsDays: 365
};

export const retentionSettings = () => ({ ...DEFAULT_RETENTION, ...(db.data.systemSettings?.retention || {}) });

const olderThan = (iso, days) => days > 0 && iso && Date.parse(iso) < Date.now() - days * 86400000;

// Keeps the network prefix only (e.g. 189.40.12.x), enough for incident context.
const truncateIp = ip => {
  if (!ip) return ip;
  if (ip.includes('.')) return ip.replace(/^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/, '$1.x');
  return ip.split(':').slice(0, 3).join(':') + '::x';
};

export function runRetention() {
  const r = retentionSettings();
  const counts = {};
  const drop = (collection, pred) => {
    const before = db.get(collection).length;
    db.data[collection] = db.get(collection).filter(x => !pred(x));
    counts[collection] = before - db.data[collection].length;
  };

  drop('notifications', n => olderThan(n.createdAt, r.notificationsDays));
  drop('invitations', i => olderThan(i.expiresAt, r.invitationsDays) || olderThan(i.usedAt, r.invitationsDays) || olderThan(i.revokedAt, r.invitationsDays));
  drop('systemEvents', e => olderThan(e.createdAt, r.systemEventsDays));
  drop('webhookDeliveries', d => olderThan(d.createdAt, r.webhookDeliveriesDays));
  drop('automationLogs', l => olderThan(l.timestamp, r.automationLogsDays));
  drop('securityIncidents', i => i.status === 'closed' && olderThan(i.updatedAt, r.closedIncidentsDays));
  drop('privacyRequests', p => p.status === 'completed' && olderThan(p.updatedAt, r.privacyRequestsDays));
  drop('publicationAttempts', a => a.finishedAt && olderThan(a.finishedAt, r.publicationAttemptsDays));

  // Trash: items past the period are permanently deleted.
  let purged = 0;
  db.filter('projects', p => olderThan(p.deletedAt, r.trashDays)).forEach(p => { purgeProject(p.id); purged++; });
  db.filter('tasks', t => olderThan(t.deletedAt, r.trashDays)).forEach(t => { purgeTask(t.id); purged++; });
  db.filter('files', f => olderThan(f.deletedAt, r.trashDays)).forEach(f => { purgeFile(f.id); purged++; });
  counts.trash = purged;

  // Audit log: old entries are removed (chain anchor preserved); IPs are
  // truncated and device strings dropped after the shorter period.
  const logs = db.get('auditLogs');
  const firstKept = logs.findIndex(l => !olderThan(l.timestamp, r.auditLogsDays));
  const expired = firstKept === -1 ? logs.length : firstKept;
  if (r.auditLogsDays > 0 && expired > 0) { trimAudit(expired); counts.auditLogs = expired; }
  let truncated = 0;
  db.get('auditLogs').forEach(l => {
    if (l.ip && !l.ipTruncated && olderThan(l.timestamp, r.auditIpDays)) { l.ip = truncateIp(l.ip); l.device = null; l.ipTruncated = true; truncated++; }
  });
  counts.auditIpsTruncated = truncated;

  db.save();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total) recordEvent('retention.run', `Retenção aplicada: ${total} registro(s)`, counts);
  return counts;
}
