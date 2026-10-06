// Instagram via the official Instagram Platform ("Instagram API with Instagram
// Login", graph.instagram.com). No passwords, no scraping, no private
// endpoints: the account owner authorizes Taskly through Meta's OAuth screen
// and publishing goes through the documented two-step container flow:
//   POST /<IG_ID>/media  →  GET /<container>?fields=status_code  →  POST /<IG_ID>/media_publish
import { ProviderError, SocialPublishingProvider, registerProvider } from './provider.js';

const isProd = () => process.env.NODE_ENV === 'production';
// Endpoints can be pointed at a local stub only outside production (tests).
const endpoint = (name, fallback) => (!isProd() && process.env[name]) || fallback;
const GRAPH = () => endpoint('INSTAGRAM_GRAPH_URL', 'https://graph.instagram.com');
const AUTHORIZE = () => endpoint('INSTAGRAM_AUTHORIZE_URL', 'https://www.instagram.com/oauth/authorize');
const TOKEN = () => endpoint('INSTAGRAM_TOKEN_URL', 'https://api.instagram.com/oauth/access_token');
const VERSION = () => process.env.INSTAGRAM_API_VERSION || 'v25.0';
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const TIMEOUT_MS = 15000;

// Removes anything that could be a credential before a message is stored or shown.
function sanitize(text) {
  return String(text || '')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[removido]')
    .replace(/client_secret=[^&\s]+/gi, 'client_secret=[removido]')
    .replace(/\b(IG|EAA)[A-Za-z0-9_-]{20,}\b/g, '[token removido]')
    .replace(/[A-Za-z0-9_-]{60,}/g, '[removido]')
    .slice(0, 300);
}

// Maps Graph API errors (https://developers.facebook.com/docs/graph-api/guides/error-handling)
function toProviderError(status, body) {
  const e = body?.error || {};
  const code = Number(e.code) || null;
  const subcode = Number(e.error_subcode) || null;
  const message = sanitize(e.error_user_msg || e.message || `HTTP ${status}`);
  const meta = { providerCode: code, subcode, httpStatus: status };
  if (code === 190 || e.type === 'OAuthException' && status === 401) return new ProviderError('AUTH', 'A autorização do Instagram expirou ou foi revogada. Reconecte a conta.', meta);
  if (code === 10 || (code >= 200 && code <= 299)) return new ProviderError('PERMISSION', `Permissão ausente na Meta: ${message}`, meta);
  if ([4, 17, 32, 613].includes(code) || subcode === 2207042) return new ProviderError('RATE_LIMIT', `Limite da API do Instagram atingido: ${message}`, meta);
  if ([1, 2].includes(code) || code === 9007 || subcode === 2207027 || status >= 500) return new ProviderError('TRANSIENT', `Instabilidade temporária na API do Instagram: ${message}`, meta);
  if (code === 36003 || code === 36000 || code === 36001 || (subcode && String(subcode).startsWith('2207'))) return new ProviderError('MEDIA', `Mídia recusada pelo Instagram: ${message}`, { ...meta, retryable: false });
  if (code === 100) return new ProviderError('INVALID', `Dados recusados pelo Instagram: ${message}`, { ...meta, retryable: false });
  return new ProviderError('UNKNOWN', message, meta);
}

async function call(url, { method = 'GET', form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: form ? new URLSearchParams(form).toString() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    // A timeout is ambiguous for writes: the caller decides how to verify.
    throw new ProviderError('TRANSIENT', err.name === 'TimeoutError' ? 'Tempo esgotado ao falar com o Instagram' : 'Não foi possível conectar ao Instagram', { retryable: true });
  }
  if (res.status >= 300 && res.status < 400) throw new ProviderError('UNKNOWN', 'Redirecionamento inesperado da API do Instagram');
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || body?.error) throw toProviderError(res.status, body);
  return body;
}

const q = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
const graph = (path, params) => `${GRAPH()}/${VERSION()}/${path}${params ? `?${q(params)}` : ''}`;

class InstagramProvider extends SocialPublishingProvider {
  get id() { return 'instagram'; }
  get label() { return 'Instagram'; }

