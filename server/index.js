import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import { db } from './db.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspaces.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import columnRoutes from './routes/columns.js';
import automationRoutes from './routes/automations.js';
import notificationRoutes from './routes/notifications.js';
import teamRoutes from './routes/team.js';
import reportRoutes from './routes/reports.js';
import fileRoutes from './routes/files.js';
import trashRoutes from './routes/trash.js';
import apiKeyRoutes from './routes/apiKeys.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import searchRoutes from './routes/search.js';
import systemRoutes from './routes/system.js';
import mfaRoutes from './routes/mfa.js';
import privacyRoutes from './routes/privacy.js';
import { switchableProfilesHandler } from './routes/auth.js';
import { authenticate, sessionOnly } from './middleware/auth.js';
import { startIncidentDetection } from './lib/incidents.js';
import { runRetention } from './lib/retention.js';
import { runBackup } from './lib/backup.js';
import { csrfGuard, rateLimit, purgeExpiredSessions, allowedOrigins } from './middleware/auth.js';
import { scanDeadlines } from './lib/events.js';
import { log, recordEvent } from './lib/observability.js';

const app = express();
const PORT = Number(process.env.PORT || 5000);
const isProd = process.env.NODE_ENV === 'production';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const ALLOWED_ORIGINS = allowedOrigins();

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');

// Security headers.
app.use((req, res, next) => {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // API responses never render as documents; the app shell gets its own CSP below.
  if (req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use('/api', cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)),
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(cookieParser());
// Upload routes raise their own limit; everything else is capped at 1 MB.
app.use('/api', (req, res, next) => {
  if (/^\/(files\/project\/[^/]+|auth\/avatar)$/.test(req.path) && req.method === 'POST') return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use('/api', csrfGuard);
// Signed-in clients are limited per session (teams often share one IP); anonymous ones per IP.
app.use('/api', rateLimit({
  windowMs: 60000,
  max: 600,
  key: req => (req.cookies?.taskly_session ? `s:${req.cookies.taskly_session.slice(0, 16)}` : `ip:${req.ip}`),
  message: 'Limite de requisições excedido. Aguarde um minuto.'
}));

// Access log: warnings for client errors, errors for server failures.
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (res.statusCode >= 500) log('error', 'API error', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
    else if (res.statusCode >= 400 && res.statusCode !== 401) log('warn', 'API client error', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
  });
  next();
});

app.use('/api/auth/mfa', mfaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/privacy', privacyRoutes);
app.get('/api/users/switchable-profiles', authenticate, sessionOnly, switchableProfilesHandler);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/columns', columnRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/trash', trashRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/system', systemRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada', code: 'NOT_FOUND' }));

// Serve the built frontend (npm run build) so a single port hosts everything.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  // Everything is self-hosted (fonts included), so the policy only allows our own origin.
  // 'unsafe-inline' is limited to styles (React style attributes and chart theme).
  const APP_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", ...(isProd ? ['upgrade-insecure-requests'] : [])].join('; ');
  app.use((req, res, next) => { if (!req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', APP_CSP); next(); });
  app.use(express.static(distDir, {
    index: false,
    maxAge: isProd ? '1h' : 0,
    // The service worker and manifest must always be revalidated so updates reach installed apps.
    setHeaders: (res, file) => { if (/(sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); }
  }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// Errors: known errors keep their message; unexpected ones never leak details.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo excede o tamanho máximo permitido', code: 'PAYLOAD_TOO_LARGE' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', code: 'INVALID_JSON' });
  if (err.expose && err.status < 500) {
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
  }
  recordEvent('api.error', `Erro interno em ${req.method} ${req.path}`, { requestId: req.id, error: err.message, stack: err.stack?.split('\n').slice(0, 5).join(' | ') }, 'error');
  res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.', code: 'INTERNAL_ERROR', requestId: req.id });
});

// Background jobs.
setInterval(() => { try { purgeExpiredSessions(); } catch (err) { log('error', 'session purge failed', { error: err.message }); } }, 60 * 60 * 1000).unref();
setInterval(() => { try { scanDeadlines(); } catch (err) { log('error', 'deadline scan failed', { error: err.message }); } }, 60 * 60 * 1000).unref();
setInterval(() => { try { runRetention(); } catch (err) { log('error', 'retention failed', { error: err.message }); } }, 24 * 60 * 60 * 1000).unref();
setInterval(() => runBackup('scheduled'), 24 * 60 * 60 * 1000).unref();
setTimeout(() => {
  try { purgeExpiredSessions(); scanDeadlines(); runRetention(); } catch (err) { log('error', 'startup jobs failed', { error: err.message }); }
  // One backup per day: take one at startup if the last is older than 24 h.
  const last = Date.parse(db.data.systemSettings?.backupStatus?.at || 0);
  if (!process.env.TASKLY_DISABLE_BACKUPS && Date.now() - last > 24 * 60 * 60 * 1000) runBackup('startup');
}, 3000).unref();

startIncidentDetection();

process.on('unhandledRejection', err => recordEvent('process.unhandled_rejection', 'Promise rejeitada sem tratamento', { error: String(err?.message || err) }, 'error'));

app.listen(PORT, () => {
  log('info', `Taskly API em http://localhost:${PORT}`, { appUrl: APP_URL, env: isProd ? 'production' : 'development' });
});
