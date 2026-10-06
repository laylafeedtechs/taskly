// Criativos (Social Media Hub) integration tests.
// Boots the API against a throwaway database and a local stand-in for the
// Meta Graph API that follows the documented Instagram contract (OAuth code
// exchange, long-lived token, containers, status_code, media_publish). The
// stand-in really downloads every media URL it receives, like Meta does, so
// the signed public URLs are exercised end to end.
// Run with: npm run test:creatives
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const PORT = 5098;
const BASE = `http://localhost:${PORT}/api`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskly-creatives-'));
let server;

// ------------------------------------------------------------ Meta stand-in

const meta = {
  tokens: new Map(), // access token -> igUserId
  accounts: { '17841400000000001': 'agencia_xyz', '17841400000000002': 'cliente_b' },
  containers: new Map(),
  media: [],
  publishCalls: 0,
  revoked: false,
  failNextPublishWith500: false,
  fetchedUrls: [],
  seq: 0
};
let graph;
let graphUrl;

function jpeg(width, height) {
  // SOI, APP0 (JFIF), SOF0 with the frame size, EOI: enough to be a JPEG for
  // the magic-number checks and dimension parsing.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(64, 0x11), Buffer.from([0xff, 0xd9])]);
}

function png(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(32)]);
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function mp4({ durationMs, width = 1080, height = 1920 }) {
  const mvhd = Buffer.alloc(100); // version 0
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(durationMs, 16); // duration
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'latin1')), box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd))), box('mdat', Buffer.alloc(256, 1))]);
}

const graphError = (res, status, error) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error })); };
const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

