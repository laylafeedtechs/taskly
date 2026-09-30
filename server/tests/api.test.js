// Integration tests: boots the API against a throwaway database and checks
// authentication, authorization (RBAC / workspace isolation) and core flows.
// Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';

const PORT = 5099;
const BASE = `http://localhost:${PORT}/api`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskly-test-'));
const dataDir = path.join(root, 'data');
const env = { TASKLY_DATA_DIR: dataDir, TASKLY_KEY_DIR: path.join(root, 'keys'), TASKLY_BACKUP_DIR: path.join(root, 'backups') };
let server;

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, ...env, PORT: String(PORT), LOG_LEVEL: 'silent', APP_URL: `http://localhost:${PORT}`, ALLOW_PRIVATE_WEBHOOKS: 'true', SMTP_HOST: '', TASKLY_DISABLE_BACKUPS: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

// Minimal cookie-aware client.
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'taskly', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const set = res.headers.getSetCookie?.() || [];
    set.forEach(c => {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(p => p.split('=')));
      if (value) jar[name] = value; else delete jar[name];
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b, h) => call('POST', u, b ?? {}, h),
    put: (u, b) => call('PUT', u, b),
    del: (u, b) => call('DELETE', u, b),
    login: async (email, password = 'taskly123') => {
      const r = await call('POST', '/auth/login', { email, password });
      assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.data)}`);
      return r.data.user;
    }
  };
}

const lucas = client(); // Super Admin, Owner of ws-1
const mateus = client(); // Member in ws-1, Manager in ws-3, not in ws-2
const carla = client(); // Member in ws-1 and ws-2

test('rejects unauthenticated and forged credentials', async () => {
  const anon = client();
  assert.equal((await anon.get('/auth/me')).status, 401);
  assert.equal((await anon.get('/auth/me', { Authorization: 'Bearer usr-1' })).status, 401);
  assert.equal((await anon.get('/admin/users', { Authorization: 'Bearer usr-1' })).status, 401);
  assert.equal((await anon.post('/auth/login', { email: 'lucas@taskly.io', password: 'wrong-password' })).status, 401);
});

test('login issues an HttpOnly session cookie', async () => {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'taskly' }, body: JSON.stringify({ email: 'lucas@taskly.io', password: 'taskly123' }) });
  const cookie = res.headers.getSetCookie().find(c => c.startsWith('taskly_session='));
  assert.ok(cookie && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie));
  assert.equal((await res.json()).token, undefined, 'token must not be exposed to JavaScript');
  await lucas.login('lucas@taskly.io');
  await mateus.login('mateus.silva@taskly.io');
  await carla.login('carla.m@taskly.io');
});

test('blocks cookie requests without the CSRF header', async () => {
  const r = await lucas.post('/workspaces', { name: 'CSRF test' }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
});

test('blocked accounts cannot sign in', async () => {
  const r = await client().post('/auth/login', { email: 'gabriel.costa@taskly.io', password: 'taskly123' });
  assert.equal(r.status, 403);
});

let ws2Task;
test('workspace isolation prevents IDOR', async () => {
  const created = await lucas.post('/tasks/workspace/ws-2', { title: 'Segredo do ws-2', projectId: undefined });
  // ws-2 has no project yet: create one first.
  if (created.status !== 201) {
    const p = await lucas.post('/projects/workspace/ws-2', { name: 'Projeto privado' });
    assert.equal(p.status, 201);
    const t = await lucas.post('/tasks/workspace/ws-2', { title: 'Segredo do ws-2', projectId: p.data.project.id });
    assert.equal(t.status, 201);
    ws2Task = t.data.task;
  } else ws2Task = created.data.task;

  assert.equal((await mateus.get('/tasks/workspace/ws-2')).status, 404);
  assert.equal((await mateus.get(`/tasks/${ws2Task.id}`)).status, 404);
  assert.equal((await mateus.put(`/tasks/${ws2Task.id}`, { title: 'hacked' })).status, 404);
  assert.equal((await mateus.del(`/tasks/${ws2Task.id}`)).status, 404);
  assert.equal((await mateus.get(`/projects/${ws2Task.projectId}`)).status, 404);
  assert.equal((await mateus.post('/tasks/bulk', { taskIds: [ws2Task.id], action: 'PRIORITY', value: 'Low' })).status, 404);
  const ws = await mateus.get('/workspaces');
  assert.ok(!ws.data.workspaces.some(w => w.id === 'ws-2'));
  const search = await mateus.get('/search?q=Segredo');
  assert.equal(search.data.tasks.length, 0);
  // Carla is a member of ws-2 and can see it.
  assert.equal((await carla.get(`/tasks/${ws2Task.id}`)).status, 200);
});

test('RBAC is enforced on the server', async () => {
  assert.equal((await mateus.get('/admin/users')).status, 403);
  assert.equal((await mateus.post('/automations/workspace/ws-1', { title: 'x', definition: {} })).status, 403);
  assert.equal((await mateus.post('/workspaces/ws-1/invitations', { email: 'a@b.com' })).status, 403);
  assert.equal((await mateus.put('/team/workspace/ws-1/members/usr-4', { role: 'Owner' })).status, 403);
  assert.equal((await mateus.get('/api-keys/workspace/ws-1')).status, 403);
  // Mateus is Manager in ws-3 but cannot grant Owner there.
  assert.equal((await mateus.put('/team/workspace/ws-3/members/usr-1', { role: 'Member' })).status, 400);
});

let recoveryCodes = [];
test('Admin Center requires MFA; enrolling MFA upgrades the session', async () => {
  const blocked = await lucas.get('/admin/users');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'MFA_REQUIRED');
  // Without an MFA-verified session the admin cannot impersonate anyone either.
  assert.deepEqual((await lucas.get('/auth/switchable-accounts')).data.accounts.map(a => a.id), ['usr-1']);

  assert.equal((await lucas.post('/auth/mfa/setup', { password: 'wrong' })).status, 400);
  const setup = await lucas.post('/auth/mfa/setup', { password: 'taskly123' });
  assert.equal(setup.status, 200);
  assert.match(setup.data.qrCode, /^data:image\/png;base64,/);
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.data.secret), digits: 6, period: 30 }).generate();
  assert.equal((await lucas.post('/auth/mfa/enable', { code: '000000' })).status, 400);
  const enabled = await lucas.post('/auth/mfa/enable', { code });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.recoveryCodes.length, 10);
  recoveryCodes = enabled.data.recoveryCodes;
  assert.equal((await lucas.get('/admin/users')).status, 200);
  const me = await lucas.get('/auth/me');
  assert.equal(me.data.user.mfaEnabled, true);
  assert.equal(JSON.stringify(me.data).includes(setup.data.secret), false, 'MFA secret is never serialized');
});

test('login with MFA needs a second factor; recovery codes are single-use', async () => {
  const c = client();
  const first = await c.post('/auth/login', { email: 'lucas@taskly.io', password: 'taskly123' });
  assert.equal(first.status, 200);
  assert.equal(first.data.mfaRequired, true);
  assert.equal(first.data.user, undefined);
  assert.equal((await c.get('/auth/me')).status, 401, 'no session before the second factor');
  assert.equal((await c.post('/auth/mfa/verify', { challenge: first.data.challenge, code: '123456' })).status, 401);
  const ok = await c.post('/auth/mfa/verify', { challenge: first.data.challenge, recoveryCode: recoveryCodes[0] });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/auth/me')).data.session.mfa, true);
  const again = await client().post('/auth/login', { email: 'lucas@taskly.io', password: 'taskly123' });
  assert.equal((await client().post('/auth/mfa/verify', { challenge: again.data.challenge, recoveryCode: recoveryCodes[0] })).status, 401);
});

test('account switching is decided by the backend', async () => {
  const mine = await mateus.get('/auth/switchable-accounts');
  assert.deepEqual(mine.data.accounts.map(a => a.id), ['usr-3']);
  assert.equal((await mateus.post('/auth/switch', { userId: 'usr-1' })).status, 404);
  assert.deepEqual((await mateus.get('/users/switchable-profiles')).data.accounts.map(a => a.id), ['usr-3']);

  const admin = await lucas.get('/auth/switchable-accounts');
  assert.ok(admin.data.accounts.some(a => a.id === 'usr-2'));
  assert.ok(!admin.data.accounts.some(a => a.id === 'usr-5'), 'blocked users are not switchable');
  assert.equal((await lucas.post('/auth/switch', { userId: 'usr-2' })).status, 400, 'a reason is required');
  const sw = await lucas.post('/auth/switch', { userId: 'usr-2', reason: 'Suporte: cliente reportou erro no quadro' });
  assert.equal(sw.status, 200);
  assert.equal((await lucas.get('/auth/me')).data.session.impersonatedBy.id, 'usr-1');
  assert.equal((await lucas.get('/admin/users')).status, 403, 'impersonated session has no admin rights');
  assert.deepEqual((await lucas.get('/auth/switchable-accounts')).data.accounts.map(a => a.id), ['usr-1'], 'can only go back');
  assert.equal((await lucas.post('/auth/switch', { userId: 'usr-1' })).status, 200);
  assert.equal((await lucas.get('/admin/users')).status, 200, 'MFA state restored after impersonation');
  const logs = await lucas.get('/admin/audit-logs?q=IMPERSONATION');
  assert.deepEqual(['IMPERSONATION_ENDED', 'IMPERSONATION_STARTED'], logs.data.auditLogs.slice(0, 2).map(l => l.action));
});

test('Super Admin has no implicit access to other tenants', async () => {
  const ana = client();
  await ana.login('ana.rodrigues@taskly.io');
  const ws = await ana.post('/workspaces', { name: 'Privado da Ana' });
  const p = await ana.post(`/projects/workspace/${ws.data.workspace.id}`, { name: 'Segredo' });
  const t = await ana.post(`/tasks/workspace/${ws.data.workspace.id}`, { title: 'Confidencial', projectId: p.data.project.id });
  assert.equal(t.status, 201);
  assert.equal((await lucas.get(`/tasks/workspace/${ws.data.workspace.id}`)).status, 404);
  assert.equal((await lucas.get(`/tasks/${t.data.task.id}`)).status, 404);
  assert.equal((await lucas.get(`/projects/${p.data.project.id}`)).status, 404);
  assert.equal((await lucas.get('/search?q=Confidencial')).data.tasks.length, 0);
});

test('the Super Admin privilege cannot be granted through the API', async () => {
  assert.equal((await lucas.put('/admin/users/usr-3', { isSuperAdmin: true })).status, 400);
  const created = await lucas.post('/admin/users', { name: 'Nova Pessoa', email: 'nova@taskly.io', isSuperAdmin: true });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.isSuperAdmin, false);
});

test('dependencies block completion unless overridden', async () => {
  const blocked = await lucas.put('/tasks/TSK-1051', { status: 'Done' });
  assert.equal(blocked.status, 409);
  assert.ok(blocked.data.details.blockedByTasks.some(t => t.id === 'TSK-1048'));
  const cycle = await lucas.put('/tasks/TSK-1048', { blockedBy: ['TSK-1051'] });
  assert.equal(cycle.status, 400, 'circular dependency rejected');
  const ok = await lucas.put('/tasks/TSK-1051', { status: 'Done', forceOverride: true });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.task.completedAt);
});

test('completing a recurring task creates the next occurrence', async () => {
  const t = await lucas.post('/tasks/workspace/ws-1', { title: 'Reunião semanal', projectId: 'proj-1', dueDate: '2026-10-05', recurrence: { interval: 'weekly', weekdays: [1], time: '09:00' } });
  assert.equal(t.status, 201);
  const done = await lucas.put(`/tasks/${t.data.task.id}`, { status: 'Done' });
  assert.equal(done.status, 200);
  assert.equal(done.data.spawnedTask.dueDate, '2026-10-12');
  assert.equal(done.data.spawnedTask.status, 'To Do');
});

test('automations execute and are logged', async () => {
  await lucas.put('/tasks/TSK-1050', { status: 'In Progress', priority: 'High' });
  const moved = await lucas.put('/tasks/TSK-1050', { status: 'Review' });
  assert.equal(moved.status, 200);
  const logs = await lucas.get('/automations/logs/ws-1');
  assert.ok(logs.data.logs.some(l => l.automationId === 'aut-2' && l.taskId === 'TSK-1050' && l.status === 'SUCCESS'));
  const notes = await client().login('ana.rodrigues@taskly.io');
  assert.ok(notes);
});

test('destructive bulk actions require confirmation and can be undone', async () => {
  assert.equal((await lucas.post('/tasks/bulk', { taskIds: ['TSK-1052'], action: 'DELETE' })).status, 400);
  const del = await lucas.post('/tasks/bulk', { taskIds: ['TSK-1052'], action: 'DELETE', confirm: true });
  assert.equal(del.status, 200);
  assert.equal((await lucas.get('/tasks/TSK-1052')).status, 404);
  assert.equal((await lucas.post('/tasks/bulk/undo', del.data.undo)).status, 200);
  assert.equal((await lucas.get('/tasks/TSK-1052')).status, 200);
});

test('invitations are single-use and bound to the invited e-mail', async () => {
  const inv = await lucas.post('/workspaces/ws-2/invitations', { email: 'mateus.silva@taskly.io', role: 'Viewer' });
  assert.equal(inv.status, 201);
  const token = new URL(inv.data.inviteLink).searchParams.get('invite');
  assert.equal((await carla.post(`/workspaces/invitations/${token}/accept`)).status, 403);
  assert.equal((await mateus.post(`/workspaces/invitations/${token}/accept`)).status, 200);
  assert.equal((await mateus.post(`/workspaces/invitations/${token}/accept`)).status, 404, 'token cannot be reused');
  // As a Viewer, Mateus can read but not edit.
  assert.equal((await mateus.get(`/tasks/${ws2Task.id}`)).status, 200);
  assert.equal((await mateus.put(`/tasks/${ws2Task.id}`, { title: 'x' })).status, 403);
});

test('file uploads are validated by content', async () => {
  const fake = await lucas.post('/files/project/proj-1', { name: 'evil.png', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
  assert.equal(fake.status, 400);
  const exe = await lucas.post('/files/project/proj-1', { name: 'run.exe', data: Buffer.from('MZ').toString('base64') });
  assert.equal(exe.status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a40000000049454e44ae426082', 'hex');
  const ok = await lucas.post('/files/project/proj-1', { name: 'pixel.png', data: png.toString('base64') });
  assert.equal(ok.status, 201);
  const dl = await lucas.get(`/files/${ok.data.file.id}/download`);
  assert.equal(dl.status, 200);
  assert.ok(dl.data.equals(png));
  assert.equal((await mateus.get(`/files/${ok.data.file.id}/download`)).status, 200, 'member of ws-1 can download');
});

test('reports export CSV and PDF', async () => {
  const csv = await lucas.post('/reports/export/ws-1', { format: 'csv' });
  assert.equal(csv.status, 200);
  assert.match(csv.data.toString('utf8'), /"ID","Título"/);
  const pdf = await lucas.post('/reports/export/ws-1', { format: 'pdf' });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  const report = await lucas.get('/reports/workspace/ws-1');
  assert.equal(typeof report.data.metrics.tasksCompleted, 'number');
});

test('password reset uses a single-use token', async () => {
  const r = await client().post('/auth/forgot-password', { email: 'carla.m@taskly.io' });
  assert.equal(r.status, 200);
  const outbox = path.join(dataDir, 'outbox');
  const file = fs.readdirSync(outbox).map(f => path.join(outbox, f)).find(f => fs.readFileSync(f, 'utf8').includes('carla.m@taskly.io') && f.includes('senha'));
  const token = fs.readFileSync(file, 'utf8').match(/reset=([\w-]+)/)[1];
  const anon = client();
  assert.equal((await anon.post('/auth/reset-password', { token, password: 'nova-senha-123' })).status, 200);
  assert.equal((await anon.post('/auth/reset-password', { token, password: 'outra-senha-123' })).status, 400);
  assert.equal((await carla.get('/auth/me')).status, 401, 'existing sessions are revoked');
  await carla.login('carla.m@taskly.io', 'nova-senha-123');
});

test('trash permanent delete requires explicit confirmation and permission', async () => {
  await lucas.del('/tasks/TSK-1053');
  assert.equal((await lucas.del('/trash/permanent', { type: 'task', id: 'TSK-1053' })).status, 400);
  assert.equal((await mateus.del('/trash/permanent', { type: 'task', id: 'TSK-1053', confirm: true })).status, 403);
  assert.equal((await lucas.del('/trash/permanent', { type: 'task', id: 'TSK-1053', confirm: true })).status, 200);
});

// ------------------------------------------------ security & privacy suite

test('tenant isolation holds for every resource type', async () => {
  // Mateus was invited to ws-2 as Viewer earlier; use a fresh outsider instead.
  const outsider = client();
  const signup = await outsider.post('/auth/signup', { name: 'Pessoa Externa', email: 'externa@exemplo.com', password: 'senha-forte-123', acceptPolicy: true });
  assert.equal(signup.status, 201);
  const projectId = ws2Task.projectId;
  const file = await lucas.post(`/files/project/${projectId}`, { name: 'n.txt', data: Buffer.from('nota interna').toString('base64') });
  const ms = await lucas.post(`/projects/${projectId}/milestones`, { name: 'Marco secreto', dueDate: '2026-12-01' });
  const col = (await lucas.get(`/columns/project/${projectId}`)).data.columns[0];
  const rep = await lucas.post('/reports/saved/ws-2', { name: 'Relatório privado' });
  await lucas.post(`/tasks/${ws2Task.id}/comments`, { text: 'comentário privado' });
  const probes = [
    ['GET', `/tasks/${ws2Task.id}`], ['GET', `/tasks/${ws2Task.id}/activity`], ['POST', `/tasks/${ws2Task.id}/comments`, { text: 'x' }],
    ['GET', `/projects/${projectId}`], ['GET', `/projects/${projectId}/milestones`], ['PUT', `/projects/milestones/${ms.data.milestone.id}`, { name: 'hack' }],
    ['GET', `/columns/project/${projectId}`], ['PUT', `/columns/${col.id}`, { name: 'hack' }],
    ['GET', `/files/project/${projectId}`], ['GET', `/files/${file.data.file.id}/download`], ['DELETE', `/files/${file.data.file.id}`],
    ['GET', '/automations/workspace/ws-2'], ['GET', '/automations/logs/ws-2'], ['GET', '/webhooks/workspace/ws-2'], ['GET', '/api-keys/workspace/ws-2'],
    ['GET', '/reports/workspace/ws-2'], ['POST', '/reports/export/ws-2', { format: 'csv' }], ['PUT', `/reports/saved/item/${rep.data.savedReport.id}`, { name: 'x' }],
    ['GET', '/trash/workspace/ws-2'], ['GET', '/team/workspace/ws-2/members'], ['GET', '/workspaces/ws-2'], ['POST', '/workspaces/ws-2/invitations', { email: 'a@b.com' }]
  ];
  for (const [method, url, body] of probes) {
    const r = await ({ GET: outsider.get, POST: outsider.post, PUT: outsider.put, DELETE: outsider.del })[method](url, body);
    assert.equal(r.status, 404, `${method} ${url} should be 404, got ${r.status}`);
    assert.ok(!JSON.stringify(r.data).includes('privado') && !JSON.stringify(r.data).includes('Segredo'), `${method} ${url} leaked data`);
  }
  const search = await outsider.get('/search?q=privado');
  assert.equal(search.data.comments.length + search.data.tasks.length, 0);
  const notes = await outsider.get('/notifications');
  assert.ok(notes.data.notifications.every(n => n.userId !== 'usr-1'));
});

test('team listing hides last access from roles that do not manage members', async () => {
  const viewer = await mateus.get('/team/workspace/ws-2/members');
  assert.equal(viewer.status, 200);
  assert.ok(viewer.data.members.every(m => !('lastLoginAt' in m)));
  const owner = await lucas.get('/team/workspace/ws-2/members');
  assert.ok(owner.data.members.some(m => 'lastLoginAt' in m));
});

test('SSRF: webhook targets on private networks are rejected', async () => {
  process.env.TASKLY_DATA_DIR = path.join(root, 'ssrf-data');
  process.env.TASKLY_KEY_DIR = env.TASKLY_KEY_DIR;
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
  const { assertSafeWebhookUrl } = await import('../lib/events.js');
  for (const url of ['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fd00::1]/', 'http://0.0.0.0/', 'http://2130706433/', 'file:///etc/passwd', 'gopher://example.com', 'http://user:pw@example.com/']) {
    await assert.rejects(assertSafeWebhookUrl(url), `${url} must be rejected`);
  }
});

test('webhooks are signed and carry only minimal data', async () => {
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { received.push({ headers: req.headers, body }); res.end('ok'); });
  });
  await new Promise(r => receiver.listen(0, r));
  const hook = await lucas.post('/webhooks/workspace/ws-1', { name: 'Teste', url: `http://127.0.0.1:${receiver.address().port}/hook`, events: ['task.created'] });
  assert.equal(hook.status, 201);
  const list = await lucas.get('/webhooks/workspace/ws-1');
  assert.ok(!JSON.stringify(list.data).includes(hook.data.secret), 'secret is never listed');
  await lucas.post('/tasks/workspace/ws-1', { title: 'Evento de webhook', projectId: 'proj-1', description: 'descrição sigilosa' });
  for (let i = 0; i < 30 && !received.length; i++) await new Promise(r => setTimeout(r, 100));
  receiver.close();
  assert.equal(received.length, 1);
  const { headers, body } = received[0];
  const expected = crypto.createHmac('sha256', hook.data.secret).update(`${headers['x-taskly-timestamp']}.${body}`).digest('hex');
  assert.equal(headers['x-taskly-signature'], `sha256=${expected}`);
  const data = JSON.parse(body).data;
  assert.equal(data.title, 'Evento de webhook');
  for (const leak of ['description', 'comments', 'checklist', 'sigilosa', '@taskly.io']) assert.ok(!body.includes(leak), `payload must not include ${leak}`);
});

