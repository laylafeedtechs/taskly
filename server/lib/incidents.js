// Security incident register and detection rules.
//
// Detection only opens a *suspected* incident for triage. Whether it is a
// personal-data incident that may cause relevant risk or damage (and so must
// be communicated to the ANPD and data subjects) is a human assessment,
// recorded on the incident itself.
import { db, newId } from '../db.js';
import { onAudit, recordEvent } from './observability.js';
import { notify } from './events.js';

const HOUR = 60 * 60 * 1000;

// Rules evaluated against the audit trail. `key` groups related events so a
// burst creates one incident per window instead of one per event.
const RULES = [
  { id: 'brute_force_account', match: e => e.action === 'LOGIN_FAILED', key: e => `acct:${e.actor}`, threshold: 10, severity: 'high', title: 'Possível ataque de força bruta contra uma conta' },
  { id: 'brute_force_ip', match: e => e.action === 'LOGIN_FAILED', key: e => `ip:${e.ip}`, threshold: 30, severity: 'high', title: 'Muitas falhas de login a partir do mesmo IP' },
  { id: 'authorization_probing', match: e => e.result === 'BLOCKED' && ['security', 'permissions'].includes(e.category), key: e => `actor:${e.actorId || e.ip}`, threshold: 15, severity: 'high', title: 'Tentativas repetidas de acesso não autorizado ou escalonamento de privilégio' },
  { id: 'switch_denied', match: e => e.action === 'ACCOUNT_SWITCH_DENIED', key: e => `actor:${e.actorId}`, threshold: 3, severity: 'high', title: 'Tentativas de troca de conta não autorizadas' },
  { id: 'mass_export', match: e => ['REPORT_EXPORT', 'PERSONAL_DATA_EXPORT'].includes(e.action), key: e => `actor:${e.actorId}`, threshold: 10, severity: 'medium', title: 'Volume incomum de exportações de dados' },
  { id: 'mass_deletion', match: e => /PERMANENT_DELETE|USER_DELETE|BULK_TASK_DELETE/.test(e.action), key: e => `actor:${e.actorId}`, threshold: 20, severity: 'medium', title: 'Volume incomum de exclusões' },
  { id: 'mfa_failures', match: e => e.action === 'MFA_FAILED', key: e => `actor:${e.actorId}`, threshold: 5, severity: 'high', title: 'Falhas repetidas na verificação em duas etapas' },
  { id: 'impersonation', match: e => e.action === 'IMPERSONATION_STARTED', key: e => `imp:${e.id}`, threshold: 1, severity: 'low', title: 'Acesso de suporte (impersonação) iniciado' }
];

function openIncident(rule, entries) {
  const now = new Date().toISOString();
  const incident = {
    id: newId('inc'),
    rule: rule.id,
    title: rule.title,
    severity: rule.severity,
    status: 'open', // open → investigating → closed
    detectedAt: now,
    evidence: entries.slice(-50).map(e => e.id),
    summary: `${entries.length} evento(s) em até 1 hora. Último: ${entries[entries.length - 1].action} — ${entries[entries.length - 1].entity}`,
    assessment: { involvesPersonalData: null, relevantRisk: null, communicationRequired: null, confirmedAt: null, communicationDeadline: null, communicatedAt: null },
    notes: [],
    updatedAt: now
  };
  db.insert('securityIncidents', incident);
  recordEvent('security.incident_opened', incident.title, { incidentId: incident.id, rule: rule.id }, rule.severity === 'low' ? 'info' : 'warn');
  if (rule.severity !== 'low') {
    db.filter('users', u => u.isSuperAdmin && u.status === 'ACTIVE').forEach(admin => notify(admin.id, {
      event: 'security', title: `Alerta de segurança: ${incident.title}`, description: incident.summary, dedupeKey: `incident:${incident.id}`
    }));
  }
  return incident;
}

function evaluate(entry) {
  const since = Date.now() - HOUR;
  const logs = db.get('auditLogs');
  RULES.forEach(rule => {
    if (!rule.match(entry)) return;
    const k = rule.key(entry);
    const window = [];
    for (let i = logs.length - 1; i >= 0 && Date.parse(logs[i].timestamp) >= since; i--) {
      if (rule.match(logs[i]) && rule.key(logs[i]) === k) window.unshift(logs[i]);
    }
    if (window.length < rule.threshold) return;
    const dedupe = `${rule.id}:${k}`;
    const recent = db.find('securityIncidents', i => i.dedupeKey === dedupe && Date.parse(i.detectedAt) >= since);
    if (recent) {
      recent.evidence = [...new Set([...recent.evidence, entry.id])].slice(-200);
      recent.updatedAt = new Date().toISOString();
      db.save();
      return;
    }
    const incident = openIncident(rule, window);
    incident.dedupeKey = dedupe;
    db.save();
  });
}

export function startIncidentDetection() {
  onAudit(evaluate);
}

// Adds N business days (Mon–Fri) to a date. National holidays are not
// considered — the deadline shown is a reference to be checked by the DPO.
export function addBusinessDays(fromIso, days) {
  const d = new Date(fromIso);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString();
}