function startGraph() {
  graph = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const form = req.method === 'POST' ? await readBody(req) : {};
    const token = form.access_token || url.searchParams.get('access_token');

    if (p === '/cdn/avatar.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(jpeg(150, 150)); }
    if (p === '/oauth/authorize') return json(res, { ok: true });
    if (p === '/oauth/access_token') {
      if (form.client_secret !== 'test-app-secret' || form.grant_type !== 'authorization_code') return graphError(res, 400, { message: 'bad client', code: 101 });
      const igId = form.code === 'acct2' ? '17841400000000002' : '17841400000000001';
      const short = `short-${++meta.seq}`;
      meta.tokens.set(short, igId);
      return json(res, { data: [{ access_token: short, user_id: igId, permissions: 'instagram_business_basic,instagram_business_content_publish' }] });
    }
    if (p === '/access_token') {
      const igId = meta.tokens.get(url.searchParams.get('access_token'));
      if (!igId) return graphError(res, 400, { message: 'invalid', code: 190, type: 'OAuthException' });
      const long = `IGlongtoken${igId}x${++meta.seq}abcdefghijklmnopqrstuvwxyz`;
      meta.tokens.set(long, igId);
      return json(res, { access_token: long, token_type: 'bearer', expires_in: 5184000 });
    }

    const m = p.match(/^\/v25\.0\/(.+)$/);
    if (!m) return graphError(res, 404, { message: 'unknown', code: 100 });
    if (meta.revoked) return graphError(res, 401, { message: 'Error validating access token: Session has expired', code: 190, type: 'OAuthException' });
    const igId = meta.tokens.get(token);
    if (!igId) return graphError(res, 400, { message: 'Invalid OAuth access token', code: 190, type: 'OAuthException' });
    const [first, second] = m[1].split('/');

    if (first === 'me') {
      return json(res, { user_id: igId, id: igId, username: meta.accounts[igId], name: `Conta ${meta.accounts[igId]}`, account_type: 'BUSINESS', profile_picture_url: `http://127.0.0.1:${graph.address().port}/cdn/avatar.jpg`, followers_count: 1234, media_count: meta.media.filter(x => x.owner === igId).length });
    }
    if (second === 'content_publishing_limit') return json(res, { data: [{ quota_usage: meta.media.length, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (second === 'media' && req.method === 'GET') {
      return json(res, { data: meta.media.filter(x => x.owner === first).slice().reverse().map(x => ({ id: x.id, caption: x.caption, media_type: 'IMAGE', media_url: `http://127.0.0.1:${graph.address().port}/cdn/avatar.jpg`, permalink: `https://www.instagram.com/p/${x.id}/`, timestamp: x.timestamp })) });
    }
    if (second === 'media' && req.method === 'POST') {
      if (first !== igId) return graphError(res, 403, { message: 'wrong account', code: 10 });
      const id = `cont${++meta.seq}`;
      let status = 'FINISHED';
      if (form.media_type === 'CAROUSEL') {
        const children = String(form.children || '').split(',');
        if (children.length < 2 || children.some(c => meta.containers.get(c)?.status !== 'FINISHED')) status = 'ERROR';
      } else {
        // Like Meta: download the media from the given public URL.
        const mediaUrl = form.image_url || form.video_url;
        meta.fetchedUrls.push(mediaUrl);
        try {
          const r = await fetch(mediaUrl);
          const bytes = Buffer.from(await r.arrayBuffer());
          if (!r.ok) status = 'ERROR';
          else if (form.image_url && !(bytes[0] === 0xff && bytes[1] === 0xd8)) status = 'ERROR';
        } catch { status = 'ERROR'; }
      }
      meta.containers.set(id, { id, owner: igId, status, caption: form.caption || '', mediaType: form.media_type || 'IMAGE' });
      return json(res, { id });
    }
    if (second === 'media_publish') {
      const c = meta.containers.get(form.creation_id);
      if (!c || c.owner !== igId) return graphError(res, 400, { message: 'Invalid creation id', code: 100 });
      if (c.status === 'PUBLISHED') return graphError(res, 400, { message: 'Container already published', code: 100, error_subcode: 2207008 });
      if (c.status !== 'FINISHED') return graphError(res, 400, { message: 'Media not ready', code: 9007, error_subcode: 2207027 });
      meta.publishCalls++;
      c.status = 'PUBLISHED';
      const mediaId = `1790000${++meta.seq}`;
      meta.media.push({ id: mediaId, owner: igId, caption: c.caption, timestamp: new Date().toISOString().replace('Z', '+0000') });
      if (meta.failNextPublishWith500) {
        // Published on Meta's side, but the answer is lost: the ambiguous case.
        meta.failNextPublishWith500 = false;
        return graphError(res, 500, { message: 'An unexpected error has occurred', code: 2, type: 'OAuthException' });
      }
      return json(res, { id: mediaId });
    }
    if (!second && meta.containers.has(first)) return json(res, { status_code: meta.containers.get(first).status, id: first });
    const media = meta.media.find(x => x.id === first);
    if (!second && media) return json(res, { id: media.id, permalink: `https://www.instagram.com/p/${media.id}/`, timestamp: media.timestamp });
    return graphError(res, 404, { message: 'Unsupported get request', code: 100 });
  });
  return new Promise(resolve => graph.listen(0, '127.0.0.1', () => { graphUrl = `http://127.0.0.1:${graph.address().port}`; resolve(); }));
}

before(async () => {
  await startGraph();
  server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env, TASKLY_DATA_DIR: path.join(root, 'data'), TASKLY_KEY_DIR: path.join(root, 'keys'), TASKLY_BACKUP_DIR: path.join(root, 'backups'),
      PORT: String(PORT), LOG_LEVEL: 'silent', APP_URL: `http://localhost:${PORT}`, SMTP_HOST: '', TASKLY_DISABLE_BACKUPS: '1', NODE_ENV: 'test',
      INSTAGRAM_APP_ID: 'test-app-id', INSTAGRAM_APP_SECRET: 'test-app-secret',
      INSTAGRAM_GRAPH_URL: graphUrl, INSTAGRAM_AUTHORIZE_URL: `${graphUrl}/oauth/authorize`, INSTAGRAM_TOKEN_URL: `${graphUrl}/oauth/access_token`,
      INSTAGRAM_CDN_TEST_HOST: new URL(graphUrl).host, TASKLY_SCHEDULER_INTERVAL_MS: '400', TASKLY_CONTAINER_RECHECK_MS: '300'
    },
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
  graph?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ client

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
      method,
      headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', 'X-Requested-With': 'taskly', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      redirect: 'manual'
    });
    (res.headers.getSetCookie?.() || []).forEach(c => {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
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
    patch: (u, b) => call('PATCH', u, b),
    del: (u, b) => call('DELETE', u, b),
    login: async email => {
      const r = await call('POST', '/auth/login', { email, password: 'taskly123' });
      assert.equal(r.status, 200, `login ${email}`);
      return r.data.user;
    }
  };
}

const ana = client(); // Manager in ws-1 (approve / publish / accounts)
const mateus = client(); // Member in ws-1 (create / edit only); not in ws-2
const carla = client(); // Member in ws-1 and ws-2
const state = {};

const upload = (c, ws, name, bytes, query = '') => c.post(`/creatives/workspace/${ws}/upload${query}`, bytes, { 'X-File-Name': encodeURIComponent(name) });

async function waitFor(fn, { timeout = 15000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise(r => setTimeout(r, every));
  }
}

async function connect(c, code = 'ok') {
  const start = await c.post('/social/workspace/ws-1/accounts/connect', { provider: 'instagram' });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const authUrl = new URL(start.data.authorizationUrl);
  assert.equal(authUrl.searchParams.get('client_id'), 'test-app-id');
  assert.match(authUrl.searchParams.get('scope'), /instagram_business_content_publish/);
  const cb = await c.get(`/social/instagram/callback?code=${code}&state=${encodeURIComponent(authUrl.searchParams.get('state'))}`);
  assert.equal(cb.status, 302);
  return cb.headers.get('location');
}

async function newPublication(c, body) {
  const r = await c.post('/publications/workspace/ws-1', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.publication;
}

async function approved(body) {
  const pub = await newPublication(mateus, body);
  assert.equal((await mateus.post(`/publications/${pub.id}/submit`)).status, 200);
  const ok = await ana.post(`/publications/${pub.id}/approve`);
  assert.equal(ok.status, 200);
  return ok.data.publication;
}

// ------------------------------------------------------------------- tests

test('setup: sign in', async () => {
  await ana.login('ana.rodrigues@taskly.io');
  await mateus.login('mateus.silva@taskly.io');
  await carla.login('carla.m@taskly.io');
});

test('accounts: no account yet, integration status without secrets', async () => {
  const r = await ana.get('/social/workspace/ws-1/accounts');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.accounts, []);
  const ig = r.data.integrations.find(i => i.provider === 'instagram');
  assert.equal(ig.configured, true);
  assert.deepEqual(ig.requiredConfig, ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']);
  assert.ok(!JSON.stringify(r.data).includes('test-app-secret'));
});

test('accounts: only roles with creatives.manage_accounts can connect', async () => {
  assert.equal((await mateus.post('/social/workspace/ws-1/accounts/connect', { provider: 'instagram' })).status, 403);
});

test('accounts: forged OAuth state is rejected', async () => {
  await ana.post('/social/workspace/ws-1/accounts/connect', { provider: 'instagram' });
  const cb = await ana.get('/social/instagram/callback?code=ok&state=forged');
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /social_error=oauth_state/);
});

test('accounts: OAuth connection stores an encrypted token that never reaches the browser', async () => {
  const location = await connect(ana);
  assert.match(location, /\/creatives\/sac-[a-f0-9]+\/feed\?social=connected/);
  const list = await waitFor(async () => {
    const r = await ana.get('/social/workspace/ws-1/accounts');
    return r.data.accounts[0]?.hasAvatar ? r : null;
  });
  const account = list.data.accounts[0];
  state.account = account;
  assert.equal(account.username, 'agencia_xyz');
  assert.equal(account.status, 'CONNECTED');
  assert.equal(account.capabilities.canPublishReel, true);
  assert.equal(account.metadata.followersCount, 1234);
  const text = JSON.stringify(list.data);
  assert.ok(!/IGlongtoken|short-\d|accessToken|credentialId/.test(text), 'no token or credential reference in the response');
  const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'taskly_db.json'), 'utf8'));
  const cred = db.socialCredentials.find(c => c.accountId === account.id);
  assert.match(cred.accessToken, /^enc:v1:/, 'token is sealed at rest');
  assert.equal((await ana.get(`/social/accounts/${account.id}/avatar`)).status, 200);
});

