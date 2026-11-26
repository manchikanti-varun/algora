import { env, leetcodeConfigIssues } from '../config/env';
import { log } from '../lib/logger';
import { providerEnvEnabled, registry } from '../modules/leetcode/providers/provider.registry';
import { hasEligibleProvider } from '../modules/leetcode/provider-manager';
import { schedulerTick, workerStep } from '../modules/leetcode/sync-queue';
/**
 * Background synchronization. Two cooperating loops that talk only through MongoDB (so any number of instances is safe):
 *  - scheduler (every 60 s, under a lease): enqueues students whose automatic sync is due, recovers crashed jobs, cancels stale ones;
 *  - worker (every 2 s): claims queued jobs and runs them within the shared upstream budget and concurrency.
 * Nothing runs unless sync is enabled and at least one provider is both enabled and authorised (fail closed).
 * Returns a stop function that stops claiming and resolves once in-flight jobs finish (or the caller's timeout fires).
 */
export function startLeetcodeSyncJob(): () => Promise<void> {
  const noop = async () => {};
  if (!env.LEETCODE_SYNC_ENABLED) { log.info('leetcode sync disabled (LEETCODE_SYNC_ENABLED=false)'); return noop; }
  if (!env.LEETCODE_SCHEDULER_ENABLED || leetcodeConfigIssues.LEETCODE_SCHEDULER_ENABLED) { log.info('leetcode scheduler disabled in this process'); return noop; }
  // Start whenever a provider is configured and activated, even if an admin has disabled it right now: re-enabling it in the
  // dashboard must not require a restart. Every tick re-checks enablement and pause, so nothing is contacted while inactive.
  if (!registry().some((provider) => providerEnvEnabled(provider.id) && provider.authorization().authorized)) {
    log.info('LeetCode scheduler inactive because no provider can be activated');
    return noop;
  }
  const inFlight = new Set<Promise<unknown>>();
  let stopping = false, ticking = false, working = false;
  const tick = setInterval(async () => {
    if (ticking || stopping) return;
    ticking = true;
    try { if (await hasEligibleProvider()) await schedulerTick(); } catch (e) { log.error('leetcode scheduler tick failed', { error: e }); } finally { ticking = false; }
  }, 60_000);
  const work = setInterval(async () => {
    if (working || stopping) return;
    working = true;
    try { await workerStep(inFlight); } catch (e) { log.error('leetcode worker step failed', { error: e }); } finally { working = false; }
  }, 2_000);
  tick.unref(); work.unref();
  return async () => { stopping = true; clearInterval(tick); clearInterval(work); await Promise.allSettled([...inFlight]); };
}
