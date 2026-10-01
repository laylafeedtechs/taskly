// Two-factor authentication (TOTP, RFC 6238) with single-use recovery codes.
// TOTP is implemented by the `otpauth` library; the shared secret is stored
// encrypted at rest (lib/secrets.js) and recovery codes only as hashes.
import express from 'express';
import { verifyPassword } from '../lib/password.js';
import crypto from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { authenticate, sessionOnly, createSession, revokeUserSessions, publicUser, rateLimit, sha256 } from '../middleware/auth.js';
import { v, badRequest, unauthorized } from '../lib/http.js';
import { audit } from '../lib/observability.js';
import { notify } from '../lib/events.js';
import { seal, unseal } from '../lib/secrets.js';
import { IS_WORKER } from '../lib/runtime.js';

const router = express.Router();

// Workers get qrcode's browser build, which renders PNGs through a canvas;
// SVG needs none and displays the same in an <img>.
async function qrDataUrl(text) {
  if (!IS_WORKER) return QRCode.toDataURL(text, { margin: 1, width: 220 });
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 220 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
const ISSUER = 'Taskly';

const totpFor = (user, secret) => new OTPAuth.TOTP({ issuer: ISSUER, label: user.email, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });

// ±1 step tolerance; a code can only be used once (replay protection).
function checkTotp(user, secret, code) {
  const token = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  const delta = totpFor(user, secret).validate({ token, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30000) + delta;
  if (user.mfa?.lastStep && step <= user.mfa.lastStep) return false;
  if (user.mfa) user.mfa.lastStep = step;
  return true;
}

function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  return { codes, hashes: codes.map(c => sha256(c.replace('-', ''))) };
}

function useRecoveryCode(user, input) {
  const h = sha256(String(input || '').replace(/[\s-]/g, '').toLowerCase());
  const idx = (user.mfa?.recoveryHashes || []).indexOf(h);
  if (idx === -1) return false;
  user.mfa.recoveryHashes.splice(idx, 1);
  return true;
}

const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, key: req => `mfa:${req.ip}` });

// Step 2 of login: answer the challenge issued after the first factor.
router.post('/verify', verifyLimiter, (req, res) => {
  const token = v.str(req.body.challenge, 'desafio', { required: true, max: 200 });
  const challenge = db.find('mfaChallenges', c => c.tokenHash === sha256(token));
  if (!challenge || Date.parse(challenge.expiresAt) < Date.now()) throw unauthorized('A verificação expirou. Entre novamente.');
  const user = db.find('users', u => u.id === challenge.userId);
  if (!user || user.status === 'BLOCKED' || !user.mfa?.enabled) throw unauthorized('A verificação expirou. Entre novamente.');

  const secret = unseal(user.mfa.secret);
  const ok = req.body.recoveryCode ? useRecoveryCode(user, req.body.recoveryCode) : checkTotp(user, secret, req.body.code);
  req.user = user;
  if (!ok) {
    challenge.attempts += 1;
    if (challenge.attempts >= 5) db.remove('mfaChallenges', c => c.id === challenge.id);
    db.save();
    audit(req, { action: 'MFA_FAILED', entity: 'Verificação em duas etapas', result: 'FAILED', category: 'auth' });
    throw unauthorized(challenge.attempts >= 5 ? 'Muitas tentativas. Entre novamente.' : 'Código inválido');
  }
  db.remove('mfaChallenges', c => c.id === challenge.id);
  createSession(res, req, user, { mfa: true });
  audit(req, { action: req.body.recoveryCode ? 'LOGIN_MFA_RECOVERY_CODE' : 'LOGIN_MFA', entity: 'Autenticação', category: 'auth', details: { method: challenge.method } });
  if (req.body.recoveryCode) {
    notify(user.id, { event: 'security', title: 'Código de recuperação usado', description: `Um código de recuperação foi usado para entrar. Restam ${user.mfa.recoveryHashes.length}. Gere novos códigos se necessário.` });
  }
  res.json({ user: publicUser(user) });
});

router.use(authenticate, sessionOnly);

async function confirmIdentity(req) {
  if (req.user.passwordHash && !(await verifyPassword(String(req.body.password || ''), req.user.passwordHash))) {
    audit(req, { action: 'MFA_CHANGE_DENIED', entity: 'Senha incorreta', result: 'FAILED', category: 'security' });
    throw badRequest('Senha atual incorreta');
  }
}

// Enrollment: generate a pending secret and show it as QR code.
router.post('/setup', async (req, res) => {
  if (req.session.impersonatorId) throw badRequest('Não é possível configurar MFA durante um acesso de suporte');
  await confirmIdentity(req);
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  req.user.mfa = { ...(req.user.mfa || {}), pendingSecret: seal(secret), pendingAt: new Date().toISOString() };
  db.save();
  const uri = totpFor(req.user, secret).toString();
  res.json({ otpauthUrl: uri, qrCode: await qrDataUrl(uri), secret });
});

router.post('/enable', async (req, res) => {
  const pending = req.user.mfa?.pendingSecret;
  if (!pending || Date.parse(req.user.mfa.pendingAt) < Date.now() - 15 * 60000) throw badRequest('Inicie a configuração novamente');
  const secret = unseal(pending);
  if (!checkTotp(req.user, secret, req.body.code)) throw badRequest('Código inválido. Confira o horário do seu celular.');
  const { codes, hashes } = newRecoveryCodes();
  req.user.mfa = { enabled: true, secret: seal(secret), recoveryHashes: hashes, enabledAt: new Date().toISOString(), lastStep: req.user.mfa.lastStep };
  // Other sessions were authenticated without MFA; end them and upgrade this one.
  revokeUserSessions(req.user.id, req.session.id);
  req.session.mfa = true;
  db.save();
  audit(req, { action: 'MFA_ENABLED', entity: `Usuário ${req.user.id}`, category: 'security' });
  notify(req.user.id, { event: 'security', title: 'Verificação em duas etapas ativada', description: 'Sua conta agora exige um código do aplicativo autenticador ao entrar.' });
  res.json({ user: publicUser(req.user), recoveryCodes: codes });
});

router.post('/recovery-codes', async (req, res) => {
  if (!req.user.mfa?.enabled) throw badRequest('MFA não está ativo');
  if (!checkTotp(req.user, unseal(req.user.mfa.secret), req.body.code)) throw badRequest('Código inválido');
  const { codes, hashes } = newRecoveryCodes();
  req.user.mfa.recoveryHashes = hashes;
  db.save();
  audit(req, { action: 'MFA_RECOVERY_CODES_REGENERATED', entity: `Usuário ${req.user.id}`, category: 'security' });
  res.json({ recoveryCodes: codes });
});

router.post('/disable', async (req, res) => {
  if (!req.user.mfa?.enabled) throw badRequest('MFA não está ativo');
  await confirmIdentity(req);
  const secret = unseal(req.user.mfa.secret);
  const ok = req.body.recoveryCode ? useRecoveryCode(req.user, req.body.recoveryCode) : checkTotp(req.user, secret, req.body.code);
  if (!ok) throw badRequest('Código inválido');
  req.user.mfa = { enabled: false };
  req.session.mfa = false;
  db.save();
  audit(req, { action: 'MFA_DISABLED', entity: `Usuário ${req.user.id}`, category: 'security' });
  notify(req.user.id, { event: 'security', title: 'Verificação em duas etapas desativada', description: 'Se não foi você, redefina sua senha e reative a verificação imediatamente.' });
  res.json({ user: publicUser(req.user) });
});

export default router;
