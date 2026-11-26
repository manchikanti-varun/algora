/**
 * SIMULATED load test for the LeetCode synchronization queue. Opt-in: LOAD_SIM=1 npx vitest run tests/load/simulate.test.ts
 *
 * What is real: the MongoDB queue, leases, token bucket, provider manager, circuit breakers, evidence writes and all queries
 * (against an in-memory replica set). What is simulated: LeetCode itself (a mock provider with zero latency) and the clock
 * (a virtual clock advanced in 6 s steps, so an hour of bootcamp runs in seconds). NOTHING here contacts leetcode.com.
 *
 * Because the provider has no latency, "job processing time" below is only the backend's own database work; real end-to-end
 * latency also includes LeetCode's response time (unknown until a licensed live trial).
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env';
import { useSimulatedDbClock } from '../../src/lib/clock';
import { Batch, COUNTING_LINK_STATUSES, Enrollment, LeetcodeLink, LeetcodeSyncJob, linkFlags, RateBucket, SolveEvidence, syncAllIndexes, User } from '../../src/models';
import { invalidateSettings } from '../../src/modules/leetcode/integration-settings';
import { burstOf } from '../../src/modules/leetcode/provider-manager';
import { MockProvider } from '../../src/modules/leetcode/providers/mock.provider';
import { setProvidersForTests } from '../../src/modules/leetcode/providers/provider.registry';
import { recoverExpiredJobs, requestManualSync, schedulerTick, workerStep } from '../../src/modules/leetcode/sync-queue';
import { ProviderError } from '../../src/modules/leetcode/leetcode.types';

const RUN = process.env.LOAD_SIM === '1';
const STEP_MS = 6_000;
const RATE = 10; // global budget under test (proposed engineering limit, not a LeetCode limit)
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] / 1000) / 60; }; // ms -> minutes
const start = new Date('2026-12-07T09:30:00+05:30');

class Recording extends MockProvider {
  stamps: number[] = [];
  async fetchAccepted(u: string, l: number, s?: AbortSignal) { this.stamps.push(Date.now()); return super.fetchAccepted(u, l, s); }
}

let rs: MongoMemoryReplSet;
async function connect() {
  await mongoose.connect(rs.getUri(), { monitorCommands: true, maxPoolSize: 20 });
  mongoose.connection.getClient().on('commandSucceeded', (e: any) => {
    if (['find', 'aggregate', 'count', 'distinct'].includes(e.commandName)) dbOps.reads++;
    else if (['update', 'insert', 'delete', 'findAndModify'].includes(e.commandName)) dbOps.writes++;
    dbOps.lat.push(e.duration);
  });
}
const dbOps = { reads: 0, writes: 0, lat: [] as number[] };
beforeAll(async () => {
  if (!RUN) return;
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connect();
  await syncAllIndexes();
  useSimulatedDbClock(true);
  vi.useFakeTimers({ toFake: ['Date'] });
}, 120_000);
afterAll(async () => {
  if (!RUN) return;
  vi.useRealTimers(); useSimulatedDbClock(false);
  await mongoose.disconnect(); await rs.stop();
});

async function reset() {
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
  invalidateSettings();
  dbOps.reads = 0; dbOps.writes = 0; dbOps.lat = [];
}

/** Create n students (linked, consented) enrolled in `batches` batches each. Bulk inserts. */
async function seed(n: number, batches = 1) {
  const bs = await Batch.insertMany(Array.from({ length: batches }, (_, i) => ({ name: `B${i}`, status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId() })));
  const users = await User.insertMany(Array.from({ length: n }, (_, i) => ({ googleSub: `g${i}`, email: `u${i}@x.com`, role: 'STUDENT', fullName: `U${i}`, rollNumber: `R${String(i).padStart(9, '0')}`, leetcodeUsername: `u${i}` })));
  await LeetcodeLink.insertMany(users.map((u, i) => ({ studentId: u._id, username: `u${i}`, usernameNorm: `u${i}`, status: 'LINKED', ...linkFlags('LINKED'), kind: 'INITIAL', linkedAt: start, consentedAt: start })));
  await Enrollment.insertMany(users.flatMap((u) => bs.map((b) => ({ studentId: u._id, batchId: b._id, status: 'ACTIVE' }))));
  return users.map((u) => String(u._id));
}

