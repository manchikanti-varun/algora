import { env, leetcodeConfigIssues } from '../../config/env';
import { supportsTransactions } from '../../lib/lease';
import { log } from '../../lib/logger';
import { authorizationFor, blockIntegration, providerConfigurationReason, providerRequested, registry } from './providers/provider.registry';

export async function initializeLeetcodeIntegration() {
  const requested = registry().filter((provider) => providerRequested(provider.id));
  if (env.isProd && env.LEETCODE_PROVIDER_PRIORITY.includes('mock')) log.warn('LeetCode fixture provider ignored in production');
  if (env.isProd && env.LEETCODE_PROVIDER_PRIORITY.includes('mock')) log.warn('LeetCode fixture priority ignored in production');
  for (const [key, reason] of Object.entries(leetcodeConfigIssues)) log.warn('invalid optional LeetCode setting', { key, reason });
  if (!env.LEETCODE_SYNC_ENABLED) return;
  if (requested.some((provider) => !providerConfigurationReason(provider.id) && authorizationFor(provider.id).authorized) &&
    !(await supportsTransactions())) {
    if (env.isProd) blockIntegration('MongoDB transactions are unavailable. LeetCode synchronization requires a replica set.');
    else log.warn('MongoDB has no transaction support: fencing is best-effort (development only)');
  }
  for (const provider of requested) {
    const status = authorizationFor(provider.id);
    const reason = providerConfigurationReason(provider.id) ?? status.reason;
    if (reason) log.warn('LeetCode provider inactive', { provider: provider.id, reason });
  }
}
