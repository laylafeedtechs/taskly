import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, newId } from '../db.js';
import {
  authenticate, sessionOnly, createSession, destroySession, revokeUserSessions, publicUser,
  rateLimit, sha256, randomToken, accessibleWorkspaces, SESSION_COOKIE
} from '../middleware/auth.js';
import { v, badRequest, unauthorized, forbidden, notFound } from '../lib/http.js';
import { audit, recordEvent } from '../lib/observability.js';
import { sendMail } from '../lib/mailer.js';
import { notify } from '../lib/events.js';
import { decodeUpload, storeBuffer, deleteStored, resolveStorageKey } from '../lib/storage.js';

const router = express.Router();
const APP_URL = () => process.env.APP_URL || 'http://localhost:3000';
const isProd = process.env.NODE_ENV === 'production';
// Constant-time-ish comparison target so unknown e-mails cost the same as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const WIDGETS = ['metrics', 'my-tasks', 'upcoming', 'overdue', 'projects', 'activity', 'calendar', 'reports', 'notifications'];
const DEFAULT_LAYOUT = ['metrics', 'my-tasks', 'upcoming', 'activity', 'projects'];

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: req => `login:${req.ip}:${String(req.body?.email || '').toLowerCase()}`, message: 'Muitas tentativas de login. Aguarde 15 minutos.' });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: req => `auth:${req.ip}` });

export function createUserWithWorkspace({ name, email, passwordHash = null, googleSub = null, emailVerified = false, policyVersion = null }) {
  const now = new Date().toISOString();
  const user = {
    id: newId('usr'),
    name,
    email,
    emailVerified,
    passwordHash,
    googleSub,
    isSuperAdmin: false,
    avatar: null,
    status: 'ACTIVE',
    dashboardLayout: DEFAULT_LAYOUT,
    favoriteProjects: [],
    onboardingCompleted: false,
    preferences: { theme: 'dark', language: 'pt-BR' },
    notificationPreferences: {
      inApp: true, email: true,
      events: {
        assignment: { inApp: true, email: true }, mention: { inApp: true, email: true }, comment: { inApp: true, email: false },
        deadline: { inApp: true, email: true }, automation: { inApp: true, email: false }, invitation: { inApp: true, email: true },
        security: { inApp: true, email: true }
      }
    },
    mfa: { enabled: false },
    failedLogins: { count: 0, lockedUntil: null },
    knownDevices: [],
    policyAcceptedVersion: policyVersion,
    policyAcceptedAt: policyVersion ? now : null,
    createdAt: now
  };
  const workspace = {
    id: newId('ws'),
    name: `Workspace de ${name.split(' ')[0]}`,
    slug: `${name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${crypto.randomBytes(2).toString('hex')}`,
    color: '#3B82F6',
    icon: 'business',
    ownerId: user.id,
    members: [{ userId: user.id, role: 'Owner', joinedAt: now }],
    archivedAt: null,
    settings: { defaultTaskType: 'Task', weekStartsOn: 1 },
    createdAt: now
  };
  db.transaction(() => {
    db.get('users').push(user);
    db.get('workspaces').push(workspace);
  });
  return { user, workspace };
}

const currentPolicyVersion = () => db.data.systemSettings?.privacy?.policyVersion || '0.1-rascunho';

export async function sendVerificationEmail(user) {
  db.remove('emailVerifications', e => e.userId === user.id);
  const token = randomToken();
  db.insert('emailVerifications', { id: newId('ev'), userId: user.id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() });
  return sendMail({
    to: user.email,
    subject: 'Confirme seu e-mail',
    text: `Olá, ${user.name.split(' ')[0]}. Confirme que este e-mail é seu. O link vale por 24 horas.`,
    actionUrl: `${APP_URL()}/?verify=${token}`,
    actionLabel: 'Confirmar e-mail'
  });
}

// ------------------------------------------------------ email & password

