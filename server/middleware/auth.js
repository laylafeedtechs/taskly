import crypto from 'crypto';
import { db, newId } from '../db.js';
import { unauthorized, forbidden, notFound, HttpError } from '../lib/http.js';
import { workspaceRole, roleHas, apiKeyAllows } from '../lib/rbac.js';
import { audit, recordEvent } from '../lib/observability.js';
import { notify } from '../lib/events.js';

export const SESSION_COOKIE = 'taskly_session';
const IDLE_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;
const isProd = process.env.NODE_ENV === 'production';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Explicit allowlist of the fields a user may see about their own account.
// Internal/security fields (hashes, MFA secret, lockout counters, device
// fingerprints, storage keys) are never serialized.
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified !== false,
    avatar: user.avatar || null,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    status: user.status,
    dashboardLayout: user.dashboardLayout,
    favoriteProjects: user.favoriteProjects || [],
    onboardingCompleted: Boolean(user.onboardingCompleted),
    preferences: user.preferences,
    notificationPreferences: user.notificationPreferences,
    policyAcceptedVersion: user.policyAcceptedVersion || null,
    hasPassword: Boolean(user.passwordHash),
    googleLinked: Boolean(user.googleSub),
    mfaEnabled: Boolean(user.mfa?.enabled),
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt
  };
}

// ---------------------------------------------------------------- sessions

function sessionMaxAgeMs() {
  return (db.data.systemSettings?.sessionDays || 7) * 24 * 60 * 60 * 1000;
}

const deviceFingerprint = req => sha256(String(req.headers['user-agent'] || '')).slice(0, 16);

// Warns the user when their account is accessed from a device not seen before.
function checkNewDevice(req, user) {
  const fp = deviceFingerprint(req);
  const known = user.knownDevices || [];
  if (known.includes(fp)) return;
  if (known.length) {
    notify(user.id, {
      event: 'security',
      title: 'Novo acesso à sua conta',
      description: `Um novo dispositivo acessou sua conta em ${new Date().toLocaleString('pt-BR')}. Se não foi você, altere sua senha e encerre as outras sessões em Configurações → Segurança.`
    });
    audit(req, { action: 'LOGIN_NEW_DEVICE', entity: `Usuário ${user.id}`, category: 'auth' });
  }
  user.knownDevices = [...known, fp].slice(-10);
}

export function createSession(res, req, user, { impersonatorId = null, impersonationReason = null, impersonatorMfa = false, mfa = false } = {}) {
  const token = randomToken();
  const now = Date.now();
  const maxAge = impersonatorId ? 2 * 60 * 60 * 1000 : sessionMaxAgeMs();
  db.insert('sessions', {
    id: newId('ses'),
    tokenHash: sha256(token),
    userId: user.id,
    impersonatorId,
    impersonationReason,
    impersonatorMfa: Boolean(impersonatorMfa),
    mfa: Boolean(mfa),
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAge).toISOString(),
    ip: req.ip || null,
    device: String(req.headers['user-agent'] || '').slice(0, 200)
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge
  });
  if (!impersonatorId) {
    const stored = db.find('users', u => u.id === user.id);
    stored.lastLoginAt = new Date(now).toISOString();
    checkNewDevice(req, stored);
    db.save();
  }
  return token;
}

export function destroySession(req, res) {
  if (req.session) db.remove('sessions', s => s.id === req.session.id);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' });
}

export function revokeUserSessions(userId, exceptSessionId = null) {
  db.remove('sessions', s => s.userId === userId && s.id !== exceptSessionId);
}

function resolveSession(token) {
  const session = db.find('sessions', s => s.tokenHash === sha256(token));
  if (!session) return null;
  const now = Date.now();
  if (Date.parse(session.expiresAt) < now || now - Date.parse(session.lastSeenAt) > IDLE_TIMEOUT_MS) {
    db.remove('sessions', s => s.id === session.id);
    return null;
  }
  // Only persist the heartbeat once a minute to keep writes cheap.
  if (now - Date.parse(session.lastSeenAt) > 60000) {
    session.lastSeenAt = new Date(now).toISOString();
    db.save();
  }
  return session;
}