test('accounts: a second account is isolated from the first', async () => {
  await connect(ana, 'acct2');
  const r = await ana.get('/social/workspace/ws-1/accounts');
  assert.equal(r.data.accounts.length, 2);
  state.accountB = r.data.accounts.find(a => a.username === 'cliente_b');
  assert.ok(state.accountB);
});

test('library: uploads are validated by content, not by extension', async () => {
  const ok = await upload(mateus, 'ws-1', 'black-friday-04.jpg', jpeg(1080, 1350), '?tags=black%20friday,feed');
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.creative.width, 1080);
  assert.equal(ok.data.creative.height, 1350);
  assert.deepEqual(ok.data.creative.tags, ['black friday', 'feed']);
  state.image = ok.data.creative;

  const second = await upload(mateus, 'ws-1', 'carrossel-2.jpg', jpeg(1080, 1080));
  state.image2 = second.data.creative;
  const pngUp = await upload(mateus, 'ws-1', 'arte.png', png(1080, 1080));
  assert.equal(pngUp.status, 201);
  state.png = pngUp.data.creative;
  const video = await upload(mateus, 'ws-1', 'reel.mp4', mp4({ durationMs: 15000 }));
  assert.equal(video.status, 201, JSON.stringify(video.data));
  assert.equal(video.data.creative.kind, 'video');
  assert.equal(video.data.creative.durationMs, 15000);
  assert.equal(video.data.creative.height, 1920);
  state.video = video.data.creative;

  assert.equal((await upload(mateus, 'ws-1', 'fake.jpg', png(10, 10))).status, 400, 'PNG bytes named .jpg');
  assert.equal((await upload(mateus, 'ws-1', 'script.exe', Buffer.from('MZ'))).status, 400);
  assert.equal((await upload(mateus, 'ws-1', 'empty.mp4', Buffer.from('not a video at all'))).status, 400);
});

