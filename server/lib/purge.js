// Irreversible deletion of trashed resources, shared by the Trash (manual)
// and the retention job (automatic). Callers are responsible for authorization.
import { db } from '../db.js';
import { deleteStored } from './storage.js';

const removeStored = keys => keys.forEach(k => { try { deleteStored(k); } catch { /* already gone */ } });

export function purgeTask(id) {
  const ids = new Set([id, ...db.filter('tasks', t => t.subtaskOf === id).map(t => t.id)]);
  db.transaction(() => {
    db.filter('files', f => ids.has(f.taskId)).forEach(f => { f.taskId = null; });
    db.remove('tasks', t => ids.has(t.id));
    db.get('tasks').forEach(t => { t.blockedBy = (t.blockedBy || []).filter(b => !ids.has(b)); });
  });
}

export function purgeProject(id) {
  const keys = db.filter('files', f => f.projectId === id).map(f => f.storageKey).filter(Boolean);
  db.transaction(() => {
    const taskIds = new Set(db.filter('tasks', t => t.projectId === id).map(t => t.id));
    ['tasks', 'columns', 'milestones', 'files'].forEach(c => db.remove(c, x => x.projectId === id));
    db.remove('automations', a => a.projectId === id);
    db.get('tasks').forEach(t => { t.blockedBy = (t.blockedBy || []).filter(b => !taskIds.has(b)); });
    db.get('users').forEach(u => { u.favoriteProjects = (u.favoriteProjects || []).filter(p => p !== id); });
    db.remove('projects', p => p.id === id);
  });
  removeStored(keys);
}

export function purgeFile(id) {
  const file = db.find('files', f => f.id === id);
  db.remove('files', f => f.id === id);
  if (file?.storageKey) removeStored([file.storageKey]);
}

// Deletes an entire workspace and everything in it (used by account deletion
// for workspaces the user owns alone).
export function purgeWorkspace(wsId) {
  db.filter('projects', p => p.workspaceId === wsId).forEach(p => purgeProject(p.id));
  // Criativos: files, synced previews and avatars; credentials are deleted with the rows.
  const socialKeys = [
    ...db.filter('creatives', c => c.workspaceId === wsId).flatMap(c => [c.storageKey, c.thumbKey]),
    ...db.filter('socialMedia', m => m.workspaceId === wsId).map(m => m.previewKey),
    ...db.filter('socialAccounts', a => a.workspaceId === wsId).map(a => a.avatarKey)
  ].filter(Boolean);
  db.transaction(() => {
    ['socialAccounts', 'socialCredentials', 'socialMedia', 'creatives', 'campaigns', 'publications', 'publicationApprovals', 'publicationAttempts'].forEach(c => db.remove(c, x => x.workspaceId === wsId));
    ['tasks', 'automations', 'automationLogs', 'apiKeys', 'webhooks', 'webhookDeliveries', 'savedReports', 'invitations', 'activity', 'files'].forEach(c => db.remove(c, x => x.workspaceId === wsId));
    db.remove('projectTemplates', t => t.workspaceId === wsId);
    db.remove('notifications', n => n.workspaceId === wsId);
    db.remove('workspaces', w => w.id === wsId);
  });
  removeStored(socialKeys);
}
