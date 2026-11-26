import { LeetcodeSyncJob, User } from '../../models';
import { eligibleStudents } from './sync-queue';
/** A queued job that has waited this long past the time it could first run is reported as delayed. */
export const DELAY_THRESHOLD_MS = 2 * 60_000;
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

/** Status shown to people. Job state (database-backed) wins over the last stored outcome while a job is active. */
export function displayStatus(job: { status: string; runAfter: Date; dueAt: Date; attempts?: number } | null | undefined, stored: string | undefined, now: Date) {
  if (job?.status === 'RUNNING') return 'UPDATING';
  // A job waiting for a retry keeps showing why (provider unavailable, rate limited); it is retried automatically.
  if (job?.status === 'QUEUED' && (job.attempts ?? 0) > 0 && (stored === 'PROVIDER_UNAVAILABLE' || stored === 'RATE_LIMITED' || stored === 'SYNC_FAILED')) return stored;
  if (job?.status === 'QUEUED') return now.getTime() - job.runAfter.getTime() > DELAY_THRESHOLD_MS ? 'DELAYED' : 'QUEUED';
  return stored ?? 'IDLE';
}

/** Operational queue numbers for the Super Admin dashboard. Everything is read from MongoDB (all instances). */
export async function queueMetrics(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000), hourAgo = new Date(now.getTime() - 3600_000);
  const [byStatus, retryBacklog, oldest, finished, gaps, eligible] = await Promise.all([
    LeetcodeSyncJob.aggregate([{ $match: { $or: [{ status: { $in: ['QUEUED', 'RUNNING'] } }, { finishedAt: { $gte: dayAgo } }] } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    LeetcodeSyncJob.countDocuments({ status: 'QUEUED', attempts: { $gt: 0 } }),
    LeetcodeSyncJob.findOne({ status: 'QUEUED' }, 'dueAt runAfter').sort({ dueAt: 1 }).lean(),
    LeetcodeSyncJob.find({ status: { $in: ['SUCCEEDED', 'FAILED'] }, finishedAt: { $gte: hourAgo }, startedAt: { $exists: true } }, 'trigger enqueuedAt startedAt finishedAt dueAt').lean(),
    User.countDocuments({ role: 'STUDENT', 'sync.possibleGap': true }),
    eligibleStudents(),
  ]);
  const count = (s: string) => byStatus.find((b: any) => b._id === s)?.n ?? 0;
  const waits = (t?: string) => finished.filter((j) => !t || j.trigger === t).map((j) => Math.max(0, j.startedAt!.getTime() - j.dueAt.getTime())).sort((a, b) => a - b);
  const runs = finished.map((j) => j.finishedAt!.getTime() - j.startedAt!.getTime()).sort((a, b) => a - b);
  const overdue = eligible.filter(({ user }) => user.sync?.nextAutoSyncAt && user.sync.nextAutoSyncAt.getTime() < now.getTime() - 10 * 60_000 && (!user.sync.lastSuccessAt || user.sync.nextAutoSyncAt > user.sync.lastSuccessAt)).length;
  return {
    eligibleStudents: eligible.length, queueDepth: count('QUEUED'), activeJobs: count('RUNNING'), succeeded24h: count('SUCCEEDED'), failed24h: count('FAILED'), cancelled24h: count('CANCELLED'),
    retryBacklog, oldestQueuedAgeSec: oldest ? Math.max(0, Math.round((now.getTime() - oldest.dueAt.getTime()) / 1000)) : 0,
    overdueStudents: overdue, possibleGaps: gaps,
    latencyMs: { jobRunP50: pct(runs, 50), jobRunP95: pct(runs, 95), waitP50: pct(waits(), 50), waitP95: pct(waits(), 95), waitP99: pct(waits(), 99), manualWaitP95: pct(waits('MANUAL'), 95), scheduledWaitP95: pct(waits('SCHEDULE'), 95) },
  };
}
