// Node.js server (development and self-hosting). Persistence: JSON file in
// DATA_DIR. The Cloudflare deployment uses worker/index.js instead.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { db } from './db.js';
import { createApp } from './app.js';
import { runHourlyJobs, runDailyJobs, runPublicationTick, runSocialDailyJobs } from './jobs.js';
import { runBackup } from './lib/backup.js';
import { log, recordEvent } from './lib/observability.js';

const PORT = Number(process.env.PORT || 5000);
const isProd = process.env.NODE_ENV === 'production';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Serve the built frontend (npm run build) so a single port hosts everything.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
function serveFrontend(app) {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) return;
  // Everything is self-hosted (fonts included), so the policy only allows our own origin.
  // 'unsafe-inline' is limited to styles (React style attributes and chart theme).
  const APP_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", ...(isProd ? ['upgrade-insecure-requests'] : [])].join('; ');
  app.use((req, res, next) => { res.setHeader('Content-Security-Policy', APP_CSP); next(); });
  app.use(express.static(distDir, {
    index: false,
    maxAge: isProd ? '1h' : 0,
    // The service worker and manifest must always be revalidated so updates reach installed apps.
    setHeaders: (res, file) => { if (/(sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); }
  }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const app = createApp({ beforeErrors: serveFrontend });

// Background jobs.
setInterval(runHourlyJobs, 60 * 60 * 1000).unref();
setInterval(runDailyJobs, 24 * 60 * 60 * 1000).unref();
// Publication scheduler (backend-driven: runs whether or not anyone has Taskly open).
setInterval(runPublicationTick, Number(process.env.TASKLY_SCHEDULER_INTERVAL_MS) || 60 * 1000).unref();
setInterval(runSocialDailyJobs, 24 * 60 * 60 * 1000).unref();
setInterval(() => runBackup('scheduled'), 24 * 60 * 60 * 1000).unref();
setTimeout(() => {
  runHourlyJobs();
  runDailyJobs();
  // One backup per day: take one at startup if the last is older than 24 h.
  const last = Date.parse(db.data.systemSettings?.backupStatus?.at || 0);
  if (!process.env.TASKLY_DISABLE_BACKUPS && Date.now() - last > 24 * 60 * 60 * 1000) runBackup('startup');
}, 3000).unref();

process.on('unhandledRejection', err => recordEvent('process.unhandled_rejection', 'Promise rejeitada sem tratamento', { error: String(err?.message || err) }, 'error'));

app.listen(PORT, () => {
  log('info', `Taskly API em http://localhost:${PORT}`, { appUrl: APP_URL, env: isProd ? 'production' : 'development' });
});