// Progressive per-account lockout: 5 failures lock for 15 min, doubling on
// each further failure (max 24 h). Complements the per-IP rate limit.
const LOCK_AFTER = 5;
function registerFailure(user) {
  if (!user) return;
  const f = user.failedLogins || { count: 0 };
  f.count = (f.count || 0) + 1;
  if (f.count >= LOCK_AFTER) f.lockedUntil = new Date(Date.now() + Math.min(15 * 2 ** (f.count - LOCK_AFTER), 1440) * 60000).toISOString();
  user.failedLogins = f;
  db.save();
}
const isLocked = user => user?.failedLogins?.lockedUntil && Date.parse(user.failedLogins.lockedUntil) > Date.now();

// Completes a primary authentication: opens a session or, when MFA is
// enabled, issues a short-lived challenge that must be answered first.
export function completeLogin(req, res, user, method) {
  user.failedLogins = { count: 0, lockedUntil: null };
  req.user = user;
  if (user.mfa?.enabled) {
    const token = randomToken();
    db.remove('mfaChallenges', c => c.userId === user.id);
    db.insert('mfaChallenges', { id: newId('mfc'), userId: user.id, tokenHash: sha256(token), method, attempts: 0, expiresAt: new Date(Date.now() + 5 * 60000).toISOString() });
    audit(req, { action: 'LOGIN_FIRST_FACTOR_OK', entity: 'Autenticação (aguardando MFA)', category: 'auth', details: { method } });
    return { mfaRequired: true, challenge: token };
  }
  createSession(res, req, user);
  audit(req, { action: method === 'google' ? 'LOGIN_GOOGLE' : 'LOGIN', entity: 'Autenticação', category: 'auth' });
  return { user: publicUser(user) };
}

router.post('/login', loginLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.find('users', u => u.email.toLowerCase() === email);
  req.auditActor = email;
  if (isLocked(user)) {
    audit(req, { action: 'LOGIN_FAILED', entity: 'Conta temporariamente bloqueada', result: 'FAILED', category: 'auth' });
    throw unauthorized('Muitas tentativas. Aguarde alguns minutos ou redefina sua senha.');
  }
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

  if (!user || !user.passwordHash || !ok) {
    registerFailure(user);
    audit(req, { action: 'LOGIN_FAILED', entity: 'Autenticação', result: 'FAILED', category: 'auth' });
    recordEvent('auth.login_failed', 'Falha de login', { ip: req.ip }, 'warn');
    // Same answer whether or not the account exists (no enumeration).
    throw unauthorized('E-mail ou senha incorretos');
  }
  if (user.status === 'BLOCKED') {
    audit(req, { action: 'LOGIN_BLOCKED_ACCOUNT', entity: 'Autenticação', result: 'BLOCKED', category: 'auth' });
    throw forbidden('Esta conta foi suspensa. Contate o administrador.');
  }
  res.json(completeLogin(req, res, user, 'password'));
});

router.post('/signup', authLimiter, async (req, res) => {
  if (db.data.systemSettings?.allowSignup === false) throw forbidden('Novos cadastros estão desativados');
  const name = v.str(req.body.name, 'nome', { min: 2, max: 80, required: true });
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  if (req.body.acceptPolicy !== true) throw badRequest('Declare que leu a Política de Privacidade para continuar');
  if (db.find('users', u => u.email.toLowerCase() === email)) throw badRequest('Não foi possível criar a conta com este e-mail. Se ele já é seu, entre ou redefina a senha.');

  const { user, workspace } = createUserWithWorkspace({ name, email, passwordHash: await bcrypt.hash(password, 12), policyVersion: currentPolicyVersion() });
  const mail = await sendVerificationEmail(user);
  createSession(res, req, user);
  req.user = user;
  audit(req, { action: 'USER_REGISTER', entity: `Usuário ${user.id}`, category: 'auth' });
  res.status(201).json({ user: publicUser(user), workspace, verificationEmailDelivered: mail.delivered });
});

// ------------------------------------------------------ e-mail verification

router.post('/verify-email/send', authenticate, sessionOnly, rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: req => `verify:${req.user?.id}` }), async (req, res) => {
  if (req.user.emailVerified !== false) return res.json({ success: true, alreadyVerified: true });
  const mail = await sendVerificationEmail(req.user);
  res.json({ success: true, delivered: mail.delivered });
});

