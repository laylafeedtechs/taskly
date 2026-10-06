// Periodic maintenance. On Node these run on timers (server/index.js); on
// Cloudflare they run from a Cron Trigger (worker/index.js `scheduled`).
import { purgeExpiredSessions } from './middleware/auth.js';
import { scanDeadlines } from './lib/events.js';
import { runRetention } from './lib/retention.js';
import { log } from './lib/observability.js';
import { db } from './db.js';
import { transact } from './lib/runtime.js';
import { runPublicationScheduler } from './lib/social/scheduler.js';
import { refreshExpiringTokens, syncAccount } from './lib/social/accounts.js';

const safely = (name, fn) => { try { fn(); } catch (err) { log('error', `${name} failed`, { error: err.message }); } };

export function runHourlyJobs() {
  safely('session purge', purgeExpiredSessions);
  safely('deadline scan', scanDeadlines);
}

export function runDailyJobs() {
  safely('retention', runRetention);
}

const safelyAsync = async (name, fn) => { try { return await fn(); } catch (err) { log('error', `${name} failed`, { error: err.message }); return null; } };

// Every minute: publications due now are sent by the backend worker.
export function runPublicationTick() {
  return safelyAsync('publication scheduler', () => runPublicationScheduler());
}

// Daily: renew Instagram tokens close to expiry and refresh profile/recent posts.
export async function runSocialDailyJobs() {
  await safelyAsync('social token refresh', refreshExpiringTokens);
  const ids = await transact(() => db.filter('socialAccounts', a => a.status === 'CONNECTED').map(a => a.id));
  for (const id of ids) await safelyAsync('social sync', () => syncAccount(id));
}
