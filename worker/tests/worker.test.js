// Integration tests against the Cloudflare Worker running in workerd
// (`wrangler dev` with a local D1). Run with:  npm run test:worker
// The script starts `wrangler dev` itself unless WORKER_URL is provided.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import * as OTPAuth from 'otpauth';

const BASE = (process.env.WORKER_URL || 'http://127.0.0.1:8788').replace(/\/$/, '');
const API = `${BASE}/api`;
let dev;

before(async () => {
  if (!process.env.WORKER_URL) {
    execSync('npx wrangler d1 migrations apply taskly --local', { stdio: 'ignore' });
    dev = spawn('npx', ['wrangler', 'dev', '--port', '8788', '--ip', '127.0.0.1', '--test-scheduled', '--var', 'APP_URL:http://127.0.0.1:8788', '--show-interactive-dev-session=false'], { stdio: 'ignore', shell: true });
  }
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* booting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('worker did not start');
});

after(() => {
  if (dev) {
    try { process.platform === 'win32' ? execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: 'ignore' }) : dev.kill(); } catch { /* already gone */ }
  }
});

function client(origin = BASE) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(`${API}${url}`, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'taskly', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(p => p.split('=')));
      if (value) jar[name] = value; else delete jar[name];
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
  return { get: (u, h) => call('GET', u, undefined, h), post: (u, b, h) => call('POST', u, b ?? {}, h), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b), get cookie() { return cookie; } };
}

const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const email = `worker-${unique}@exemplo.com`;
const password = 'senha-forte-worker-123';
const user = client();

test('GET /api/health is served by the Worker (JSON, not the SPA)', async () => {
  const res = await fetch(`${API}/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.runtime, 'cloudflare-workers');
});

test('POST /api/auth/login reaches Express (never 405)', async () => {
  const res = await client().post('/auth/login', { email: 'ninguem@exemplo.com', password: 'errada-123' });
  assert.notEqual(res.status, 405);
  assert.equal(res.status, 401);
  assert.equal(res.data.code, 'UNAUTHENTICATED');
});

test('login validates required fields', async () => {
  const res = await client().post('/auth/login', { password: 'x' });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'VALIDATION_ERROR');
});

test('signup creates the account in D1 and a session cookie', async () => {
  const res = await user.post('/auth/signup', { name: 'Pessoa Worker', email, password, acceptPolicy: true });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const setCookie = res.headers.getSetCookie().find(c => c.startsWith('taskly_session='));
  assert.ok(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
  // `wrangler dev` bundles with NODE_ENV=development; deployed builds add Secure.
  if (BASE.startsWith('https:')) assert.match(setCookie, /Secure/i);
  const me = await user.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);
});

test('password is stored with the Worker-compatible PBKDF2 format', () => {
  const out = execSync(`npx wrangler d1 execute taskly --local --json --command "SELECT json_extract(data, '$.passwordHash') AS h FROM users WHERE lower(json_extract(data, '$.email')) = '${email}'"`, { encoding: 'utf8' });
  const hash = JSON.parse(out)[0].results[0].h;
  assert.match(hash, /^pbkdf2\$sha256\$100000\$/);
});

test('login with valid credentials returns 200 and a working session', async () => {
  const c = client();
  const res = await c.post('/auth/login', { email, password });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.user.email, email);
  assert.equal((await c.get('/auth/me')).status, 200);
});

test('logout ends the session', async () => {
  const c = client();
  await c.post('/auth/login', { email, password });
  assert.equal((await c.post('/auth/logout')).status, 200);
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('protected routes require authentication', async () => {
  assert.equal((await client().get('/workspaces')).status, 401);
  assert.equal((await client().get('/admin/users')).status, 401);
});

test('CSRF: missing header or foreign Origin is rejected', async () => {
  assert.equal((await user.post('/workspaces', { name: 'X' }, { 'X-Requested-With': '' })).status, 403);
  assert.equal((await user.post('/workspaces', { name: 'X' }, { Origin: 'https://evil.example' })).status, 403);
});

test('CORS: only the app origin is allowed', async () => {
  const good = await fetch(`${API}/health`, { headers: { Origin: BASE } });
  assert.equal(good.headers.get('access-control-allow-origin'), BASE);
  const bad = await fetch(`${API}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('data persists across requests (workspace → project → task)', async () => {
  const ws = (await user.get('/workspaces')).data.workspaces[0];
  const p = await user.post(`/projects/workspace/${ws.id}`, { name: 'Projeto no D1' });
  assert.equal(p.status, 201);
  const t = await user.post(`/tasks/workspace/${ws.id}`, { title: 'Tarefa persistida', projectId: p.data.project.id });
  assert.equal(t.status, 201);
  const again = await client().post('/auth/login', { email, password }).then(() => user.get(`/tasks/${t.data.task.id}`));
  assert.equal(again.status, 200);
  assert.equal(again.data.task.title, 'Tarefa persistida');
});

test('concurrent requests do not lose writes (request isolation)', async () => {
  const ws = (await user.get('/workspaces')).data.workspaces[0];
  const project = (await user.get(`/projects/workspace/${ws.id}`)).data.projects[0];
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => user.post(`/tasks/workspace/${ws.id}`, { title: `Paralela ${i}`, projectId: project.id })));
  results.forEach(r => assert.equal(r.status, 201));
  const ids = new Set(results.map(r => r.data.task.id));
  assert.equal(ids.size, 8, 'task ids are unique');
  const list = (await user.get(`/tasks/workspace/${ws.id}`)).data.tasks;
  for (const id of ids) assert.ok(list.some(t => t.id === id), `${id} was persisted`);
});

test('MFA: enable, then login requires the second factor', async () => {
  const setup = await user.post('/auth/mfa/setup', { password });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  assert.match(setup.data.qrCode, /^data:image\/svg\+xml;base64,/);
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.data.secret), digits: 6, period: 30 }).generate();
  const enabled = await user.post('/auth/mfa/enable', { code });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  const c = client();
  const first = await c.post('/auth/login', { email, password });
  assert.equal(first.data.mfaRequired, true);
  assert.equal((await c.get('/auth/me')).status, 401);
  const ok = await c.post('/auth/mfa/verify', { challenge: first.data.challenge, recoveryCode: enabled.data.recoveryCodes[0] });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/auth/me')).data.session.mfa, true);
});

test('uploads answer 503 with a clear message when R2 is not bound', async () => {
  const ws = (await user.get('/workspaces')).data.workspaces[0];
  const project = (await user.get(`/projects/workspace/${ws.id}`)).data.projects[0];
  const res = await user.post(`/files/project/${project.id}`, { name: 'nota.txt', data: Buffer.from('ok').toString('base64') });
  assert.equal(res.status, 503);
  assert.equal(res.data.code, 'STORAGE_NOT_CONFIGURED');
});

test('Cron Trigger runs the maintenance jobs', async () => {
  const res = await fetch(`${BASE}/__scheduled?cron=0+*+*+*+*`);
  assert.equal(res.status, 200);
});

test('non-API paths are served by Static Assets with security headers', async () => {
  const res = await fetch(`${BASE}/dashboard`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
});