export function purgeExpiredSessions() {
  const now = Date.now();
  db.remove('sessions', s => Date.parse(s.expiresAt) < now || now - Date.parse(s.lastSeenAt) > IDLE_TIMEOUT_MS);
  ['passwordResets', 'mfaChallenges', 'emailVerifications', 'oauthStates'].forEach(c => db.remove(c, r => Date.parse(r.expiresAt) < now));
}

// ---------------------------------------------------------- authentication

export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer tsk_live_')) return authenticateApiKey(req, header.slice(7), next);

  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(unauthorized());

  const session = resolveSession(token);
  if (!session) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next(unauthorized('Sua sessão expirou. Entre novamente.'));
  }
  const user = db.find('users', u => u.id === session.userId);
  if (!user) return next(unauthorized());
  if (user.status === 'BLOCKED') {
    db.remove('sessions', s => s.userId === user.id);
    return next(forbidden('Esta conta foi suspensa por um administrador'));
  }
  req.user = user;
  req.session = session;
  next();
}

function authenticateApiKey(req, secret, next) {
  const key = db.find('apiKeys', k => k.keyHash === sha256(secret) && !k.revokedAt && (!k.expiresAt || Date.parse(k.expiresAt) > Date.now()));
  if (!key) {
    recordEvent('auth.api_key_invalid', 'Tentativa com chave de API inválida', { ip: req.ip }, 'warn');
    return next(unauthorized('Chave de API inválida ou revogada'));
  }
  const user = db.find('users', u => u.id === key.createdBy);
  if (!user || user.status === 'BLOCKED') return next(unauthorized('Chave de API sem usuário ativo'));
  key.lastUsedAt = new Date().toISOString();
  db.save();
  req.user = user;
  req.apiKey = key;
  next();
}

// Routes that manage the account itself are only available to browser sessions.
export function sessionOnly(req, res, next) {
  if (req.apiKey) return next(forbidden('Esta rota não aceita chaves de API'));
  next();
}

export function allowedOrigins() {
  const port = process.env.PORT || 5000;
  return new Set([
    process.env.APP_URL || 'http://localhost:3000',
    ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(isProd ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000', `http://localhost:${port}`])
  ]);
}

// Cookie-authenticated state-changing requests must carry a custom header,
// which browsers cannot send cross-site without a CORS preflight that the
// origin allow-list rejects. As defense in depth a foreign Origin is also
// rejected outright — SameSite cookies alone are not relied upon.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if ((req.headers.authorization || '').startsWith('Bearer ')) return next();
  const origin = req.headers.origin;
  if (req.headers['x-requested-with'] !== 'taskly' || (origin && !allowedOrigins().has(origin))) {
    audit(req, { action: 'CSRF_BLOCKED', entity: `${req.method} ${req.path}`, result: 'BLOCKED', category: 'security', details: { origin } });
    return next(new HttpError(403, 'Requisição bloqueada (proteção CSRF)', 'CSRF'));
  }
  next();
}

// Super Admin access requires the server-side flag, a real (non-impersonated)
// session and — unless disabled by the platform — a session verified with MFA.
// Every administrative request is audited, reads included.
export function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin || req.apiKey || req.session?.impersonatorId) {
    audit(req, { action: 'UNAUTHORIZED_ADMIN_ACCESS', entity: req.originalUrl, result: 'BLOCKED', category: 'security' });
    return next(forbidden('Acesso restrito a Super Admins'));
  }
  if (db.data.systemSettings?.requireMfaForAdmins !== false && !(req.user.mfa?.enabled && req.session?.mfa)) {
    audit(req, { action: 'ADMIN_MFA_REQUIRED', entity: req.originalUrl, result: 'BLOCKED', category: 'auth' });
    return next(new HttpError(403, 'Ative a verificação em duas etapas e entre novamente para acessar o Admin Center.', 'MFA_REQUIRED'));
  }
  if (req.method === 'GET') audit(req, { action: 'ADMIN_VIEW', entity: req.originalUrl.split('?')[0], category: 'admin' });
  next();
}

