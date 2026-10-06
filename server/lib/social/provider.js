// Social network integrations behind one contract. The scheduler, routes and
// UI only talk to `SocialPublishingProvider`; each network implements it with
// its own official API. Adding Facebook, LinkedIn or TikTok later means adding
// a provider here, not changing the publication core.

/**
 * Error raised by providers. `kind` drives what Taskly does next:
 *   AUTH        token expired or revoked   → account needs reconnection
 *   PERMISSION  missing app permission      → check the app / account setup
 *   MEDIA       media rejected by the API   → edit the publication
 *   INVALID     invalid request data        → edit the publication
 *   RATE_LIMIT  quota / throttling          → retry later
 *   TRANSIENT   network / 5xx / not ready   → retry later
 *   UNKNOWN     anything else               → retry a limited number of times
 * The message is already sanitized (no tokens, no secrets).
 */
export class ProviderError extends Error {
  constructor(kind, message, { retryable, providerCode = null, subcode = null, httpStatus = null } = {}) {
    super(message);
    this.kind = kind;
    this.retryable = retryable ?? ['RATE_LIMIT', 'TRANSIENT', 'UNKNOWN'].includes(kind);
    this.providerCode = providerCode;
    this.subcode = subcode;
    this.httpStatus = httpStatus;
  }
}

export const NEXT_ACTION = {
  AUTH: { code: 'RECONNECT', label: 'Reconectar conta' },
  PERMISSION: { code: 'CHECK_PERMISSIONS', label: 'Verificar permissões do app na Meta' },
  MEDIA: { code: 'EDIT', label: 'Editar publicação' },
  INVALID: { code: 'EDIT', label: 'Editar publicação' },
  RATE_LIMIT: { code: 'WAIT', label: 'Aguardar e tentar novamente' },
  TRANSIENT: { code: 'RETRY', label: 'Tentar novamente' },
  UNKNOWN: { code: 'RETRY', label: 'Tentar novamente' },
  ACCOUNT: { code: 'RECONNECT', label: 'Reconectar conta' }
};

/* eslint-disable no-unused-vars */
export class SocialPublishingProvider {
  /** @returns {string} stable id stored on accounts ("instagram") */
  get id() { throw new Error('not implemented'); }
  get label() { return this.id; }
  /** Whether the app credentials for this network are configured. */
  isConfigured() { return false; }
  /** Environment variables an operator must set (names only). */
  requiredConfig() { return []; }
  authorizationUrl({ state, redirectUri }) { throw new Error('not implemented'); }
  /** @returns {Promise<{accessToken, expiresAt, providerAccountId, scopes: string[]}>} */
  async exchangeCode({ code, redirectUri }) { throw new Error('not implemented'); }
  /** @returns {Promise<{accessToken, expiresAt}>} */
  async refreshToken(accessToken) { throw new Error('not implemented'); }
  /** @returns {Promise<{username, name, avatarUrl, accountType, mediaCount, followersCount}>} */
  async fetchProfile(accessToken) { throw new Error('not implemented'); }
  /** Capabilities derived from the granted scopes and account type. */
  capabilities({ scopes, accountType }) { return {}; }
  /** @returns {Promise<Array<{externalId, mediaType, caption, permalink, timestamp, previewUrl}>>} */
  async fetchRecentMedia(accessToken, accountId, limit) { return []; }
  /** @returns {Promise<{used, total}|null>} */
  async publishingQuota(accessToken, accountId) { return null; }
  /** Creates the upload container(s). @returns {Promise<{containerId, childIds}>} */
  async createContainer(accessToken, accountId, payload) { throw new Error('not implemented'); }
  /** @returns {Promise<{status: 'IN_PROGRESS'|'FINISHED'|'PUBLISHED'|'ERROR'|'EXPIRED', detail?}>} */
  async containerStatus(accessToken, containerId) { throw new Error('not implemented'); }
  /** Publishes a finished container. @returns {Promise<{externalId}>} */
  async publishContainer(accessToken, accountId, containerId) { throw new Error('not implemented'); }
  /** @returns {Promise<{permalink, timestamp}>} */
  async mediaDetails(accessToken, externalId) { return {}; }
  /** Looks for an already published media (crash recovery). @returns {Promise<{externalId, permalink, timestamp}|null>} */
  async findPublished(accessToken, accountId, { caption, since }) { return null; }
}
/* eslint-enable no-unused-vars */

const registry = new Map();
export function registerProvider(provider) { registry.set(provider.id, provider); }
export function getProvider(id) {
  const provider = registry.get(id);
  if (!provider) throw new ProviderError('INVALID', `Rede social não suportada: ${id}`, { retryable: false });
  return provider;
}
export const listProviders = () => [...registry.values()];
