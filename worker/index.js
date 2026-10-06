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
import { runHourlyJobs, runDailyJobs, runPublicationTick, runSocialDailyJobs } from '../server/jobs.js';
import { log } from '../server/lib/observability.js';

configureRuntime({
  env,
  waitUntil,
  // Post-response work gets its own D1 context (and its own atomic write).
  detached: fn => background(withD1Store(env.DB, fn)),
  // Short transactions for the publication scheduler and background jobs.
  transact: fn => withD1Store(env.DB, fn)
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

  // Cron Trigger, every minute (see "triggers" in wrangler.jsonc): replaces
  // the Node timers. The publication scheduler runs on every tick; hourly and
  // daily maintenance run on the matching minute.
  async scheduled(controller, workerEnv, ctx) {
    const at = new Date(controller.scheduledTime);
    const hourly = at.getUTCMinutes() === 0;
    const daily = hourly && at.getUTCHours() === 3;
    ctx.waitUntil((async () => {
      await runPublicationTick();
      if (hourly) {
        await withD1Store(env.DB, () => {
          runHourlyJobs();
          if (daily) runDailyJobs();
        }).catch(err => log('error', 'scheduled jobs failed', { error: err.message }));
      }
      if (daily) await runSocialDailyJobs();
    })());
  }
};
