import express from 'express';
import { db } from '../db.js';
import { authenticate, rateLimit } from '../middleware/auth.js';
import { recordEvent } from '../lib/observability.js';

const router = express.Router();

// Signed-in users only learn which flags are on; names, descriptions and
// admin controls stay behind the Admin Center.
router.get('/feature-flags', authenticate, (req, res) => {
  res.json({ flags: Object.fromEntries(db.get('featureFlags').map(f => [f.key, Boolean(f.enabled)])) });
});

router.get('/status', (req, res) => {
  res.json({ maintenanceBanner: db.data.systemSettings?.maintenanceBanner || '' });
});

// Frontend error reports (window.onerror, unhandled rejections, React error boundary).
router.post('/client-errors', rateLimit({ windowMs: 60000, max: 20 }), express.json({ limit: '16kb' }), (req, res) => {
  const { message, stack, url, component } = req.body || {};
  recordEvent('frontend.error', String(message || 'Erro no frontend').slice(0, 300), {
    stack: String(stack || '').slice(0, 2000),
    url: String(url || '').slice(0, 300),
    component: String(component || '').slice(0, 100),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200)
  }, 'error');
  res.status(204).end();
});

export default router;