test('security headers and CSRF origin check', async () => {
  const api = await fetch(`${BASE}/health`);
  assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(api.headers.get('x-frame-options'), 'DENY');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  const page = await fetch(`http://localhost:${PORT}/dashboard`);
  if (page.status === 200) assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const r = await lucas.post('/workspaces', { name: 'Origem estranha' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('stored XSS payloads are returned as inert JSON', async () => {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const t = await lucas.post('/tasks/workspace/ws-1', { title: payload, projectId: 'proj-1' });
  assert.equal(t.status, 201);
  const res = await fetch(`${BASE}/tasks/${t.data.task.id}`, { headers: { Cookie: '' } });
  assert.equal(res.status, 401);
  const got = await lucas.get(`/tasks/${t.data.task.id}`);
  assert.match(got.headers.get('content-type'), /application\/json/);
  assert.equal(got.data.task.title, payload, 'stored verbatim; React escapes on render');
});

test('e-mail verification on signup and policy acknowledgement', async () => {
  const c = client();
  assert.equal((await c.post('/auth/signup', { name: 'Sem Aceite', email: 'semaceite@exemplo.com', password: 'senha-forte-123' })).status, 400);
  const s = await c.post('/auth/signup', { name: 'Verificar Email', email: 'verificar@exemplo.com', password: 'senha-forte-123', acceptPolicy: true });
  assert.equal(s.data.user.emailVerified, false);
  assert.ok(s.data.user.policyAcceptedVersion);
  const outbox = path.join(dataDir, 'outbox');
  const file = fs.readdirSync(outbox).map(f => path.join(outbox, f)).find(f => fs.readFileSync(f, 'utf8').includes('verificar@exemplo.com'));
  const token = fs.readFileSync(file, 'utf8').match(/verify=([\w-]+)/)[1];
  assert.equal((await c.post('/auth/verify-email', { token })).status, 200);
  assert.equal((await c.get('/auth/me')).data.user.emailVerified, true);
  assert.equal((await c.post('/auth/verify-email', { token })).status, 400, 'single use');
});

test('personal data export contains only the requester data', async () => {
  const res = await carla.get('/privacy/me/export');
  assert.equal(res.status, 200);
  const data = res.data;
  const text = JSON.stringify(data);
  assert.equal(data.account.email, 'carla.m@taskly.io');
  for (const other of ['lucas@taskly.io', 'ana.rodrigues@taskly.io', 'passwordHash', 'tokenHash', 'recoveryHashes']) assert.ok(!text.includes(other), `export must not include ${other}`);
  const req = await carla.post('/privacy/requests', { type: 'access', details: 'Quero saber quais dados vocês têm.' });
  assert.equal(req.status, 201);
  assert.ok(req.data.request.dueAt);
  assert.equal((await carla.get('/privacy/requests')).data.requests.length, 1);
  assert.equal((await lucas.get('/admin/privacy-requests')).data.requests.some(r => r.id === req.data.request.id), true);
});

test('account deletion removes the account and de-identifies shared content', async () => {
  const c = client();
  await c.post('/auth/signup', { name: 'Conta Temporaria', email: 'temporaria@exemplo.com', password: 'senha-forte-123', acceptPolicy: true });
  const me = (await c.get('/auth/me')).data.user;
  assert.equal((await c.del('/privacy/me/account', { confirmEmail: 'outro@exemplo.com', password: 'senha-forte-123' })).status, 400);
  assert.equal((await c.del('/privacy/me/account', { confirmEmail: 'temporaria@exemplo.com', password: 'senha-forte-123' })).status, 200);
  assert.equal((await c.get('/auth/me')).status, 401);
  assert.equal((await client().post('/auth/login', { email: 'temporaria@exemplo.com', password: 'senha-forte-123' })).status, 401);
  const logs = await lucas.get('/admin/audit-logs?q=ACCOUNT_DELETED');
  assert.ok(logs.data.auditLogs.some(l => l.entity.includes(me.id) && l.actor === 'Usuário removido'));
});

test('audit trail is tamper-evident', async () => {
  const r = await lucas.get('/admin/audit-integrity');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.checked > 20);
});

test('brute force: account locks after repeated failures', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c.post('/auth/login', { email: 'ana.rodrigues@taskly.io', password: `errada-${i}` });
  const r = await c.post('/auth/login', { email: 'ana.rodrigues@taskly.io', password: 'taskly123' });
  assert.equal(r.status, 401, 'correct password is refused while locked');
});

test('Google OAuth: forged state, linking without session and unlink rules', async () => {
  const noRedirect = async (url, headers = {}) => {
    const res = await fetch(`${BASE}${url}`, { redirect: 'manual', headers });
    return res.headers.get('location') || '';
  };
  assert.match(await noRedirect('/auth/google/start'), /auth_error=google_not_configured/);
  assert.match(await noRedirect('/auth/google/link'), /auth_error=session_required/);
  // A forged state cookie cannot complete any flow (state lives server-side).
  assert.match(await noRedirect('/auth/google/callback?state=abc&code=x', { Cookie: 'taskly_oauth=abc' }), /auth_error=oauth_state/);
  assert.match(await noRedirect('/auth/google/callback?state=abc&code=x'), /auth_error=oauth_state/);
  const unlink = await carla.post('/auth/google/unlink', { password: 'nova-senha-123' });
  assert.equal(unlink.status, 400, 'nothing to unlink');
});