test('library: files are private, support ranges and stay inside the workspace', async () => {
  const anon = client();
  assert.equal((await anon.get(`/creatives/${state.image.id}/file`)).status, 401);
  const range = await mateus.get(`/creatives/${state.image.id}/file`, { Range: 'bytes=0-9' });
  assert.equal(range.status, 206);
  assert.equal(range.data.length, 10);
  assert.match(range.headers.get('content-range'), /^bytes 0-9\/\d+$/);

  const other = await upload(carla, 'ws-2', 'ws2-secret.jpg', jpeg(1080, 1080));
  assert.equal(other.status, 201);
  state.ws2Creative = other.data.creative;
  assert.equal((await mateus.get(`/creatives/${other.data.creative.id}/file`)).status, 404, 'cross-workspace file is not found');
  assert.equal((await mateus.get(`/creatives/${other.data.creative.id}`)).status, 404);
  assert.equal((await mateus.get('/creatives/workspace/ws-2')).status, 404);
});

test('publications: create ignores mass-assigned fields and rejects cross-tenant ids', async () => {
  const pub = await newPublication(mateus, {
    socialAccountId: state.account.id, type: 'POST', title: 'Black Friday — Post 04', media: [state.image.id], caption: 'Oferta imperdível', hashtags: ['#blackfriday', 'promo'],
    status: 'PUBLISHED', externalId: 'forged', workspaceId: 'ws-2', createdBy: 'usr-1'
  });
  assert.equal(pub.status, 'DRAFT');
  assert.equal(pub.externalId, null);
  assert.equal(pub.workspaceId, 'ws-1');
  assert.equal(pub.createdBy, 'usr-3');
  assert.deepEqual(pub.hashtags, ['blackfriday', 'promo']);
  state.pub = pub;
  const cross = await mateus.post('/publications/workspace/ws-1', { socialAccountId: state.account.id, type: 'POST', media: [state.ws2Creative.id] });
  assert.equal(cross.status, 400, 'creative from another workspace');
  assert.equal((await carla.post('/publications/workspace/ws-2', { socialAccountId: state.account.id, type: 'POST' })).status, 400, 'account from another workspace');
});

test('publications: format rules come from the official API constraints', async () => {
  const pngPub = await newPublication(mateus, { socialAccountId: state.account.id, type: 'POST', media: [state.png.id] });
  assert.ok(pngPub.problems.some(p => /JPEG/.test(p.message)));
  const reelWithImage = await newPublication(mateus, { socialAccountId: state.account.id, type: 'REEL', media: [state.image.id] });
  assert.ok(reelWithImage.problems.length > 0);
  const carousel = await newPublication(mateus, { socialAccountId: state.account.id, type: 'CAROUSEL', media: [state.image.id] });
  assert.ok(carousel.problems.some(p => /pelo menos 2/.test(p.message)));
  assert.equal((await mateus.post(`/publications/${pngPub.id}/submit`)).status, 400, 'invalid content cannot go to approval');
  for (const id of [pngPub.id, reelWithImage.id, carousel.id]) assert.equal((await mateus.del(`/publications/${id}`)).status, 200, 'own drafts can be deleted');
});

