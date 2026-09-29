import express from 'express';
import { db } from '../db.js';
import { authenticate, sessionOnly } from '../middleware/auth.js';
import { badRequest, paginate } from '../lib/http.js';

const router = express.Router();
router.use(authenticate, sessionOnly);

const CATEGORIES = ['Mentions', 'Assignments', 'Comments', 'Deadlines', 'System'];
const EVENTS = ['assignment', 'mention', 'comment', 'deadline', 'automation', 'invitation', 'security'];

// Notifications are always scoped to the signed-in user.
router.get('/', (req, res) => {
  const { category, status = 'active' } = req.query;
  let list = db.filter('notifications', n => n.userId === req.user.id);
  if (status === 'archived') list = list.filter(n => n.archived);
  else list = list.filter(n => !n.archived);
  if (status === 'unread') list = list.filter(n => n.unread);
  if (category && category !== 'All') list = list.filter(n => n.category === category);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = paginate(list, req.query, { defaultLimit: 50 });
  const unreadCount = db.filter('notifications', n => n.userId === req.user.id && n.unread && !n.archived).length;
  res.json({ notifications: page.items, total: page.total, page: page.page, totalPages: page.totalPages, unreadCount, categories: CATEGORIES });
});

function idsFrom(req) {
  const ids = req.body.notificationIds;
  if (ids === undefined) return null; // null = all of the user's notifications
  if (!Array.isArray(ids) || ids.length > 500) throw badRequest('Lista de notificações inválida');
  return new Set(ids.map(String));
}

function mutate(req, fn) {
  const ids = idsFrom(req);
  let count = 0;
  db.filter('notifications', n => n.userId === req.user.id && (!ids || ids.has(n.id))).forEach(n => { fn(n); count++; });
  db.save();
  return count;
}

router.put('/:id/read', (req, res) => {
  const n = db.find('notifications', x => x.id === req.params.id && x.userId === req.user.id);
  if (n) { n.unread = req.body.unread === true; db.save(); }
  res.json({ notification: n || null });
});

router.post('/bulk-read', (req, res) => res.json({ count: mutate(req, n => { n.unread = false; }) }));
router.post('/bulk-unread', (req, res) => res.json({ count: mutate(req, n => { n.unread = true; }) }));
router.post('/bulk-archive', (req, res) => res.json({ count: mutate(req, n => { n.archived = req.body.archived !== false; n.unread = false; }) }));

router.post('/bulk-delete', (req, res) => {
  const ids = idsFrom(req);
  if (!ids) throw badRequest('Selecione as notificações a excluir');
  const before = db.get('notifications').length;
  db.remove('notifications', n => n.userId === req.user.id && ids.has(n.id));
  res.json({ count: before - db.get('notifications').length });
});

router.get('/preferences', (req, res) => {
  res.json({ preferences: req.user.notificationPreferences, events: EVENTS, locked: ['security'] });
});

router.put('/preferences', (req, res) => {
  const input = req.body.preferences || {};
  const current = req.user.notificationPreferences || { events: {} };
  const events = {};
  EVENTS.forEach(e => {
    const p = input.events?.[e] || current.events?.[e] || {};
    // Security notifications are mandatory on both channels.
    events[e] = e === 'security' ? { inApp: true, email: true } : { inApp: p.inApp !== false, email: p.email === true };
  });
  req.user.notificationPreferences = { inApp: input.inApp !== false, email: input.email !== false, events };
  db.save();
  res.json({ preferences: req.user.notificationPreferences });
});

export default router;
