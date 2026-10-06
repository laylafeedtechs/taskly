// Builds the Taskly Express application. Shared by the Node server
// (server/index.js) and the Cloudflare Worker (worker/index.js) — routes,
// middleware and security behaviour are identical in both runtimes.
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

import authRoutes, { switchableProfilesHandler } from './routes/auth.js';
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
import socialRoutes from './routes/social.js';
import creativeRoutes from './routes/creatives.js';
import campaignRoutes from './routes/campaigns.js';
import publicationRoutes from './routes/publications.js';
import { authenticate, sessionOnly, csrfGuard, rateLimit, allowedOrigins } from './middleware/auth.js';
import { startIncidentDetection } from './lib/incidents.js';
import { log, recordEvent } from './lib/observability.js';
import { IS_WORKER } from './lib/runtime.js';

// Workers freeze the clock while modules load, so start counting on first use.
let startedAt = null;

/**
 * @param {object} options
 * @param {Function[]} [options.beforeApi] middleware run first for /api (the Worker's D1 context)
 * @param {(app: import('express').Express) => void} [options.beforeErrors] mounts extra routes (Node static files)
 */
export function createApp({ beforeApi = [], beforeErrors } = {}) {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const ALLOWED_ORIGINS = allowedOrigins();

  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    // On Cloudflare the client address is provided by the edge.
    const cfIp = IS_WORKER ? req.headers['cf-connecting-ip'] : null;
    if (cfIp) Object.defineProperty(req, 'ip', { value: String(cfIp), configurable: true });
    req.id = crypto.randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // API responses never render as documents; the app shell has its own CSP.
    if (req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  beforeApi.forEach(mw => app.use('/api', mw));

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
  app.use('/api/social', socialRoutes);
  app.use('/api/creatives', creativeRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/publications', publicationRoutes);

  app.get('/api/health', (req, res) => {
    startedAt ??= Date.now();
    res.json({ status: 'ok', runtime: IS_WORKER ? 'cloudflare-workers' : 'node', uptime: Math.round((Date.now() - startedAt) / 1000) });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada', code: 'NOT_FOUND' }));

  beforeErrors?.(app);

  // Errors: known errors keep their message; unexpected ones never leak details.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo excede o tamanho máximo permitido', code: 'PAYLOAD_TOO_LARGE' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', code: 'INVALID_JSON' });
    if (err.expose && err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    recordEvent('api.error', `Erro interno em ${req.method} ${req.path}`, { requestId: req.id, error: err.message, stack: err.stack?.split('\n').slice(0, 5).join(' | ') }, 'error');
    res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.', code: 'INTERNAL_ERROR', requestId: req.id });
  });

  startIncidentDetection();
  return app;
}
