// HTTP client for the Taskly API. Authentication uses an HttpOnly session
// cookie set by the server, so no token is ever stored in JavaScript.
const API_BASE = '/api';

export class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(endpoint, { method = 'GET', body, query, raw = false, signal } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]))}` : '';
  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}${qs === '?' ? '' : qs}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'taskly' // required by the server's CSRF guard
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.', 'NETWORK');
  }

  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    const error = new ApiError(res.status, data.error || `Erro ${res.status}`, data.code, data.details);
    if (res.status === 401 && !endpoint.startsWith('/auth/login')) window.dispatchEvent(new CustomEvent('taskly:unauthorized'));
    throw error;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

const get = (u, query, opts) => request(u, { query, ...opts });
const post = (u, body = {}) => request(u, { method: 'POST', body });
const put = (u, body = {}) => request(u, { method: 'PUT', body });
const del = (u, body) => request(u, { method: 'DELETE', body });

// Triggers a browser download for an API response (exports, attachments).
export async function downloadFrom(endpoint, { method = 'GET', body } = {}) {
  const res = await request(endpoint, { method, body, raw: true });
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(disposition);
  const name = match ? decodeURIComponent(match[1] || match[2]) : 'download';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    reader.readAsDataURL(file);
  });
}

export const api = {
  auth: {
    me: () => get('/auth/me'),
    providers: () => get('/auth/providers'),
    login: (email, password) => post('/auth/login', { email, password }),
    signup: (name, email, password, acceptPolicy) => post('/auth/signup', { name, email, password, acceptPolicy }),
    verifyEmail: token => post('/auth/verify-email', { token }),
    resendVerification: () => post('/auth/verify-email/send'),
    logout: () => post('/auth/logout'),
    forgotPassword: email => post('/auth/forgot-password', { email }),
    resetPassword: (token, password) => post('/auth/reset-password', { token, password }),
    changePassword: (currentPassword, newPassword) => post('/auth/change-password', { currentPassword, newPassword }),
    sessions: () => get('/auth/sessions'),
    revokeSession: id => del(`/auth/sessions/${id}`),
    revokeOtherSessions: () => del('/auth/sessions'),
    switchableAccounts: () => get('/auth/switchable-accounts'),
    switchAccount: (userId, reason) => post('/auth/switch', { userId, reason }),
    updateProfile: data => put('/auth/profile', data),
    uploadAvatar: (name, data) => post('/auth/avatar', { name, data }),
    removeAvatar: () => del('/auth/avatar'),
    googleStartUrl: invite => `/api/auth/google/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  },

  mfa: {
    verify: (challenge, { code, recoveryCode }) => post('/auth/mfa/verify', { challenge, code, recoveryCode }),
    setup: password => post('/auth/mfa/setup', { password }),
    enable: code => post('/auth/mfa/enable', { code }),
    disable: ({ password, code, recoveryCode }) => post('/auth/mfa/disable', { password, code, recoveryCode }),
    regenerateCodes: code => post('/auth/mfa/recovery-codes', { code })
  },

  privacy: {
    policy: () => get('/privacy/policy'),
    summary: () => get('/privacy/me/summary'),
    exportData: () => downloadFrom('/privacy/me/export'),
    requests: () => get('/privacy/requests'),
    createRequest: (type, details) => post('/privacy/requests', { type, details }),
    deleteAccount: ({ confirmEmail, password, code }) => del('/privacy/me/account', { confirmEmail, password, code })
  },

  workspaces: {
    list: (archived = false) => get('/workspaces', { archived: archived ? '1' : undefined }),
    create: data => post('/workspaces', data),
    update: (id, data) => put(`/workspaces/${id}`, data),
    archive: (id, archived = true) => post(`/workspaces/${id}/archive`, { archived }),
    leave: id => post(`/workspaces/${id}/leave`),
    invitations: id => get(`/workspaces/${id}/invitations`),
    invite: (id, email, role) => post(`/workspaces/${id}/invitations`, { email, role }),
    revokeInvite: (id, inviteId) => del(`/workspaces/${id}/invitations/${inviteId}`),
    previewInvite: token => get(`/workspaces/invitations/${encodeURIComponent(token)}/preview`),
    acceptInvite: token => post(`/workspaces/invitations/${encodeURIComponent(token)}/accept`)
  },

  team: {
    members: wsId => get(`/team/workspace/${wsId}/members`),
    updateRole: (wsId, userId, role) => put(`/team/workspace/${wsId}/members/${userId}`, { role }),
    remove: (wsId, userId) => del(`/team/workspace/${wsId}/members/${userId}`),
    transferOwnership: (wsId, userId) => post(`/team/workspace/${wsId}/transfer-ownership`, { userId }),
    permissionsMatrix: wsId => get('/team/permissions-matrix', { workspaceId: wsId })
  },

  projects: {
    list: (wsId, archived = false) => get(`/projects/workspace/${wsId}`, { archived: archived ? '1' : undefined }),
    favorites: () => get('/projects/favorites'),
    get: id => get(`/projects/${id}`),
    create: (wsId, data) => post(`/projects/workspace/${wsId}`, data),
    update: (id, data) => put(`/projects/${id}`, data),
    archive: (id, archived = true) => post(`/projects/${id}/archive`, { archived }),
    remove: id => del(`/projects/${id}`),
    duplicate: (id, options) => post(`/projects/${id}/duplicate`, options),
    favorite: (id, favorite) => post(`/projects/${id}/favorite`, { favorite }),
    templates: wsId => get('/projects/templates', { workspaceId: wsId }),
    createTemplate: (wsId, data) => post(`/projects/templates/workspace/${wsId}`, data),
    deleteTemplate: id => del(`/projects/templates/${id}`),
    saveAsTemplate: (id, data) => post(`/projects/${id}/save-as-template`, data),
    milestones: id => get(`/projects/${id}/milestones`),
    createMilestone: (id, data) => post(`/projects/${id}/milestones`, data),
    updateMilestone: (msId, data) => put(`/projects/milestones/${msId}`, data),
    deleteMilestone: msId => del(`/projects/milestones/${msId}`)
  },

  columns: {
    list: projectId => get(`/columns/project/${projectId}`),
    create: (projectId, data) => post(`/columns/project/${projectId}`, data),
    reorder: (projectId, columnIds) => put(`/columns/project/${projectId}/order`, { columnIds }),
    update: (id, data) => put(`/columns/${id}`, data),
    remove: (id, moveTo) => del(`/columns/${id}`, moveTo ? { moveTo } : {})
  },

  tasks: {
    list: (wsId, filters = {}, opts) => get(`/tasks/workspace/${wsId}`, filters, opts),
    get: id => get(`/tasks/${id}`),
    activity: id => get(`/tasks/${id}/activity`),
    create: (wsId, data) => post(`/tasks/workspace/${wsId}`, data),
    update: (id, data) => put(`/tasks/${id}`, data),
    archive: (id, archived = true) => post(`/tasks/${id}/archive`, { archived }),
    remove: id => del(`/tasks/${id}`),
    bulk: (taskIds, action, value, extra = {}) => post('/tasks/bulk', { taskIds, action, value, ...extra }),
    bulkUndo: undo => post('/tasks/bulk/undo', undo),
    addComment: (id, text) => post(`/tasks/${id}/comments`, { text }),
    deleteComment: (id, commentId) => del(`/tasks/${id}/comments/${commentId}`)
  },

  automations: {
    meta: () => get('/automations/meta'),
    list: wsId => get(`/automations/workspace/${wsId}`),
    logs: (wsId, query) => get(`/automations/logs/${wsId}`, query),
    create: (wsId, data) => post(`/automations/workspace/${wsId}`, data),
    update: (id, data) => put(`/automations/${id}`, data),
    remove: id => del(`/automations/${id}`),
    duplicate: id => post(`/automations/${id}/duplicate`)
  },

  notifications: {
    list: query => get('/notifications', query),
    markRead: (id, unread = false) => put(`/notifications/${id}/read`, { unread }),
    bulkRead: ids => post('/notifications/bulk-read', ids ? { notificationIds: ids } : {}),
    bulkUnread: ids => post('/notifications/bulk-unread', { notificationIds: ids }),
    bulkArchive: (ids, archived = true) => post('/notifications/bulk-archive', { notificationIds: ids, archived }),
    bulkDelete: ids => post('/notifications/bulk-delete', { notificationIds: ids }),
    preferences: () => get('/notifications/preferences'),
    updatePreferences: preferences => put('/notifications/preferences', { preferences })
  },

  reports: {
    get: (wsId, filters) => get(`/reports/workspace/${wsId}`, filters),
    saved: wsId => get(`/reports/saved/${wsId}`),
    save: (wsId, data) => post(`/reports/saved/${wsId}`, data),
    updateSaved: (id, data) => put(`/reports/saved/item/${id}`, data),
    duplicateSaved: id => post(`/reports/saved/item/${id}/duplicate`),
    deleteSaved: id => del(`/reports/saved/item/${id}`),
    export: (wsId, format, filters) => downloadFrom(`/reports/export/${wsId}`, { method: 'POST', body: { format, filters } })
  },

  files: {
    list: (projectId, query) => get(`/files/project/${projectId}`, query),
    upload: (projectId, { name, data, taskId }) => post(`/files/project/${projectId}`, { name, data, taskId }),
    rename: (id, name) => put(`/files/${id}`, { name }),
    remove: id => del(`/files/${id}`),
    download: id => downloadFrom(`/files/${id}/download`),
    previewUrl: id => `/api/files/${id}/preview`
  },

  trash: {
    list: wsId => get(`/trash/workspace/${wsId}`),
    restore: (type, id) => post('/trash/restore', { type, id }),
    purge: (type, id) => del('/trash/permanent', { type, id, confirm: true })
  },

  apiKeys: {
    scopes: () => get('/api-keys/scopes'),
    list: wsId => get(`/api-keys/workspace/${wsId}`),
    create: (wsId, data) => post(`/api-keys/workspace/${wsId}`, data),
    update: (id, data) => put(`/api-keys/${id}`, data),
    rotate: id => post(`/api-keys/${id}/rotate`),
    revoke: id => del(`/api-keys/${id}`)
  },

  webhooks: {
    events: () => get('/webhooks/events'),
    list: wsId => get(`/webhooks/workspace/${wsId}`),
    create: (wsId, data) => post(`/webhooks/workspace/${wsId}`, data),
    update: (id, data) => put(`/webhooks/${id}`, data),
    rotateSecret: id => post(`/webhooks/${id}/rotate-secret`),
    remove: id => del(`/webhooks/${id}`),
    test: id => post(`/webhooks/${id}/test`),
    deliveries: (id, query) => get(`/webhooks/${id}/deliveries`, query)
  },

  search: {
    global: (q, opts) => get('/search', { q }, opts),
    activity: query => get('/search/activity', query),
    dashboard: wsId => get(`/search/dashboard/${wsId}`)
  },

  system: {
    flags: () => get('/system/feature-flags'),
    status: () => get('/system/status'),
    reportError: payload => fetch(`${API_BASE}/system/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'taskly' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {})
  },

  admin: {
    dashboard: () => get('/admin/dashboard'),
    users: query => get('/admin/users', query),
    createUser: data => post('/admin/users', data),
    updateUser: (id, data) => put(`/admin/users/${id}`, data),
    setStatus: (id, status) => put(`/admin/users/${id}/status`, { status }),
    deleteUser: id => del(`/admin/users/${id}`, { confirm: true }),
    workspaces: () => get('/admin/workspaces'),
    archiveWorkspace: (id, archived) => post(`/admin/workspaces/${id}/archive`, { archived }),
    projects: () => get('/admin/projects'),
    auditLogs: query => get('/admin/audit-logs', query),
    systemEvents: query => get('/admin/system-events', query),
    flags: () => get('/admin/feature-flags'),
    createFlag: data => post('/admin/feature-flags', data),
    updateFlag: (id, data) => put(`/admin/feature-flags/${id}`, data),
    deleteFlag: id => del(`/admin/feature-flags/${id}`),
    resetMfa: (id, reason) => post(`/admin/users/${id}/reset-mfa`, { reason }),
    retention: () => get('/admin/retention'),
    updateRetention: data => put('/admin/retention', data),
    runRetention: () => post('/admin/retention/run'),
    updatePrivacy: data => put('/admin/privacy', data),
    privacyRequests: query => get('/admin/privacy-requests', query),
    updatePrivacyRequest: (id, data) => put(`/admin/privacy-requests/${id}`, data),
    incidents: query => get('/admin/incidents', query),
    incident: id => get(`/admin/incidents/${id}`),
    updateIncident: (id, data) => put(`/admin/incidents/${id}`, data),
    backups: () => get('/admin/backups'),
    runBackup: () => post('/admin/backups'),
    auditIntegrity: () => get('/admin/audit-integrity'),
    settings: () => get('/admin/settings'),
    updateSettings: data => put('/admin/settings', data)
  }
};
