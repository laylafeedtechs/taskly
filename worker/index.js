// Cloudflare Worker entrypoint.
//
//   Request ─► Cloudflare ─┬─ /api/*  ─► this Worker ─► httpServerHandler ─► Express (server/app.js) ─► D1
//                          └─ other   ─► Static Assets (dist/, SPA fallback)
//
// `run_worker_first: ["/api/*"]` in wrangler.jsonc sends every API request
// (any method) here. Without a Worker, POST requests reached the static
// asset server, which only answers GET/HEAD — the cause of the 405 on login.
import { env, waitUntil } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';

import { configureRuntime, background } from '../server/lib/runtime.js';
import { createApp } from '../server/app.js';
import { d1Middleware, withD1Store } from '../server/lib/d1store.js';
import { runHourlyJobs, runDailyJobs } from '../server/jobs.js';
import { log } from '../server/lib/observability.js';

configureRuntime({
  env,
  waitUntil,
  // Post-response work gets its own D1 context (and its own atomic write).
  detached: fn => background(withD1Store(env.DB, fn))
});

const app = createApp({ beforeApi: [d1Middleware(() => env.DB)] });

// The port is internal to the isolate; httpServerHandler bridges fetch() to it.
const PORT = 3000;
app.listen(PORT);
const http = httpServerHandler({ port: PORT });

export default {
  fetch(request, workerEnv, ctx) {
    return http.fetch(request, workerEnv, ctx);
  },

  // Cron Trigger (see "triggers" in wrangler.jsonc): replaces the Node timers.
  async scheduled(controller, workerEnv, ctx) {
    const daily = new Date(controller.scheduledTime).getUTCHours() === 3;
    ctx.waitUntil(withD1Store(env.DB, () => {
      runHourlyJobs();
      if (daily) runDailyJobs();
    }).catch(err => log('error', 'scheduled jobs failed', { error: err.message })));
  }
};
