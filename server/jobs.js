// Periodic maintenance. On Node these run on timers (server/index.js); on
// Cloudflare they run from a Cron Trigger (worker/index.js `scheduled`).
import { purgeExpiredSessions } from './middleware/auth.js';
import { scanDeadlines } from './lib/events.js';
import { runRetention } from './lib/retention.js';
import { log } from './lib/observability.js';

const safely = (name, fn) => { try { fn(); } catch (err) { log('error', `${name} failed`, { error: err.message }); } };

export function runHourlyJobs() {
  safely('session purge', purgeExpiredSessions);
  safely('deadline scan', scanDeadlines);
}

export function runDailyJobs() {
  safely('retention', runRetention);
}