interface Scenario {
  name: string; n: number; minutes?: number; batches?: number;
  /** fraction of students that request a manual update, and how often (minutes). period 0 = once, simultaneously at `at`. */
  manual?: { fraction: number; periodMin: number; atMin?: number };
  events?: (minute: number, ctx: { mock: Recording; ids: string[] }) => Promise<void> | void;
  perStep?: (virtual: Date) => Promise<void>;
}

async function run(sc: Scenario) {
  await reset();
  const minutes = sc.minutes ?? 60;
  const ids = await seed(sc.n, sc.batches ?? 1);
  const mock = new Recording();
  for (let i = 0; i < sc.n; i++) for (let p = 0; p < 3; p++) mock.solve(`u${i}`, `problem-${p}`, new Date(start.getTime() - (p + 1) * 3600_000));
  setProvidersForTests([mock]);
  (env as any).LEETCODE_SYNC_ENABLED = true; (env as any).LEETCODE_GLOBAL_RATE_PER_MIN = RATE; (env as any).LEETCODE_CONCURRENCY = 2;
  const burst = burstOf(RATE);
  const manualIds = sc.manual ? ids.slice(0, Math.round(ids.length * sc.manual.fraction)) : [];
  const nextManual = new Map(manualIds.map((id, i) => [id, sc.manual!.periodMin ? start.getTime() + (sc.manual!.atMin ?? 0) * 60_000 + (i % (sc.manual!.periodMin * 10)) * 6_000 : start.getTime() + (sc.manual!.atMin ?? 5) * 60_000]));
  const inFlight = new Set<Promise<unknown>>();
  const depth: number[] = []; let maxDepth = 0; let errors = 0; let manualRequests = 0, manualQueued = 0, manualExisting = 0, manualCooldown = 0;
  const cpu0 = process.cpuUsage(); const t0 = performance.now(); let peakRss = 0; let jobWall = 0;
  const steps = (minutes * 60_000) / STEP_MS;
  for (let i = 0; i <= steps; i++) {
    const now = new Date(start.getTime() + i * STEP_MS);
    vi.setSystemTime(now);
    const minute = Math.floor((i * STEP_MS) / 60_000);
    try {
      await sc.events?.(i * STEP_MS / 60_000, { mock, ids });
      await sc.perStep?.(now);
      for (const id of manualIds) {
        const due = nextManual.get(id)!;
        if (due <= now.getTime()) {
          manualRequests++;
          const r = await requestManualSync(id, now);
          if (r.kind === 'QUEUED') manualQueued++; else if (r.kind === 'EXISTING') manualExisting++; else if (r.kind === 'COOLDOWN') manualCooldown++;
          nextManual.set(id, sc.manual!.periodMin ? due + sc.manual!.periodMin * 60_000 : Infinity);
        }
      }
      if (i % 10 === 0) await schedulerTick(now); // once a virtual minute
      const w0 = performance.now();
      await workerStep(inFlight, () => now);
      await Promise.all([...inFlight]);
      jobWall += performance.now() - w0;
    } catch { errors++; }
    if (i % 5 === 0) { try { const d = await LeetcodeSyncJob.countDocuments({ status: 'QUEUED' }); depth.push(d); maxDepth = Math.max(maxDepth, d); } catch { /* db interrupted */ } }
    if (i % 50 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    void minute;
  }
  const cpu = process.cpuUsage(cpu0); const wall = performance.now() - t0;
  const jobs: any[] = await LeetcodeSyncJob.find({ startedAt: { $exists: true } }).lean();
  const waits = (t?: string) => jobs.filter((j) => !t || j.trigger === t).map((j) => Math.max(0, j.startedAt.getTime() - j.dueAt.getTime()));
  const perStudent = new Map<string, number>();
  for (const j of jobs.filter((x) => x.status === 'SUCCEEDED')) perStudent.set(String(j.studentId), (perStudent.get(String(j.studentId)) ?? 0) + 1);
  const counts = ids.map((id) => perStudent.get(id) ?? 0);
  const jain = counts.reduce((a, c) => a + c, 0) ** 2 / (ids.length * counts.reduce((a, c) => a + c * c, 0) || 1);
  // sliding 60 s window over every outbound request
  const st = mock.stamps.sort((a, b) => a - b); let maxWindow = 0;
  for (let a = 0, b = 0; b < st.length; b++) { while (st[b] - st[a] >= 60_000) a++; maxWindow = Math.max(maxWindow, b - a + 1); }
  const active = await LeetcodeSyncJob.aggregate([{ $match: { status: { $in: ['QUEUED', 'RUNNING'] } } }, { $group: { _id: '$studentId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const evid = await SolveEvidence.countDocuments();
  const dupEvid = await SolveEvidence.aggregate([{ $group: { _id: { s: '$studentId', slug: '$slug' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  const lat = [...dbOps.lat].sort((a, b) => a - b);
  const synced = await User.countDocuments({ 'sync.lastSuccessAt': { $exists: true } });
  return {
    scenario: sc.name, students: sc.n, virtualMinutes: minutes,
    requests: { total: mock.calls, perMinuteAvg: +(mock.calls / minutes).toFixed(2), maxIn60s: maxWindow, budgetBound: burst + RATE, withinBudget: maxWindow <= burst + RATE },
    queue: { maxDepth, endDepth: depth.at(-1) ?? null, depthP50: pct(depth.map((d) => d * 60_000), 50) === null ? null : depth.sort((a, b) => a - b)[Math.floor(depth.length / 2)] },
    studentsSyncedAtLeastOnce: synced, studentsNeverSynced: sc.n - synced,
    waitMin: { all: { p50: pct(waits(), 50), p95: pct(waits(), 95), p99: pct(waits(), 99) }, automatic: { p50: pct(waits('SCHEDULE'), 50), p95: pct(waits('SCHEDULE'), 95) }, manual: { p50: pct(waits('MANUAL'), 50), p95: pct(waits('MANUAL'), 95), p99: pct(waits('MANUAL'), 99) } },
    jobs: { succeeded: jobs.filter((j) => j.status === 'SUCCEEDED').length, failed: jobs.filter((j) => j.status === 'FAILED').length, cancelled: await LeetcodeSyncJob.countDocuments({ status: 'CANCELLED' }), stillQueued: await LeetcodeSyncJob.countDocuments({ status: 'QUEUED' }), duplicateActiveJobs: active.length },
    manual: sc.manual ? { requests: manualRequests, queued: manualQueued, coalescedIntoExisting: manualExisting, cooldownRejected: manualCooldown } : null,
    fairness: { jainIndex: +jain.toFixed(3), minSyncsPerStudent: Math.min(...counts), maxSyncsPerStudent: Math.max(...counts) },
    evidence: { rows: evid, expectedRows: synced * 3, duplicateRows: dupEvid.length },
    backend: { wallSec: +(wall / 1000).toFixed(1), cpuSec: +((cpu.user + cpu.system) / 1e6).toFixed(2), peakRssMB: Math.round(peakRss / 1048576), dbWorkPerJobMs: jobs.length ? +(jobWall / jobs.length).toFixed(2) : null, errorsHandled: errors },
    mongo: { reads: dbOps.reads, writes: dbOps.writes, writesPerJob: jobs.length ? +(dbOps.writes / jobs.length).toFixed(1) : null, cmdP50ms: lat[Math.floor(lat.length / 2)] ?? null, cmdP95ms: lat[Math.floor(lat.length * 0.95)] ?? null, cmdP99ms: lat[Math.floor(lat.length * 0.99)] ?? null },
  };
}

const results: any[] = [];
const record = (r: any) => { results.push(r); console.log(JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2)); return r; };
const check = (r: any) => { expect(r.requests.withinBudget, 'request budget exceeded').toBe(true); expect(r.jobs.duplicateActiveJobs).toBe(0); expect(r.evidence.duplicateRows).toBe(0); expect(r.evidence.rows).toBe(r.evidence.expectedRows); expect(r.queue.maxDepth).toBeLessThanOrEqual(r.students); };

describe.skipIf(!RUN)('simulated load (mock provider, virtual clock, real queue + MongoDB)', () => {
  describe('1. automatic only', () => {
    for (const n of [50, 100, 150, 200, 500, 1000]) it(`${n} students`, async () => { check(record(await run({ name: `1-auto-${n}`, n }))); }, 600_000);
  });
  describe('2-5. manual demand at 200 students', () => {
    it('2. 25% request every 10 min', async () => { check(record(await run({ name: '2-manual25-200', n: 200, manual: { fraction: 0.25, periodMin: 10 } }))); }, 600_000);
    it('3. 50% request every 10 min', async () => { check(record(await run({ name: '3-manual50-200', n: 200, manual: { fraction: 0.5, periodMin: 10 } }))); }, 600_000);
    it('4. all 200 request every 10 min', async () => { check(record(await run({ name: '4-manual100-200', n: 200, manual: { fraction: 1, periodMin: 10 } }))); }, 600_000);
    it('5. all 200 request simultaneously', async () => { check(record(await run({ name: '5-simultaneous-200', n: 200, manual: { fraction: 1, periodMin: 0, atMin: 5 } }))); }, 600_000);
    it('4b. all 1000 request every 10 min', async () => { check(record(await run({ name: '4b-manual100-1000', n: 1000, minutes: 30, manual: { fraction: 1, periodMin: 10 } }))); }, 900_000);
  });
  describe('6-10. failure scenarios at 200 students', () => {
    it('6. provider downtime from minute 10 to 30', async () => {
      const r = record(await run({ name: '6-provider-down-200', n: 200, minutes: 90, events: (m, { mock }) => { mock.failWith = m >= 10 && m < 30 ? 'PROVIDER_UNAVAILABLE' : null; } }));
      check(r);
      expect(r.jobs.duplicateActiveJobs).toBe(0);
    }, 900_000);
    it('7. upstream HTTP 429 (Retry-After 120 s) at peak: requests stop while the shared restriction is active', async () => {
      let sentDuringBlock = 0; let blockedAt = 0;
      const r = record(await run({
        name: '7-rate-limited-200', n: 200, minutes: 60, manual: { fraction: 1, periodMin: 0, atMin: 14 },
        events: (m, { mock }) => {
          if (m >= 15 && m < 15.2) { mock.failWith = 'UPSTREAM_RATE_LIMITED'; mock.retryAfterSec = 120; if (!blockedAt) blockedAt = Date.now(); } else mock.failWith = null;
          if (blockedAt && Date.now() > blockedAt + 15_000 && Date.now() < blockedAt + 110_000) sentDuringBlock = mock.stamps.filter((s) => s > blockedAt + 15_000 && s < blockedAt + 110_000).length;
        },
      }));
      check(r); expect(sentDuringBlock).toBe(0);
    }, 900_000);
    it('8. backend restart with queued and running jobs: recovered, nothing lost or duplicated', async () => {
      let recovered = 0;
      const r = record(await run({
        name: '8-restart-200', n: 200, minutes: 40, manual: { fraction: 0.5, periodMin: 0, atMin: 9 },
        events: async (m) => { if (m === 10) { const running = await LeetcodeSyncJob.find({ status: 'QUEUED' }).limit(2).lean(); await LeetcodeSyncJob.updateMany({ _id: { $in: running.map((j: any) => j._id) } }, { $set: { status: 'RUNNING', fence: 9, leaseExpiresAt: new Date(Date.now() - 1000), startedAt: new Date() } }); invalidateSettings(); recovered = await recoverExpiredJobs(new Date()); } },
      }));
      check(r); expect(recovered).toBe(2);
    }, 900_000);
    it('9. MongoDB interruption (minute 10-12) and recovery', async () => {
      let down = false; let recoveredAtMin: number | null = null; let resumed = 0;
      const r = record(await run({
        name: '9-mongo-outage-200', n: 200, minutes: 40,
        events: async (m) => {
          if (m === 10 && !down) { down = true; await mongoose.disconnect(); }
          if (m >= 12 && down) { await connect(); down = false; recoveredAtMin = m; resumed = Date.now(); }
        },
      }));
      void resumed; check(r); expect(recoveredAtMin).toBe(12);
      expect(r.studentsNeverSynced).toBeLessThan(200 * 0.5);
    }, 900_000);
    it('10. students shared by 3 batches (2 courses each): one request per student, not per enrolment', async () => {
      const r = record(await run({ name: '10-multibatch-200', n: 200, batches: 3 }));
      check(r);
      expect(r.requests.total).toBeLessThanOrEqual(r.jobs.succeeded + r.jobs.failed + 2 * 2);
      expect(await Enrollment.countDocuments()).toBe(600);
    }, 600_000);
  });
  it('writes a one-line summary', () => {
    expect(results.length).toBeGreaterThan(0);
    void RateBucket; void COUNTING_LINK_STATUSES; void ProviderError;
  });
});