router.post('/verify-email', authLimiter, (req, res) => {
  const token = v.str(req.body.token, 'token', { required: true, max: 200 });
  const record = db.find('emailVerifications', e => e.tokenHash === sha256(token));
  if (!record || Date.parse(record.expiresAt) < Date.now()) throw badRequest('Link de verificação inválido ou expirado');
  const user = db.find('users', u => u.id === record.userId);
  if (!user || user.email.toLowerCase() !== record.email.toLowerCase()) throw badRequest('Link de verificação inválido ou expirado');
  user.emailVerified = true;
  db.remove('emailVerifications', e => e.userId === user.id);
  req.user = user;
  audit(req, { action: 'EMAIL_VERIFIED', entity: `Usuário ${user.id}`, category: 'auth' });
  res.json({ success: true });
});

router.post('/logout', authenticate, sessionOnly, (req, res) => {
  audit(req, { action: 'LOGOUT', entity: 'Autenticação', category: 'auth' });
  destroySession(req, res);
  res.json({ success: true });
});

router.get('/me', authenticate, sessionOnly, (req, res) => {
  const impersonator = req.session.impersonatorId ? db.find('users', u => u.id === req.session.impersonatorId) : null;
  res.json({
    user: publicUser(req.user),
    session: { expiresAt: req.session.expiresAt, mfa: Boolean(req.session.mfa), impersonatedBy: impersonator ? { id: impersonator.id, name: impersonator.name } : null },
    requireMfaForAdmins: db.data.systemSettings?.requireMfaForAdmins !== false
  });
});

router.get('/providers', (req, res) => {
  res.json({ google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), allowSignup: db.data.systemSettings?.allowSignup !== false });
});

// ------------------------------------------------------ password recovery

router.post('/forgot-password', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const user = db.find('users', u => u.email.toLowerCase() === email && u.status === 'ACTIVE');
  if (user) {
    db.remove('passwordResets', r => r.userId === user.id);
    const token = randomToken();
    db.insert('passwordResets', { id: newId('pwr'), userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), createdAt: new Date().toISOString() });
    await sendMail({
      to: user.email,
      subject: 'Redefinição de senha',
      text: `Olá, ${user.name.split(' ')[0]}.\nRecebemos um pedido para redefinir sua senha. O link é válido por 1 hora e pode ser usado uma única vez.\nSe você não fez este pedido, ignore este e-mail.`,
      actionUrl: `${APP_URL()}/?reset=${token}`,
      actionLabel: 'Redefinir senha'
    });
    req.auditActor = email;
    audit(req, { action: 'PASSWORD_RESET_REQUESTED', entity: `Usuário ${user.id}`, category: 'auth' });
  }
  // Same answer whether or not the e-mail exists (prevents account enumeration).
  res.json({ success: true, message: 'Se o e-mail estiver cadastrado, você receberá um link de redefinição.' });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const token = v.str(req.body.token, 'token', { required: true, max: 200 });
  const password = v.password(req.body.password);
  const reset = db.find('passwordResets', r => r.tokenHash === sha256(token));
  if (!reset || Date.parse(reset.expiresAt) < Date.now()) throw badRequest('Link de redefinição inválido ou expirado');
  const user = db.find('users', u => u.id === reset.userId);
  if (!user) throw badRequest('Link de redefinição inválido ou expirado');

  const hash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    user.passwordHash = hash;
    user.emailVerified = true; // the link was delivered to this inbox
    user.failedLogins = { count: 0, lockedUntil: null };
    db.remove('passwordResets', r => r.userId === user.id); // single use
    revokeUserSessions(user.id);
  });
  req.user = user;
  audit(req, { action: 'PASSWORD_RESET', entity: `Usuário ${user.id}`, category: 'security' });
  notify(user.id, { event: 'security', title: 'Sua senha foi redefinida', description: 'Todas as sessões ativas foram encerradas. Se não foi você, contate o suporte imediatamente.' });
  res.json({ success: true });
});

