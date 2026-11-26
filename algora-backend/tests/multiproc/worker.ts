/**
 * One backend "instance" for the multi-process test. Talks to the SAME replica-set MongoDB as its siblings and hammers
 * syncStudent (manual and scheduled) plus scheduled passes. Provider calls are recorded as start/end intervals in
 * `probe_calls`, so the parent can prove that no student was ever synced by two processes at once.
 */
import mongoose from 'mongoose';

async function main() {
  const { MockProvider } = await import('../../src/modules/leetcode/providers/mock.provider.js');
  const { setProviderForTests } = await import('../../src/modules/leetcode/providers/provider.registry.js');
  const { syncStudent } = await import('../../src/modules/leetcode/leetcode-sync.service.js');
  const { schedulerTick, workerStep } = await import('../../src/modules/leetcode/sync-queue.js');
  const { env } = await import('../../src/config/env.js');
  const { User } = await import('../../src/models/index.js');
  await mongoose.connect(process.env.MONGODB_URI!);
  const probe = mongoose.connection.collection('probe_calls');
  const pid = process.pid;

  class Probe extends MockProvider {
    async fetchAccepted(username: string, limit: number) {
      const start = Date.now();
      const { insertedId } = await probe.insertOne({ pid, username, start, end: null, provider: this.id });
      try { return await super.fetchAccepted(username, limit); } finally { await probe.updateOne({ _id: insertedId }, { $set: { end: Date.now() } }); }
    }
  }
  // Two providers sharing one upstream; the primary fails ~50% of the time, so failover and the shared breaker are exercised.
  class Flaky extends Probe { async fetchAccepted(u: string, l: number) { if (Math.random() < 0.5) { this.calls++; const { ProviderError } = await import('../../src/modules/leetcode/leetcode.types.js'); throw new ProviderError('PROVIDER_UNAVAILABLE', 'flaky'); } return super.fetchAccepted(u, l); } }
  const mock = new Flaky('direct'); mock.latencyMs = 60;
  const alfa = new Probe('alfa'); alfa.latencyMs = 60;
  for (const p of [mock, alfa]) p.capabilities = { ...p.capabilities, upstream: 'leetcode-graphql', reachesUpstreamDirectly: p.id === 'direct' };
  const students = await User.find({ role: 'STUDENT' }, 'leetcodeUsername').lean();
  for (const s of students) for (let i = 0; i < 5; i++) for (const p of [mock, alfa]) p.solve(s.leetcodeUsername!, `problem-${i}`, new Date(1_700_000_000_000 + i * 1000));
  setProviderForTests([mock, alfa]);
  (env as any).LEETCODE_ALFA_RATE_PER_MIN = 600;
  (env as any).LEETCODE_SYNC_ENABLED = true;

  const until = Date.now() + Number(process.env.WORKER_SECONDS ?? 8) * 1000;
  const MON_10 = new Date('2025-01-06T10:00:00+05:30');
  const tasks: Promise<unknown>[] = [];
  // Scheduler ticks and queue workers, repeatedly, in every process (the queue and the lease are the only coordination).
  const inFlight = new Set<Promise<unknown>>();
  tasks.push((async () => { while (Date.now() < until) { await schedulerTick(MON_10); await new Promise((r2) => setTimeout(r2, 300)); } })());
  tasks.push((async () => { while (Date.now() < until) { await workerStep(inFlight, () => MON_10); await new Promise((r2) => setTimeout(r2, 100)); } await Promise.all([...inFlight]); })());
  // Manual / scheduled syncs on random students, as fast as possible.
  for (let w = 0; w < 4; w++) tasks.push((async () => { while (Date.now() < until) { const s = students[Math.floor(Math.random() * students.length)]; await syncStudent(String(s._id), Math.random() < 0.5 ? 'MANUAL' : 'SCHEDULE', [mock, alfa]); } })());
  await Promise.all(tasks);
  await mongoose.disconnect();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
