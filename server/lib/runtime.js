// Runtime facts shared by the Node server and the Cloudflare Worker.
// The Worker entrypoint calls configureRuntime() with its bindings; shared
// code never imports `cloudflare:*` modules directly, so it still runs on Node.

export const IS_WORKER = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

const state = { env: null, waitUntil: null, detached: null };

export function configureRuntime({ env, waitUntil, detached }) {
  state.env = env;
  state.waitUntil = waitUntil;
  state.detached = detached;
}

// Cloudflare bindings (D1, R2…). Null on Node.
export const bindings = () => state.env;

// Keeps work alive after the response (webhook deliveries, e-mails).
// On Node the promise simply runs on the event loop.
export function background(promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (IS_WORKER && state.waitUntil) state.waitUntil(p);
  return p;
}

// Runs `fn` after the response with its own database context, so the
// changes it makes (e.g. webhook delivery logs) are persisted on their own.
// On the Worker the request's data was already written when `fn` runs.
export function detached(fn) {
  if (IS_WORKER && state.detached) return state.detached(fn);
  return Promise.resolve().then(fn).catch(() => {});
}
