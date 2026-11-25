import { env } from '../config/env';
import { log } from '../lib/logger';
import { runScheduledPass } from '../modules/leetcode/leetcode-sync.service';
import { hasEligibleProvider } from '../modules/leetcode/provider-manager';

/** Ticks every minute; the policy decides who is due. Does nothing unless sync is enabled and a provider exists. */
export function startLeetcodeSyncJob() {
  if (!env.LEETCODE_SYNC_ENABLED) { log.info('leetcode sync disabled (LEETCODE_SYNC_ENABLED=false)'); return () => {}; }
  if (!env.LEETCODE_SCHEDULER_ENABLED) { log.info('leetcode scheduler disabled in this process'); return () => {}; }

  let running = false;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try { if (await hasEligibleProvider()) await runScheduledPass(); } catch (e) { log.error('leetcode scheduler pass failed', { error: e }); } finally { running = false; }
  }, 60_000);
  return () => clearInterval(t);
}
