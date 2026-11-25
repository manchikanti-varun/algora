import mongoose from 'mongoose';
import { createApp, readiness } from './app';
import { log } from './lib/logger';
import { env } from './config/env';
import { supportsTransactions } from './lib/lease';
import { syncAllIndexes } from './models';
import { startLeetcodeSyncJob } from './jobs/leetcode-sync.job';
import { reconcileSuperAdmin } from './modules/auth/superAdmin';

process.on('unhandledRejection', (reason) => { log.error('unhandled promise rejection', { error: reason }); });
process.on('uncaughtException', (err) => { log.error('uncaught exception, exiting', { error: err }); process.exit(1); });

async function main() {
  await mongoose.connect(env.MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 });
  mongoose.connection.on('disconnected', () => log.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => log.warn('mongo reconnected'));
  mongoose.connection.on('error', (e) => log.error('mongo error', { error: e }));
  await syncAllIndexes();
  const revoked = await reconcileSuperAdmin();
  if (revoked) log.warn('revoked former Super Admin account(s): SUPER_ADMIN_EMAIL changed', { revoked });
  const server = createApp().listen(env.PORT, () => log.info(`algora-backend listening on :${env.PORT}`, { env: env.NODE_ENV, port: env.PORT }));
  server.keepAliveTimeout = 65_000; // above common proxy idle timeouts
  server.headersTimeout = 66_000;
  // Fenced writes need transactions. Atlas always has them; a standalone mongod does not.
  if (env.LEETCODE_SYNC_ENABLED && !(await supportsTransactions())) {
    if (env.isProd) throw new Error('LEETCODE_SYNC_ENABLED requires a MongoDB replica set (transactions). Use Atlas or a replica set.');
    log.warn('MongoDB has no transaction support: fencing is best-effort (development only)');
  }
  const stopSync = startLeetcodeSyncJob();
  readiness.startupDone = true;
  log.info('startup complete', { syncEnabled: env.LEETCODE_SYNC_ENABLED, scheduler: env.LEETCODE_SCHEDULER_ENABLED });
  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return; stopping = true;
    log.info('shutdown: draining', { signal: sig });
    stopSync(); // no new passes; in-flight syncs finish and release their leases, or the leases simply expire
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 15_000).unref(); // hard stop if connections do not drain
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
main().catch((e) => { log.error('startup failed', { error: e }); process.exit(1); });
