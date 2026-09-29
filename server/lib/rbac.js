// Role-based access control. This file is the single source of truth for
// what each workspace role can do; the permission matrix shown in the UI is
// generated from it, and every protected route checks it on the server.

export const PERMISSIONS = {
  'project.view': 'Ver projetos',
  'project.create': 'Criar projetos',
  'project.edit': 'Editar projetos',
  'project.delete': 'Excluir e arquivar projetos',
  'task.create': 'Criar tarefas',
  'task.edit': 'Editar e mover tarefas',
  'task.delete': 'Excluir tarefas',
  'task.comment': 'Comentar em tarefas',
  'files.upload': 'Enviar arquivos',
  'files.delete': 'Excluir arquivos',
  'members.manage': 'Gerenciar membros e convites',
  'automations.manage': 'Gerenciar automações',
  'workspace.manage': 'Gerenciar workspace',
  'apikeys.manage': 'Gerenciar chaves de API',
  'webhooks.manage': 'Gerenciar webhooks',
  'reports.view': 'Ver relatórios',
  'reports.export': 'Exportar relatórios',
  'trash.purge': 'Excluir permanentemente da lixeira',
  'billing.manage': 'Gerenciar cobrança'
};

const ALL = Object.keys(PERMISSIONS);

export const ROLE_PERMISSIONS = {
  Owner: ALL,
  Manager: ALL.filter(p => !['workspace.manage', 'billing.manage'].includes(p)),
  Member: ['project.view', 'project.create', 'project.edit', 'task.create', 'task.edit', 'task.delete', 'task.comment', 'files.upload', 'reports.view', 'reports.export'],
  Viewer: ['project.view', 'task.comment', 'reports.view']
};

// Which roles a given role may assign to others.
export const ASSIGNABLE_ROLES = {
  Owner: ['Owner', 'Manager', 'Member', 'Viewer'],
  Manager: ['Member', 'Viewer'],
  Member: [],
  Viewer: []
};

export function roleHas(role, permission) {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission));
}

export function workspaceRole(user, workspace) {
  if (!user || !workspace) return null;
  if (workspace.ownerId === user.id) return 'Owner';
  // Membership is the only source of tenant access — Super Admins included.
  // Platform support happens through audited impersonation, never implicitly.
  return workspace.members.find(m => m.userId === user.id)?.role || null;
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function permissionMatrix() {
  return Object.entries(PERMISSIONS).map(([key, label]) => ({
    key,
    module: label,
    owner: roleHas('Owner', key),
    manager: roleHas('Manager', key),
    member: roleHas('Member', key),
    viewer: roleHas('Viewer', key)
  }));
}

// API keys carry scopes instead of roles. Routes declare the scope they need;
// routes without a scope are never reachable with an API key.
export const API_SCOPES = ['tasks:read', 'tasks:write', 'projects:read', 'projects:write', 'reports:read'];

export function apiKeyAllows(apiKey, scope) {
  if (!scope) return false;
  if (apiKey.scopes.includes(scope)) return true;
  return scope.endsWith(':read') && apiKey.scopes.includes(scope.replace(':read', ':write'));
}