router.post('/change-password', authenticate, sessionOnly, async (req, res) => {
  const next = v.password(req.body.newPassword);
  if (req.user.passwordHash) {
    const ok = await bcrypt.compare(String(req.body.currentPassword || ''), req.user.passwordHash);
    if (!ok) {
      audit(req, { action: 'PASSWORD_CHANGE_FAILED', entity: `Usuário ${req.user.id}`, result: 'FAILED', category: 'security' });
      throw badRequest('Senha atual incorreta');
    }
  }
  req.user.passwordHash = await bcrypt.hash(next, 12);
  revokeUserSessions(req.user.id, req.session.id);
  db.save();
  audit(req, { action: 'PASSWORD_CHANGED', entity: `Usuário ${req.user.id}`, category: 'security' });
  notify(req.user.id, { event: 'security', title: 'Senha alterada', description: 'Sua senha foi alterada e as outras sessões foram encerradas.' });
  res.json({ success: true });
});

// -------------------------------------------------------------- sessions

router.get('/sessions', authenticate, sessionOnly, (req, res) => {
  const sessions = db.filter('sessions', s => s.userId === req.user.id)
    .map(s => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, ip: s.ip, device: s.device, mfa: Boolean(s.mfa), support: Boolean(s.impersonatorId), current: s.id === req.session.id }));
  res.json({ sessions });
});

// "Sair de todos os outros dispositivos".
router.delete('/sessions', authenticate, sessionOnly, (req, res) => {
  const before = db.get('sessions').length;
  revokeUserSessions(req.user.id, req.session.id);
  audit(req, { action: 'SESSIONS_REVOKED_ALL', entity: `Usuário ${req.user.id}`, category: 'security', details: { count: before - db.get('sessions').length } });
  res.json({ success: true, revoked: before - db.get('sessions').length });
});

router.delete('/sessions/:id', authenticate, sessionOnly, (req, res) => {
  const removed = db.remove('sessions', s => s.id === req.params.id && s.userId === req.user.id);
  if (!removed) throw notFound('Sessão não encontrada');
  audit(req, { action: 'SESSION_REVOKED', entity: `Sessão ${req.params.id}`, category: 'security' });
  res.json({ success: true });
});

// ---------------------------------------------------- Google OAuth 2.0

const OAUTH_COOKIE = 'taskly_oauth';