// ------------------------------------------------------------ rate limiting

const buckets = new Map();
export function rateLimit({ windowMs, max, key = req => req.ip, message = 'Muitas requisições. Tente novamente em instantes.' }) {
  return (req, res, next) => {
    const k = `${windowMs}:${max}:${key(req)}`;
    const now = Date.now();
    sweepBuckets(now);
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
    b.count += 1;
    res.setHeader('RateLimit-Remaining', Math.max(max - b.count, 0));
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
      return next(new HttpError(429, message, 'RATE_LIMITED'));
    }
    next();
  };
}
// Expired buckets are swept lazily (no timers: Workers forbid them at module
// scope). Note: on Workers these counters are per isolate, not global.
let lastSweep = 0;
function sweepBuckets(now) {
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}

// ----------------------------------------------- workspace & resource access

export function accessibleWorkspaces(user, { includeArchived = false } = {}) {
  return db.get('workspaces').filter(w => {
    if (!includeArchived && w.archivedAt) return false;
    return w.ownerId === user.id || w.members.some(m => m.userId === user.id);
  });
}

// Resolves the caller's role in a workspace or throws 404 (never leaks existence).
export function authorizeWorkspace(req, workspaceId, permission, scope) {
  const workspace = db.find('workspaces', w => w.id === workspaceId);
  const role = workspaceRole(req.user, workspace);
  if (!workspace || !role) {
    if (workspace) audit(req, { action: 'UNAUTHORIZED_WORKSPACE_ACCESS', entity: `Workspace ${workspaceId}`, result: 'BLOCKED', category: 'security' });
    throw notFound('Workspace não encontrado');
  }
  if (req.apiKey) {
    if (req.apiKey.workspaceId !== workspace.id) throw notFound('Workspace não encontrado');
    if (!apiKeyAllows(req.apiKey, scope)) throw forbidden('A chave de API não possui o escopo necessário');
  }
  if (permission && !roleHas(role, permission)) {
    throw forbidden('Seu papel neste workspace não permite esta ação');
  }
  req.workspace = workspace;
  req.wsRole = role;
  return { workspace, role };
}

// Middleware for routes addressed by workspace id (":wsId").
export function workspaceAccess(permission = null, scope = null) {
  return (req, res, next) => {
    authorizeWorkspace(req, req.params.wsId, permission, scope);
    next();
  };
}

// Given a resource, finds the workspace that owns it.
const OWNER_RESOLVERS = {
  tasks: t => t.workspaceId,
  projects: p => p.workspaceId,
  automations: a => a.workspaceId,
  webhooks: w => w.workspaceId,
  apiKeys: k => k.workspaceId,
  savedReports: r => r.workspaceId,
  files: f => f.workspaceId,
  milestones: m => db.find('projects', p => p.id === m.projectId)?.workspaceId,
  columns: c => db.find('projects', p => p.id === c.projectId)?.workspaceId,
  projectTemplates: t => t.workspaceId
};

// Loads a resource by id and authorizes the caller against its workspace.
// Resources in inaccessible workspaces are reported as not found (anti-IDOR).
export function loadResource(req, collection, id, permission, { scope = null, includeDeleted = false } = {}) {
  const item = db.find(collection, x => x.id === id);
  if (!item || (!includeDeleted && item.deletedAt)) throw notFound();
  const wsId = OWNER_RESOLVERS[collection](item);
  if (!wsId) throw notFound();
  try {
    authorizeWorkspace(req, wsId, permission, scope);
  } catch (err) {
    if (err.status === 404) throw notFound();
    throw err;
  }
  return item;
}

export function resource(collection, permission, opts = {}) {
  return (req, res, next) => {
    req.resource = loadResource(req, collection, req.params[opts.param || 'id'], permission, opts);
    next();
  };
}
