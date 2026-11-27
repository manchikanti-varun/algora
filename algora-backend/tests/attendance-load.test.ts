import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Enrollment, User } from '../src/models';
import { login, resetDb, startDb, stopDb, tok } from './helpers';

/**
 * Opt-in load measurement for the attendance import pipeline. Real numbers are recorded in
 * docs/ATTENDANCE_IMPLEMENTATION_REPORT.md. Run with:
 *   ATTENDANCE_LOAD=1 npx vitest run tests/attendance-load.test.ts
 * It uses a disposable in-memory replica set and fictional roll numbers only.
 */
const enabled = process.env.ATTENDANCE_LOAD === '1';
const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
const today = new Date().toISOString().slice(0, 10);
const roll = (i: number) => `22AG1A${String(i).padStart(4, '0')}`;

describe.skipIf(!enabled)('attendance load', () => {
  beforeAll(startDb, 120_000);
  afterAll(stopDb);
  it('measures import, finalization, history and analytics for 50 to 1000 students', async () => {
    const results: Record<string, number>[] = [];
    for (const n of [50, 100, 200, 500, 1000]) {
      await resetDb();
      const admin = await login(ADMIN);
      const batch = (await admin.call('post', '/batches', { name: `Load ${n}`, status: 'ACTIVE' })).body;
      const users = await User.insertMany(Array.from({ length: n }, (_, i) => ({
        googleSub: `load-${n}-${i}`, email: `load${n}-${i}@example.com`, role: 'STUDENT',
        fullName: `Load Student ${i}`, rollNumber: roll(i + 1), mobile: '9999999999',
      })));
      await Enrollment.insertMany(users.map((u) => ({ studentId: u._id, batchId: batch._id, status: 'ACTIVE', enrolledAt: new Date(Date.now() - 30 * 86_400_000) })));
      const csv = ['rollNumber,scannedAt', ...users.map((u, i) => `${u.rollNumber},${today} 09:${String(10 + (i % 45)).padStart(2, '0')}:00`)].join('\n');

      const t0 = performance.now();
      const preview = await admin.call('post', '/attendance/preview', { batchId: batch._id, attendanceDate: today, sessionType: 'MORNING', csv });
      const t1 = performance.now();
      expect(preview.status).toBe(200);
      const created = await admin.call('post', '/attendance/sessions', { batchId: batch._id, attendanceDate: today, sessionType: 'MORNING', attendanceTime: '09:30', csv });
      const t2 = performance.now();
      expect(created.status).toBe(201);
      const finalized = await admin.call('post', `/attendance/sessions/${created.body.session._id}/finalize`, {});
      const t3 = performance.now();
      expect(finalized.status).toBe(200);
      const history = await admin.call('get', `/attendance/students/${users[0]._id}`);
      const t4 = performance.now();
      const analytics = await admin.call('get', `/attendance/analytics/daily?from=${today}&to=${today}&batchId=${batch._id}`);
      const t5 = performance.now();
      const exportCsv = await admin.call('get', `/attendance/export?type=session&sessionId=${created.body.session._id}&format=csv`);
      const t6 = performance.now();
      expect(history.status).toBe(200);
      expect(analytics.body.days[0].overall.present).toBe(n);
      expect(exportCsv.status).toBe(200);
      results.push({
        students: n, previewMs: Math.round(t1 - t0), createDraftMs: Math.round(t2 - t1), finalizeMs: Math.round(t3 - t2),
        studentHistoryMs: Math.round(t4 - t3), analyticsMs: Math.round(t5 - t4), exportCsvMs: Math.round(t6 - t5),
        csvBytes: Buffer.byteLength(csv),
      });
    }
    // eslint-disable-next-line no-console
    console.log(`ATTENDANCE_LOAD_RESULTS ${JSON.stringify(results)}`);
    expect(results).toHaveLength(5);
  }, 600_000);
});