test('approvals: only approvers decide, rejection needs a reason that is kept', async () => {
  const id = state.pub.id;
  assert.equal((await mateus.post(`/publications/${id}/submit`)).status, 200);
  const notifs = await ana.get('/notifications?category=Creatives');
  assert.ok(notifs.data.notifications.some(n => n.title === 'Publicação aguardando aprovação' && n.link?.includes(id)));
  assert.equal((await mateus.post(`/publications/${id}/approve`)).status, 403);
  assert.equal((await ana.post(`/publications/${id}/reject`, {})).status, 400, 'reason required');
  const rejected = await ana.post(`/publications/${id}/reject`, { reason: 'Alterar CTA da legenda.' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.publication.status, 'DRAFT');
  assert.equal(rejected.data.publication.approval.reason, 'Alterar CTA da legenda.');
  await mateus.patch(`/publications/${id}`, { caption: 'Oferta imperdível — compre agora' });
  await mateus.post(`/publications/${id}/submit`);
  const ok = await ana.post(`/publications/${id}/approve`);
  assert.equal(ok.data.publication.status, 'APPROVED');
  const history = await mateus.get(`/publications/${id}/history`);
  assert.deepEqual(history.data.approvals.map(a => a.action), ['REQUESTED', 'REJECTED', 'REQUESTED', 'APPROVED']);
  assert.ok(history.data.events.some(e => e.action === 'PUBLICATION_REJECTED' && e.details.reason === 'Alterar CTA da legenda.'));
});

test('scheduling: needs publish permission, a future time and confirmation for changes', async () => {
  const id = state.pub.id;
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  assert.equal((await mateus.post(`/publications/${id}/schedule`, { scheduledAt: future })).status, 403);
  assert.equal((await ana.post(`/publications/${id}/schedule`, { scheduledAt: new Date(Date.now() - 60000).toISOString() })).status, 400);
  const scheduled = await ana.post(`/publications/${id}/schedule`, { scheduledAt: future });
  assert.equal(scheduled.status, 200);
  assert.equal(scheduled.data.publication.status, 'SCHEDULED');

  const later = new Date(Date.now() + 4 * 86400000).toISOString();
  assert.equal((await mateus.patch(`/publications/${id}`, { scheduledAt: later })).status, 403, 'members cannot move scheduled posts');
  const ask = await ana.patch(`/publications/${id}`, { scheduledAt: later });
  assert.equal(ask.status, 409);
  assert.equal(ask.data.code, 'REQUIRES_CONFIRMATION');
  const moved = await ana.patch(`/publications/${id}`, { scheduledAt: later, confirmReschedule: true });
  assert.equal(moved.data.publication.scheduledAt, later);
  assert.equal(moved.data.publication.status, 'SCHEDULED');

  const reset = await ana.patch(`/publications/${id}`, { caption: 'Nova legenda' });
  assert.equal(reset.data.code, 'REQUIRES_CONFIRMATION', 'content change after approval asks first');
  const draft = await ana.patch(`/publications/${id}`, { caption: 'Nova legenda', confirmReset: true });
  assert.equal(draft.data.publication.status, 'DRAFT');
  assert.equal(draft.data.publication.approval.state, 'RESET');
});

test('publishing: backend worker publishes and only marks PUBLISHED after the API confirms', async () => {
  const pub = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'Post agora', media: [state.image.id], caption: 'Publicado pelo Taskly' });
  assert.equal((await mateus.post(`/publications/${pub.id}/publish`)).status, 403);
  const now = await ana.post(`/publications/${pub.id}/publish`);
  assert.equal(now.status, 200);
  assert.ok(['SCHEDULED', 'PUBLISHING'].includes(now.data.publication.status), 'never PUBLISHED synchronously');
  const done = await waitFor(async () => {
    const r = await ana.get(`/publications/${pub.id}`);
    return r.data.publication.status === 'PUBLISHED' ? r.data.publication : null;
  });
  assert.match(done.externalId, /^1790000/);
  assert.match(done.permalink, /instagram\.com\/p\//);
  assert.ok(meta.fetchedUrls.some(u => u.includes('/api/social/media/')), 'Meta fetched the creative through a signed URL');
  const attempts = await ana.get(`/publications/${pub.id}/attempts`);
  assert.equal(attempts.data.attempts.length, 1);
  assert.equal(attempts.data.attempts[0].outcome, 'SUCCESS');
  assert.equal(attempts.data.attempts[0].idempotencyKey, `${pub.id}:1`);
  assert.ok(!JSON.stringify(done).includes('lockId'));
  // Published content is immutable.
  assert.equal((await ana.patch(`/publications/${pub.id}`, { caption: 'x' })).status, 409);
  const notifs = await mateus.get('/notifications?category=Creatives');
  assert.ok(notifs.data.notifications.some(n => n.title === 'Publicação no ar'));
  state.published = done;
});

test('publishing: signed media URLs cannot be forged and expire', async () => {
  const forged = await client().get(`${BASE}/social/media/eyJjIjoiY3J2In0.forged`);
  assert.equal(forged.status, 404);
  const { signedMediaUrl, verifyMediaToken } = await import('../lib/social/mediaUrl.js');
  process.env.TASKLY_KEY_DIR = path.join(root, 'unit-keys');
  const url = signedMediaUrl('crv-1', { now: Date.now() - 3 * 3600000 });
  assert.equal(verifyMediaToken(url.split('/').pop()), null, 'expired after 2 hours');
  const fresh = signedMediaUrl('crv-1');
  assert.equal(verifyMediaToken(fresh.split('/').pop()), 'crv-1');
  const tampered = fresh.split('/').pop().replace(/^./, c => (c === 'a' ? 'b' : 'a'));
  assert.equal(verifyMediaToken(tampered), null);
});

test('idempotency: a lost publish answer is verified, never published twice', async () => {
  const before = meta.publishCalls;
  meta.failNextPublishWith500 = true;
  const pub = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'Resposta perdida', media: [state.image2.id], caption: 'Teste de idempotência' });
  await ana.post(`/publications/${pub.id}/publish`);
  const done = await waitFor(async () => {
    const r = await ana.get(`/publications/${pub.id}`);
    return r.data.publication.status === 'PUBLISHED' ? r.data.publication : null;
  });
  assert.equal(meta.publishCalls - before, 1, 'media_publish executed exactly once on the network');
  assert.ok(done.externalId, 'the published media was found through the API');
  const history = await ana.get(`/publications/${pub.id}/history`);
  assert.ok(history.data.events.some(e => e.action === 'PUBLICATION_PUBLISHED'));
});

