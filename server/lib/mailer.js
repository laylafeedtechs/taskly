// Outgoing e-mail. With SMTP_* configured, mail is delivered through SMTP.
// Without it (local development), messages are written to data/outbox so
// links such as password resets and invitations can still be followed.
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { DATA_DIR } from '../db.js';
import { log, recordEvent } from './observability.js';

const OUTBOX = path.join(DATA_DIR, 'outbox');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

export const mailConfigured = () => Boolean(transport);

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendMail({ to, subject, text, actionUrl, actionLabel }) {
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:32px">
    <h2 style="margin:0 0 16px;font-weight:600">Taskly</h2>
    <p style="color:#A0A0A0;line-height:1.6">${escapeHtml(text).replace(/\n/g, '<br>')}</p>
    ${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#F5F5F5;color:#080808;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(actionLabel || 'Abrir')}</a></p>` : ''}
  </div>`;
  const body = actionUrl ? `${text}\n\n${actionLabel || 'Abrir'}: ${actionUrl}` : text;

  if (transport) {
    try {
      await transport.sendMail({ from: process.env.SMTP_FROM || 'Taskly <no-reply@taskly.local>', to, subject, text: body, html });
      return { delivered: true };
    } catch (err) {
      recordEvent('email.failed', `Falha ao enviar e-mail: ${subject}`, { to, error: err.message }, 'error');
      return { delivered: false, error: 'Falha no envio de e-mail' };
    }
  }

  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.txt`);
  fs.writeFileSync(file, `To: ${to}\nSubject: ${subject}\n\n${body}\n`, 'utf8');
  log('info', 'E-mail gravado na caixa de saída local (SMTP não configurado)', { to, subject, file });
  return { delivered: false, outbox: true };
}