  isConfigured() { return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET); }
  requiredConfig() { return ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']; }

  authorizationUrl({ state, redirectUri }) {
    return `${AUTHORIZE()}?${q({ client_id: process.env.INSTAGRAM_APP_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(','), state, enable_fb_login: 'false' })}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const short = await call(TOKEN(), {
      method: 'POST',
      form: { client_id: process.env.INSTAGRAM_APP_ID, client_secret: process.env.INSTAGRAM_APP_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri, code }
    });
    const data = Array.isArray(short?.data) ? short.data[0] : short;
    if (!data?.access_token || !data?.user_id) throw new ProviderError('UNKNOWN', 'Resposta inesperada da Meta ao concluir a autorização', { retryable: false });
    const scopes = String(data.permissions || '').split(',').map(s => s.trim()).filter(Boolean);
    // Short-lived tokens last 1 hour; exchange for a long-lived one (60 days).
    const long = await call(`${GRAPH()}/access_token?${q({ grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET, access_token: data.access_token })}`);
    if (!long?.access_token) throw new ProviderError('UNKNOWN', 'A Meta não devolveu um token de longa duração', { retryable: false });
    return {
      accessToken: long.access_token,
      expiresAt: new Date(Date.now() + Number(long.expires_in || 5184000) * 1000).toISOString(),
      providerAccountId: String(data.user_id),
      scopes
    };
  }

  async refreshToken(accessToken) {
    const res = await call(`${GRAPH()}/refresh_access_token?${q({ grant_type: 'ig_refresh_token', access_token: accessToken })}`);
    if (!res?.access_token) throw new ProviderError('UNKNOWN', 'A Meta não devolveu o token renovado', { retryable: true });
    return { accessToken: res.access_token, expiresAt: new Date(Date.now() + Number(res.expires_in || 5184000) * 1000).toISOString() };
  }

  async fetchProfile(accessToken) {
    const p = await call(graph('me', { fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,media_count', access_token: accessToken }));
    return {
      providerAccountId: String(p.user_id || p.id),
      username: p.username,
      name: p.name || p.username,
      accountType: p.account_type || null,
      avatarUrl: p.profile_picture_url || null,
      // Only numbers the API actually returned; never estimated.
      followersCount: Number.isFinite(p.followers_count) ? p.followers_count : null,
      mediaCount: Number.isFinite(p.media_count) ? p.media_count : null
    };
  }

  capabilities({ scopes }) {
    const publish = scopes.includes('instagram_business_content_publish');
    return { canPublishPost: publish, canPublishCarousel: publish, canPublishReel: publish, canPublishStory: publish, canReadMedia: scopes.includes('instagram_business_basic') };
  }

  async fetchRecentMedia(accessToken, accountId, limit = 24) {
    const res = await call(graph(`${accountId}/media`, { fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp', limit, access_token: accessToken }));
    return (res?.data || []).map(m => ({
      externalId: String(m.id),
      mediaType: m.media_product_type === 'REELS' ? 'REEL' : m.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : m.media_type === 'VIDEO' ? 'VIDEO' : 'POST',
      caption: m.caption || '',
      permalink: m.permalink || null,
      timestamp: m.timestamp,
      previewUrl: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null
    }));
  }

  async publishingQuota(accessToken, accountId) {
    const res = await call(graph(`${accountId}/content_publishing_limit`, { fields: 'quota_usage,config', access_token: accessToken }));
    const row = res?.data?.[0];
    if (!row) return null;
    return { used: Number(row.quota_usage || 0), total: Number(row.config?.quota_total || 100) };
  }

  async #container(accessToken, accountId, params) {
    const res = await call(graph(`${accountId}/media`), { method: 'POST', form: { ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')), access_token: accessToken } });
    if (!res?.id) throw new ProviderError('UNKNOWN', 'A Meta não devolveu o identificador do container');
    return String(res.id);
  }

  /**
   * payload: { type, caption, locationId, items: [{ kind, url }], coverUrl, shareToFeed, childIds? }
   * Carousels are created item by item; the parent is only created once every
   * child container is FINISHED (videos take time to process).
   */
  async createContainer(accessToken, accountId, payload) {
    const { type, caption, locationId, items, coverUrl, shareToFeed } = payload;
    if (type === 'POST') return { containerId: await this.#container(accessToken, accountId, { image_url: items[0].url, caption, location_id: locationId }), childIds: [] };
    if (type === 'REEL') return { containerId: await this.#container(accessToken, accountId, { media_type: 'REELS', video_url: items[0].url, caption, cover_url: coverUrl, share_to_feed: shareToFeed === false ? 'false' : 'true', location_id: locationId }), childIds: [] };
    if (type === 'STORY') {
      const media = items[0].kind === 'video' ? { video_url: items[0].url } : { image_url: items[0].url };
      return { containerId: await this.#container(accessToken, accountId, { media_type: 'STORIES', ...media }), childIds: [] };
    }
    if (type === 'CAROUSEL') {
      const childIds = payload.childIds?.length ? payload.childIds : [];
      if (!childIds.length) {
        for (const item of items) {
          childIds.push(await this.#container(accessToken, accountId, item.kind === 'video'
            ? { media_type: 'VIDEO', video_url: item.url, is_carousel_item: 'true' }
            : { image_url: item.url, is_carousel_item: 'true' }));
        }
      }
      return { containerId: null, childIds };
    }
    throw new ProviderError('INVALID', 'Tipo de publicação não suportado', { retryable: false });
  }

  async createCarouselParent(accessToken, accountId, { childIds, caption, locationId }) {
    return this.#container(accessToken, accountId, { media_type: 'CAROUSEL', children: childIds.join(','), caption, location_id: locationId });
  }

  async containerStatus(accessToken, containerId) {
    const res = await call(graph(containerId, { fields: 'status_code,status', access_token: accessToken }));
    return { status: res?.status_code || 'IN_PROGRESS', detail: sanitize(res?.status || '') };
  }

  async publishContainer(accessToken, accountId, containerId) {
    const res = await call(graph(`${accountId}/media_publish`), { method: 'POST', form: { creation_id: containerId, access_token: accessToken } });
    if (!res?.id) throw new ProviderError('UNKNOWN', 'A Meta não confirmou a publicação');
    return { externalId: String(res.id) };
  }

  async mediaDetails(accessToken, externalId) {
    const res = await call(graph(externalId, { fields: 'permalink,timestamp', access_token: accessToken }));
    return { permalink: res?.permalink || null, timestamp: res?.timestamp || null };
  }

  async findPublished(accessToken, accountId, { caption, since }) {
    const recent = await this.fetchRecentMedia(accessToken, accountId, 10);
    const sinceMs = Date.parse(since) - 120000;
    const match = recent.find(m => Date.parse(m.timestamp) >= sinceMs && (m.caption || '').trim() === (caption || '').trim());
    return match ? { externalId: match.externalId, permalink: match.permalink, timestamp: match.timestamp } : null;
  }
}

export const instagram = new InstagramProvider();
registerProvider(instagram);