test('carousel: children are created first, then the parent container', async () => {
  const pub = await approved({ socialAccountId: state.account.id, type: 'CAROUSEL', title: 'Carrossel', media: [state.image.id, state.image2.id], caption: 'Arraste para o lado' });
  await ana.post(`/publications/${pub.id}/publish`);
  const done = await waitFor(async () => {
    const r = await ana.get(`/publications/${pub.id}`);
    return ['PUBLISHED', 'FAILED'].includes(r.data.publication.status) ? r.data.publication : null;
  });
  assert.equal(done.status, 'PUBLISHED', JSON.stringify(done.error));
  assert.ok([...meta.containers.values()].some(c => c.mediaType === 'CAROUSEL' && c.status === 'PUBLISHED'));
});

test('failures: expired authorization fails clearly and asks for reconnection', async () => {
  const pub = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'Token expirado', media: [state.image.id], caption: 'x' });
  meta.revoked = true;
  await ana.post(`/publications/${pub.id}/publish`);
  const failed = await waitFor(async () => {
    const r = await ana.get(`/publications/${pub.id}`);
    return r.data.publication.status === 'FAILED' ? r.data.publication : null;
  });
  meta.revoked = false;
  assert.equal(failed.error.kind, 'AUTH');
  assert.equal(failed.error.action.code, 'RECONNECT');
  assert.ok(!/IGlongtoken|access_token=/.test(JSON.stringify(failed.error)), 'no token in the error');
  const accounts = await ana.get('/social/workspace/ws-1/accounts');
  assert.equal(accounts.data.accounts.find(a => a.id === state.account.id).status, 'REAUTH_REQUIRED');
  assert.equal((await ana.post(`/publications/${pub.id}/retry`)).status, 409, 'cannot retry until the account is reconnected');

  await connect(ana); // reconnects the same account
  const retry = await ana.post(`/publications/${pub.id}/retry`);
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  const ok = await waitFor(async () => {
    const r = await ana.get(`/publications/${pub.id}`);
    return r.data.publication.status === 'PUBLISHED' ? r.data.publication : null;
  });
  assert.ok(ok.externalId);
  const attempts = await ana.get(`/publications/${pub.id}/attempts`);
  assert.deepEqual(attempts.data.attempts.map(a => a.outcome), ['SUCCESS', 'FAILED']);
});

test('feed planner: published + planned, visual order separate from the schedule', async () => {
  const d1 = new Date(Date.now() + 5 * 86400000).toISOString();
  const d2 = new Date(Date.now() + 6 * 86400000).toISOString();
  const a = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'Futuro A', media: [state.image.id], scheduledAt: d1 });
  const b = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'Futuro B', media: [state.image2.id], scheduledAt: d2 });
  await ana.post(`/publications/${a.id}/schedule`);
  await ana.post(`/publications/${b.id}/schedule`);
  const feed = await mateus.get(`/publications/workspace/ws-1/feed?accountId=${state.account.id}`);
  assert.equal(feed.status, 200);
  assert.ok(feed.data.published.length >= 3);
  assert.deepEqual(feed.data.planned.filter(p => [a.id, b.id].includes(p.id)).map(p => p.id), [b.id, a.id], 'latest on top by default');
  assert.equal(feed.data.orderMatchesSchedule, true);

  const order = [a.id, b.id, ...feed.data.planned.map(p => p.id).filter(id => ![a.id, b.id].includes(id))];
  assert.equal((await mateus.put('/publications/workspace/ws-1/feed-order', { accountId: state.account.id, order })).status, 200);
  const reordered = await mateus.get(`/publications/workspace/ws-1/feed?accountId=${state.account.id}`);
  assert.equal(reordered.data.planned[0].id, a.id);
  assert.equal(reordered.data.orderMatchesSchedule, false, 'planned order differs from the schedule');
  assert.equal((await ana.get(`/publications/${a.id}`)).data.publication.scheduledAt, d1, 'reordering never changed dates');
  assert.equal((await mateus.put('/publications/workspace/ws-1/feed-order', { accountId: state.account.id, order: [state.published.id] })).status, 400, 'published items cannot be reordered');

  assert.equal((await mateus.post('/publications/workspace/ws-1/feed-apply-dates', { accountId: state.account.id, order, confirm: true })).status, 403, 'scheduled dates need publish permission');
  const ask = await ana.post('/publications/workspace/ws-1/feed-apply-dates', { accountId: state.account.id, order });
  assert.equal(ask.status, 409);
  assert.equal(ask.data.details.changes.length, 2);
  assert.equal((await ana.post('/publications/workspace/ws-1/feed-apply-dates', { accountId: state.account.id, order, confirm: true })).data.changed, 2);
  assert.equal((await ana.get(`/publications/${a.id}`)).data.publication.scheduledAt, d2);
  state.scheduledA = a;
});