router.get('/google/start', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect(`${APP_URL()}/?auth_error=google_not_configured`);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  res.cookie(OAUTH_COOKIE, JSON.stringify({ state, nonce, verifier, invite: String(req.query.invite || '').slice(0, 200) }), {
    httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/auth/google'
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${APP_URL()}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const fail = (code, detail) => {
    recordEvent('auth.oauth_failed', `Falha no login Google: ${code}`, { detail }, 'warn');
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' });
    return res.redirect(`${APP_URL()}/?auth_error=${code}`);
  };
  let stored;
  try { stored = JSON.parse(req.cookies?.[OAUTH_COOKIE] || ''); } catch { return fail('oauth_state'); }
  res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' });

  if (req.query.error) return fail(req.query.error === 'access_denied' ? 'oauth_cancelled' : 'oauth_failed', req.query.error);
  if (!req.query.state || req.query.state !== stored.state) return fail('oauth_state');
  if (!req.query.code) return fail('oauth_failed', 'missing code');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL()}/api/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: stored.verifier
      }),
      signal: AbortSignal.timeout(10000)
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.id_token) return fail('oauth_failed', tokens.error);

    // Google validates the ID token signature; we validate the claims.
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`, { signal: AbortSignal.timeout(10000) });
    const claims = await infoRes.json();
    if (!infoRes.ok) return fail('oauth_failed', 'invalid id_token');
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return fail('oauth_failed', 'aud mismatch');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return fail('oauth_failed', 'iss mismatch');
    if (claims.nonce !== stored.nonce) return fail('oauth_failed', 'nonce mismatch');
    if (Number(claims.exp) * 1000 < Date.now()) return fail('oauth_failed', 'expired');
    if (claims.email_verified !== 'true' && claims.email_verified !== true) return fail('oauth_unverified');

    // Only the Google subject id, name and verified e-mail are used. The profile
    // picture URL is not stored (it would make every viewer's browser call Google).
    const email = String(claims.email).toLowerCase();
    let user = db.find('users', u => u.googleSub === claims.sub) || db.find('users', u => u.email.toLowerCase() === email);
    if (!user) {
      if (db.data.systemSettings?.allowSignup === false && !stored.invite) return fail('signup_disabled');
      ({ user } = createUserWithWorkspace({ name: claims.name || email.split('@')[0], email, googleSub: claims.sub, emailVerified: true, policyVersion: currentPolicyVersion() }));
    } else if (!user.googleSub) {
      // Account pre-hijacking protection: if the existing account never proved
      // ownership of this e-mail, someone else may have registered it. Google
      // has now proved ownership, so the unverified password and sessions are
      // discarded before linking.
      if (user.emailVerified === false) {
        user.passwordHash = null;
        revokeUserSessions(user.id);
        audit(req, { action: 'UNVERIFIED_PASSWORD_DISCARDED', entity: `Usuário ${user.id}`, category: 'security' });
      }
      user.googleSub = claims.sub;
      user.emailVerified = true;
      db.save();
    }
    if (user.status === 'BLOCKED') return fail('account_blocked');

    const result = completeLogin(req, res, user, 'google');
    const params = new URLSearchParams();
    if (result.mfaRequired) params.set('mfa', result.challenge);
    if (stored.invite) params.set('invite', stored.invite);
    res.redirect(`${APP_URL()}/${params.toString() ? `?${params}` : ''}`);
  } catch (err) {
    return fail('oauth_failed', err.message);
  }
});

// ---------------------------------------------------- account switching

// CRITICAL: the server alone decides which accounts may be switched to.
// Regular users can only use their own account. A Super Admin whose real
// session was verified with MFA may assume other active, non-admin accounts
// for support: a written reason is required, the session lasts at most 2 h,
// grants no admin rights, is audited from start to end, and the account
// owner is notified.
function switchableAccountsFor(req) {
  const realUserId = req.session.impersonatorId || req.user.id;
  const realUser = db.find('users', u => u.id === realUserId);
  const self = { id: realUser.id, name: realUser.name, email: realUser.email, avatar: realUser.avatar || null, self: true };
  // While impersonating, the only allowed switch is back to the real account.
  if (req.session.impersonatorId) return [self];
  const adminVerified = realUser?.isSuperAdmin && (db.data.systemSettings?.requireMfaForAdmins === false || (realUser.mfa?.enabled && req.session.mfa));
  if (!adminVerified) return [self];
  return [self, ...db.filter('users', u => u.id !== realUser.id && u.status === 'ACTIVE' && !u.isSuperAdmin)
    .map(u => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar || null, self: false }))];
}

export const switchableProfilesHandler = (req, res) => res.json({ accounts: switchableAccountsFor(req) });
router.get('/switchable-accounts', authenticate, sessionOnly, switchableProfilesHandler);

router.post('/switch', authenticate, sessionOnly, rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: req => `switch:${req.user?.id}` }), (req, res) => {
  const targetId = v.str(req.body.userId, 'userId', { required: true, max: 64 });
  const allowed = switchableAccountsFor(req);
  if (!allowed.some(a => a.id === targetId)) {
    audit(req, { action: 'ACCOUNT_SWITCH_DENIED', entity: `Usuário ${targetId}`, result: 'BLOCKED', category: 'security' });
    throw notFound('Conta não disponível');
  }
  const realUserId = req.session.impersonatorId || req.user.id;
  const target = db.find('users', u => u.id === targetId);
  const ending = target.id === realUserId;
  const reason = ending ? null : v.str(req.body.reason, 'motivo', { min: 10, max: 300, required: true });
  const previous = req.session;
  destroySession(req, res);
  createSession(res, req, target, ending
    ? { mfa: Boolean(previous.impersonatorMfa) }
    : { impersonatorId: realUserId, impersonationReason: reason, impersonatorMfa: Boolean(previous.mfa) });
  if (ending) {
    audit(req, { action: 'IMPERSONATION_ENDED', entity: `Usuário ${previous.userId}`, category: 'security', details: { by: realUserId, startedAt: previous.createdAt, endedAt: new Date().toISOString() } });
  } else {
    audit(req, { action: 'IMPERSONATION_STARTED', entity: `Usuário ${target.id}`, category: 'security', details: { by: realUserId, reason } });
    notify(target.id, { event: 'security', title: 'Acesso de suporte à sua conta', description: `Um administrador da plataforma acessou sua conta para suporte. Motivo informado: "${reason}". O acesso é registrado e expira em até 2 horas.` });
  }
  req.user = target;
  res.json({ user: publicUser(target) });
});

// ---------------------------------------------------------------- profile

router.put('/profile', authenticate, sessionOnly, async (req, res) => {
  const updates = {};
  const name = v.str(req.body.name, 'nome', { min: 2, max: 80 });
  if (name) updates.name = name;

  if (req.body.email !== undefined && req.body.email.toLowerCase() !== req.user.email.toLowerCase()) {
    if (!req.user.passwordHash) throw badRequest('Contas conectadas ao Google não podem alterar o e-mail aqui');
    if (!(await bcrypt.compare(String(req.body.currentPassword || ''), req.user.passwordHash))) throw badRequest('Confirme sua senha atual para alterar o e-mail');
    const email = v.email(req.body.email);
    if (db.find('users', u => u.email.toLowerCase() === email)) throw badRequest('Este e-mail já está em uso');
    const oldEmail = req.user.email;
    updates.email = email;
    updates.emailVerified = false;
    sendMail({ to: oldEmail, subject: 'O e-mail da sua conta foi alterado', text: `O e-mail de acesso da sua conta Taskly foi alterado para ${email}. Se não foi você, redefina sua senha imediatamente e contate o suporte.` }).catch(() => {});
    notify(req.user.id, { event: 'security', title: 'E-mail da conta alterado', description: `O e-mail da sua conta foi alterado para ${email}. Confirme o novo endereço pelo link enviado.` });
    audit(req, { action: 'EMAIL_CHANGED', entity: `Usuário ${req.user.id}`, category: 'security' });
  }

  if (req.body.dashboardLayout !== undefined) {
    const layout = v.strArray(req.body.dashboardLayout, 'dashboardLayout', { maxItems: WIDGETS.length });
    if (layout.some(w => !WIDGETS.includes(w))) throw badRequest('Widget desconhecido');
    updates.dashboardLayout = layout;
  }
  if (req.body.preferences !== undefined) {
    updates.preferences = {
      theme: v.oneOf(req.body.preferences.theme, 'tema', ['dark', 'light', 'system']) || req.user.preferences?.theme || 'dark',
      language: v.oneOf(req.body.preferences.language, 'idioma', ['pt-BR', 'en']) || req.user.preferences?.language || 'pt-BR'
    };
  }
  if (req.body.onboardingCompleted !== undefined) updates.onboardingCompleted = Boolean(req.body.onboardingCompleted);

  const updated = db.update('users', u => u.id === req.user.id, updates);
  if (updates.email) sendVerificationEmail(updated).catch(() => {});
  res.json({ user: publicUser(updated) });
});

router.post('/avatar', authenticate, sessionOnly, express.json({ limit: '4mb' }), (req, res) => {
  const file = decodeUpload(req.body, { allowed: ['png', 'jpg', 'jpeg', 'webp', 'gif'], maxBytes: 2 * 1024 * 1024 });
  const key = storeBuffer('avatars', file.buffer, file.ext);
  if (req.user.avatarKey) deleteStored(req.user.avatarKey);
  const updated = db.update('users', u => u.id === req.user.id, { avatarKey: key, avatar: `/api/auth/avatar/${req.user.id}?v=${Date.now()}` });
  audit(req, { action: 'AVATAR_UPDATED', entity: `Usuário ${req.user.id}`, category: 'users' });
  res.json({ user: publicUser(updated) });
});

router.delete('/avatar', authenticate, sessionOnly, (req, res) => {
  if (req.user.avatarKey) deleteStored(req.user.avatarKey);
  const updated = db.update('users', u => u.id === req.user.id, { avatarKey: null, avatar: null });
  res.json({ user: publicUser(updated) });
});

// Avatars are visible to any signed-in user who shares a workspace.
router.get('/avatar/:userId', authenticate, (req, res) => {
  const target = db.find('users', u => u.id === req.params.userId);
  const mine = new Set(accessibleWorkspaces(req.user).map(w => w.id));
  const shares = target && (target.id === req.user.id || accessibleWorkspaces(target).some(w => mine.has(w.id)));
  const full = shares && resolveStorageKey(target.avatarKey);
  if (!full) throw notFound();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(full);
});

export { SESSION_COOKIE };
export default router;
