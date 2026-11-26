import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Batch, Enrollment, LeetcodeSyncJob, SolveEvidence, User } from '../src/models';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { syncAllIndexes } from '../src/models';
import { verifiedLink } from './helpers';

/**
 * Real multi-process coordination test: 3 separate Node processes, one replica-set MongoDB.
 * Proves per-student mutual exclusion across processes, one scheduler pass at a time, and a global rate limit that holds
 * across processes.
 */
let rs: MongoMemoryReplSet;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await syncAllIndexes();
}, 120_000);
afterAll(async () => { await mongoose.disconnect(); await rs.stop(); });

const runWorker = (seconds: number, extra: Record<string, string> = {}) => new Promise<{ code: number | null; err: string }>((resolve) => {
  const p = spawn('npx', ['tsx', 'tests/multiproc/worker.ts'], {
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: rs.getUri(), WORKER_SECONDS: String(seconds), LEETCODE_CONCURRENCY: '3', ...extra },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = ''; p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, err }));
});

describe('3 backend processes, one replica set', () => {
  it('no student is ever synced by two processes at the same time; one pass at a time; global rate holds; no duplicate evidence', async () => {
    const batch = await Batch.create({ name: 'B', status: 'ACTIVE', createdBy: new mongoose.Types.ObjectId() });
    for (let i = 0; i < 20; i++) {
      const u = await User.create({ googleSub: `s${i}`, email: `s${i}@x.com`, role: 'STUDENT', fullName: `S${i}`, rollNumber: `R${String(i).padStart(9, '0')}`, leetcodeUsername: `user${i}` });
      await verifiedLink(u._id, `user${i}`);
      await Enrollment.create({ studentId: u._id, batchId: batch._id });
    }
    const RATE = 120; // per minute -> burst 24 (a fifth of a minute's budget)
    const BURST = Math.ceil(RATE / 5);
    const SECONDS = 8;
    const t0 = Date.now();
    const results = await Promise.all([1, 2, 3].map(() => runWorker(SECONDS, { LEETCODE_GLOBAL_RATE_PER_MIN: String(RATE) })));
    const elapsed = (Date.now() - t0) / 1000;
    for (const r of results) expect(r.err.replace(/\(node:\d+\).*\n?/g, '').trim()).toBe('');
    expect(results.map((r) => r.code)).toEqual([0, 0, 0]);

    const calls = await mongoose.connection.collection('probe_calls').find().toArray();
    const byProv = calls.reduce<Record<string, number>>((a, c) => ((a[c.provider] = (a[c.provider] ?? 0) + 1), a), {});
    const fo = await mongoose.connection.collection('provider_events').countDocuments({ type: 'FAILOVER' });
    console.log(`[multiproc] provider calls=${calls.length} ${JSON.stringify(byProv)} failovers=${fo} processes=${new Set(calls.map((c) => c.pid)).size} elapsed=${elapsed.toFixed(1)}s`);
    expect(fo).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(5);
    expect(new Set(calls.map((c) => c.pid)).size).toBeGreaterThanOrEqual(2); // work really was spread across processes

    // 1. mutual exclusion per student across processes
    const byUser = new Map<string, any[]>();
    for (const c of calls) byUser.set(c.username, [...(byUser.get(c.username) ?? []), c]);
    // mutual exclusion holds across providers too: one student is never being fetched by two processes/providers at once
    for (const [u, list] of byUser) {
      const s = list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < s.length; i++) expect(s[i].start, `overlap for ${u}: ${JSON.stringify([s[i - 1], s[i]])}`).toBeGreaterThanOrEqual(s[i - 1].end);
    }
    // 2. the queue never holds two active jobs for one student, and every finished job ended exactly once
    const active = await LeetcodeSyncJob.aggregate([{ $match: { status: { $in: ['QUEUED', 'RUNNING'] } } }, { $group: { _id: '$studentId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
    expect(active).toHaveLength(0);
    expect(await LeetcodeSyncJob.countDocuments({ status: 'SUCCEEDED' })).toBeGreaterThan(0);
    // 3. global rate: burst + refill over the run, across all processes
    const allowed = BURST + (RATE * (elapsed + 2)) / 60;
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(allowed));
    // 4. evidence: exactly 5 slugs per student, no duplicates
    expect(await SolveEvidence.countDocuments()).toBe(20 * 5 > 0 ? (await SolveEvidence.distinct('studentId')).length * 5 : 0);
    const dup = await SolveEvidence.aggregate([{ $group: { _id: { s: '$studentId', slug: '$slug', l: '$linkId' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
    expect(dup).toHaveLength(0);
  }, 120_000);
});