test('accounts: switching accounts never mixes data', async () => {
  const pubB = await newPublication(mateus, { socialAccountId: state.accountB.id, type: 'POST', title: 'Só da conta B', media: [state.image.id] });
  const listA = await mateus.get(`/publications/workspace/ws-1?accountId=${state.account.id}`);
  const listB = await mateus.get(`/publications/workspace/ws-1?accountId=${state.accountB.id}`);
  assert.ok(listA.data.publications.every(p => p.socialAccountId === state.account.id));
  assert.deepEqual(listB.data.publications.map(p => p.id), [pubB.id]);
  const feedB = await mateus.get(`/publications/workspace/ws-1/feed?accountId=${state.accountB.id}`);
  assert.deepEqual(feedB.data.published, []);
});

test('calendar & overview: monthly counts, filters and upcoming publications', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const overview = await mateus.get(`/publications/workspace/ws-1/overview?accountId=${state.account.id}`);
  assert.equal(overview.status, 200);
  assert.ok(overview.data.metrics.published >= 4);
  assert.ok(overview.data.months.some(m => m.month === month));
  assert.ok(overview.data.upcoming.some(p => p.id === state.scheduledA.id));
  const from = new Date(Date.now() + 4 * 86400000).toISOString();
  const cal = await mateus.get(`/publications/workspace/ws-1?accountId=${state.account.id}&from=${from}&status=SCHEDULED`);
  assert.ok(cal.data.publications.length >= 2);
  assert.ok(cal.data.publications.every(p => p.status === 'SCHEDULED' && p.scheduledAt >= from));
});

