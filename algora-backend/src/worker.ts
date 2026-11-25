/**
 * Optional standalone sync worker (same repo, same code). Use it when the API runs more than one replica: set
 * LEETCODE_SCHEDULER_ENABLED=false on the API service and run `npm run start:worker` as a second Railway service.
 * Not required for one API instance: leases already make concurrent schedulers safe; this only avoids redundant ticks.
 */
import mongoose from 'mongoose';
import { env } from './config/env';
import { startLeetcodeSyncJob } from './jobs/leetcode-sync.job';
import { supportsTransactions } from './lib/lease';
import { log } from './lib/logger';

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 });
  if (env.LEETCODE_SYNC_ENABLED && !(await supportsTransactions()) && env.isProd) throw new Error('Sync requires a MongoDB replica set (transactions).');
  const stop = startLeetcodeSyncJob();
  log.info('algora sync worker running');
  const shutdown = () => { stop(); mongoose.disconnect().finally(() => process.exit(0)); setTimeout(() => process.exit(1), 15_000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((e) => { log.error('worker startup failed', { error: e }); process.exit(1); });
