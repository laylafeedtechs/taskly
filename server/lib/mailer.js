// Outgoing e-mail.
//  - Cloudflare Worker: HTTP API (Resend) when RESEND_API_KEY is set — raw
//    SMTP sockets are not a supported way to send mail from Workers.
//  - Node: SMTP via nodemailer when SMTP_HOST is set.
//  - Otherwise nothing is sent: on Node messages are written to data/outbox
//    (development), on the Worker they are only logged without content, and
//    callers fall back to showing links (e.g. invitations) in the UI.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../db.js';
import { log, recordEvent } from './observability.js';
import { IS_WORKER, detached } from './runtime.js';

const OUTBOX = path.join(DATA_DIR, 'outbox');
const FROM = () => process.env.MAIL_FROM || process.env.SMTP_FROM || 'Taskly <no-reply@taskly.local>';

export const mailConfigured = () => Boolean(IS_WORKER ? process.env.RESEND_API_KEY : process.env.SMTP_HOST);

let transportPromise = null;
function smtpTransport() {
  // Loaded lazily so the Worker bundle never initializes an SMTP client.
  transportPromise ||= import('nodemailer').then(({ default: nodemailer }) => nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  }));
  return transportPromise;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendViaResend({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM(), to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
}

export async function sendMail({ to, subject, text, actionUrl, actionLabel }) {
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:32px">
    <h2 style="margin:0 0 16px;font-weight:600">Taskly</h2>
    <p style="color:#A0A0A0;line-height:1.6">${escapeHtml(text).replace(/\n/g, '<br>')}</p>
    ${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#F5F5F5;color:#080808;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(actionLabel || 'Abrir')}</a></p>` : ''}
  </div>`;
  const body = actionUrl ? `${text}\n\n${actionLabel || 'Abrir'}: ${actionUrl}` : text;

  if (mailConfigured()) {
    try {
      if (IS_WORKER) await sendViaResend({ to, subject, text: body, html });
      else await (await smtpTransport()).sendMail({ from: FROM(), to, subject, text: body, html });
      return { delivered: true };
    } catch (err) {
      // On Workers this runs after the response, so it needs its own D1 store.
      const record = () => recordEvent('email.failed', `Falha ao enviar e-mail: ${subject}`, { to, error: err.message }, 'error');
      if (IS_WORKER) detached(record); else record();
      return { delivered: false, error: 'Falha no envio de e-mail' };
    }
  }

  if (IS_WORKER) {
    // Never log the body: it may contain single-use links.
    log('warn', 'E-mail não enviado: RESEND_API_KEY não configurada', { subject });
    return { delivered: false };
  }
  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.txt`);
  fs.writeFileSync(file, `To: ${to}\nSubject: ${subject}\n\n${body}\n`, 'utf8');
  log('info', 'E-mail gravado na caixa de saída local (SMTP não configurado)', { to, subject, file });
  return { delivered: false, outbox: true };
}