test('campaigns: managers create them; stats count publications by type', async () => {
  assert.equal((await mateus.post('/campaigns/workspace/ws-1', { name: 'Não pode' })).status, 403);
  const c = await ana.post('/campaigns/workspace/ws-1', { name: 'Black Friday 2026', client: 'Cliente ABC', status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30', projectId: 'proj-1', socialAccountId: state.account.id });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  state.campaign = c.data.campaign;
  assert.equal((await ana.post('/campaigns/workspace/ws-1', { name: 'Datas', startDate: '2026-12-01', endDate: '2026-11-01' })).status, 400);
  await mateus.patch(`/publications/${state.scheduledA.id}`, { campaignId: c.data.campaign.id });
  const list = await mateus.get('/campaigns/workspace/ws-1');
  const stats = list.data.campaigns.find(x => x.id === c.data.campaign.id).stats;
  assert.equal(stats.publications, 1);
  assert.equal(stats.byType.POST, 1);
});

test('bulk: approvals require confirmation and are recorded per item', async () => {
  const p1 = await newPublication(mateus, { socialAccountId: state.account.id, type: 'POST', title: 'Lote 1', media: [state.image.id] });
  const p2 = await newPublication(mateus, { socialAccountId: state.account.id, type: 'POST', title: 'Lote 2', media: [state.image2.id] });
  await mateus.post(`/publications/${p1.id}/submit`);
  await mateus.post(`/publications/${p2.id}/submit`);
  assert.equal((await mateus.post('/publications/workspace/ws-1/bulk', { action: 'APPROVE', ids: [p1.id, p2.id], confirm: true })).status, 403);
  const ask = await ana.post('/publications/workspace/ws-1/bulk', { action: 'APPROVE', ids: [p1.id, p2.id] });
  assert.equal(ask.data.code, 'REQUIRES_CONFIRMATION');
  const done = await ana.post('/publications/workspace/ws-1/bulk', { action: 'APPROVE', ids: [p1.id, p2.id, state.published.id], confirm: true });
  assert.equal(done.data.count, 2);
  assert.equal(done.data.results.find(r => r.id === state.published.id).ok, false);
  const moved = await mateus.post('/publications/workspace/ws-1/bulk', { action: 'MOVE_CAMPAIGN', ids: [p1.id], value: state.campaign.id });
  assert.equal(moved.data.count, 1);
});

test('duplicate creates a new draft entity with new options', async () => {
  const when = new Date(Date.now() + 9 * 86400000).toISOString();
  const dup = await mateus.post(`/publications/${state.published.id}/duplicate`, { scheduledAt: when, campaignId: state.campaign.id });
  assert.equal(dup.status, 201);
  assert.notEqual(dup.data.publication.id, state.published.id);
  assert.equal(dup.data.publication.status, 'DRAFT');
  assert.equal(dup.data.publication.externalId, null);
  assert.equal(dup.data.publication.scheduledAt, when);
  assert.equal(dup.data.publication.campaignId, state.campaign.id);
});

test('tasks & automations: approval creates a linked task in the project', async () => {
  const rule = await ana.post('/automations/workspace/ws-1', {
    title: 'Aprovou → tarefa de publicação',
    definition: { trigger: { type: 'publication.approved' }, conditions: [{ field: 'publicationType', op: 'eq', value: 'POST' }], actions: [{ type: 'create_task', value: 'Acompanhar publicação: {titulo}' }, { type: 'notify', target: 'creator' }] }
  });
  assert.equal(rule.status, 201, JSON.stringify(rule.data));
  const bad = await ana.post('/automations/workspace/ws-1', { title: 'Inválida', definition: { trigger: { type: 'publication.failed' }, conditions: [], actions: [{ type: 'set_priority', value: 'High' }] } });
  assert.equal(bad.status, 400, 'task-only actions are not accepted for publication triggers');
  const pub = await newPublication(mateus, { socialAccountId: state.account.id, type: 'POST', title: 'Com projeto', media: [state.image.id], projectId: 'proj-1' });
  await mateus.post(`/publications/${pub.id}/submit`);
  const ok = await ana.post(`/publications/${pub.id}/approve`);
  const linked = ok.data.publication.taskId;
  assert.match(linked, /^TSK-/);
  const task = await ana.get(`/tasks/${linked}`);
  assert.equal(task.data.task.title, 'Acompanhar publicação: Com projeto');
  const byTask = await ana.get(`/publications/by-task/${linked}`);
  assert.deepEqual(byTask.data.publications.map(p => p.id), [pub.id]);
});

test('search finds campaigns and publications only in allowed workspaces', async () => {
  const r = await mateus.get('/search?q=black');
  assert.ok(r.data.campaigns.some(c => c.name === 'Black Friday 2026'));
  assert.ok(r.data.publications.some(p => p.title === 'Black Friday — Post 04'));
  assert.ok(r.data.creatives.some(c => c.name === 'black-friday-04.jpg'));
  const secret = await mateus.get('/search?q=ws2-secret');
  assert.equal(secret.data.creatives.length, 0, 'ws-2 creatives are invisible to non-members');
});

test('cancel, reopen and delete follow the lifecycle', async () => {
  const id = state.scheduledA.id;
  assert.equal((await ana.del(`/publications/${id}`)).status, 409, 'scheduled must be cancelled first');
  assert.equal((await mateus.post(`/publications/${id}/cancel`)).status, 403, 'cancelling a scheduled post needs publish permission');
  const cancelled = await ana.post(`/publications/${id}/cancel`);
  assert.equal(cancelled.data.publication.status, 'CANCELLED');
  assert.equal((await ana.patch(`/publications/${id}`, { caption: 'x' })).status, 409);
  assert.equal((await ana.post(`/publications/${id}/reopen`)).data.publication.status, 'DRAFT');
  assert.equal((await ana.del(`/publications/${id}`)).status, 200);
  assert.equal((await ana.get(`/publications/${id}`)).status, 404);
});

test('creatives in use cannot be deleted; unused ones can', async () => {
  const del = await ana.del(`/creatives/${state.image.id}`);
  assert.equal(del.status, 409);
  assert.ok(del.data.details.publications.length > 0);
  assert.equal((await mateus.del(`/creatives/${state.png.id}`)).status, 200, 'own unused creative');
  assert.equal((await mateus.get(`/creatives/${state.png.id}`)).status, 404);
});

test('disconnect deletes the token and blocks publishing until reconnection', async () => {
  const pub = await approved({ socialAccountId: state.accountB.id, type: 'POST', title: 'Conta B', media: [state.image.id], scheduledAt: new Date(Date.now() + 86400000).toISOString() });
  await ana.post(`/publications/${pub.id}/schedule`);
  assert.equal((await mateus.del(`/social/accounts/${state.accountB.id}`)).status, 403);
  const r = await ana.del(`/social/accounts/${state.accountB.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.scheduledAffected, 1);
  const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'taskly_db.json'), 'utf8'));
  assert.equal(db.socialCredentials.filter(c => c.accountId === state.accountB.id).length, 0, 'token deleted');
  assert.equal(db.socialMedia.filter(m => m.accountId === state.accountB.id).length, 0, 'synced posts deleted');
  const pub2 = await approved({ socialAccountId: state.account.id, type: 'POST', title: 'x', media: [state.image.id] });
  assert.equal((await ana.patch(`/publications/${pub2.id}`, { socialAccountId: state.accountB.id, confirmReset: true })).status, 400, 'disconnected account cannot be chosen');
  const audit = db.auditLogs.filter(l => l.category === 'creatives').map(l => l.action);
  ['SOCIAL_ACCOUNT_CONNECTED', 'SOCIAL_ACCOUNT_DISCONNECTED', 'CREATIVE_CREATED', 'PUBLICATION_APPROVED', 'PUBLICATION_REJECTED', 'PUBLICATION_SCHEDULED', 'PUBLICATION_RESCHEDULED', 'PUBLICATION_PUBLISHED', 'PUBLICATION_FAILED', 'PUBLICATION_CANCELLED', 'CAMPAIGN_CREATED']
    .forEach(a => assert.ok(audit.includes(a), `audit log has ${a}`));
  assert.ok(!JSON.stringify(db.auditLogs).includes('IGlongtoken'), 'no token in audit log');
});
