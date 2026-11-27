import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttendanceRecord, AttendanceSession, AuditLog, College, Enrollment, PendingEnrollment, StudentRequest, User } from '../src/models';
import { parseAttendanceCsv, parseScanTime, resolveColumns } from '../src/modules/attendance/attendance.csv';
import { app, collegeId, login, resetDb, startDb, stopDb, tok } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
const pad = (n: number) => `22AG1A05${String(n).padStart(2, '0')}`;
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const TODAY = isoDay(0);
const D1 = isoDay(-4), D2 = isoDay(-3), D3 = isoDay(-2), D5 = isoDay(-1);

let seq = 0;
async function makeStudent(roll: string, name = `Student ${roll.slice(-2)}`, college?: any) {
  return User.create({
    googleSub: `gs-${roll}-${++seq}`, email: `${roll.toLowerCase()}${seq}@example.com`, role: 'STUDENT',
    fullName: name, rollNumber: roll, mobile: '9999999999', collegeId: college ?? collegeId(),
  });
}
async function enroll(studentId: any, batchId: any, enrolledAt = daysAgo(30)) {
  return Enrollment.create({ studentId, batchId, status: 'ACTIVE', enrolledAt });
}

async function world() {
  const admin = await login(ADMIN);
  const bA = (await admin.call('post', '/batches', { name: 'Batch A', status: 'ACTIVE', collegeId: collegeId() })).body;
  const bB = (await admin.call('post', '/batches', { name: 'Batch B', status: 'ACTIVE', collegeId: collegeId() })).body;
  const a1 = await makeStudent(pad(1), 'Asha Rao');
  const a2 = await makeStudent(pad(2), 'Bilal Khan');
  const a3 = await makeStudent(pad(3), 'Chitra Das');
  const b1 = await makeStudent(pad(9), 'Dev Patel');
  const outsider = await makeStudent(pad(50), 'Esha Verma');
  for (const s of [a1, a2, a3]) await enroll(s._id, bA._id);
  await enroll(b1._id, bB._id);
  await User.create({ googleSub: 't1', email: 't1@example.com', role: 'TRAINER', fullName: 'Trainer One', trainerId: 'tr_one' });
  const tid = (await User.findOne({ trainerId: 'tr_one' }))!._id;
  await admin.call('post', `/batches/${bA._id}/trainers`, { trainerId: String(tid) });
  const trainer = await login(tok('t1', 't1@example.com', 'Trainer One'));
  return { admin, trainer, bA, bB, a1, a2, a3, b1, outsider };
}

const csvOf = (rolls: string[], header = 'rollNumber') =>
  [header, ...rolls].join('\n') + '\n';
const record = (who: any, body: Record<string, unknown>) => who.call('post', '/attendance/sessions', body);

describe('QR code payload', () => {
  it('is exactly the approved roll number, unaffected by a pending change request, and updates on approval', async () => {
    const w = await world();
    const user = await makeStudent(pad(70), 'Qr Student');
    await User.updateOne({ _id: user._id }, { $set: { googleSub: 'gs-q' } });
    await enroll(user._id, w.bA._id);
    const student = await login(tok('gs-q', user.email, 'Qr Student'));
    const qr = (await student.call('get', '/student/attendance/qr')).body;
    expect(qr.payload).toBe(pad(70));
    expect(qr.payload).toBe(user.rollNumber);
    expect(qr.payload).not.toContain('{');
    // Pending request must not change the QR.
    await StudentRequest.create({
      studentId: user._id, kind: 'PROFILE', status: 'PENDING', reason: 'Correction',
      current: { rollNumber: pad(70) }, requested: { rollNumber: pad(71) },
    });
    expect((await student.call('get', '/student/attendance/qr')).body.payload).toBe(pad(70));
    // Approval (simulated) changes the approved roll number and therefore the payload.
    await User.updateOne({ _id: user._id }, { $set: { rollNumber: pad(71) } });
    expect((await student.call('get', '/student/attendance/qr')).body.payload).toBe(pad(71));
  });
});

describe('CSV parsing', () => {
  it('handles BOM, CRLF, quoting, headerless files and alternative column names', () => {
    const parsed = parseAttendanceCsv('\uFEFFrollNumber,scannedAt\r\n"22AG1A0501","2026-12-07 09:24:12"\r\n');
    expect(parsed.header).toEqual(['rollNumber', 'scannedAt']);
    expect(parsed.rows[0].cells[0]).toBe('22AG1A0501');
    const headerless = parseAttendanceCsv('22AG1A0501\n22AG1A0502\n');
    expect(headerless.header).toBeNull();
    expect(resolveColumns(headerless).rollIndex).toBe(0);
    const alt = resolveColumns(parseAttendanceCsv('Roll No.,Scan Time\n22AG1A0501,2026-12-07 09:24:12\n'));
    expect(alt).toMatchObject({ rollIndex: 0, timeIndex: 1, ambiguous: false });
    const ambiguous = resolveColumns(parseAttendanceCsv('Who,When\n22AG1A0501,09:24\n'));
    expect(ambiguous.ambiguous).toBe(true);
    expect(parseScanTime('2026-12-07 09:24:12', 'Asia/Kolkata')?.toISOString()).toBe('2026-12-07T03:54:12.000Z');
    expect(parseScanTime('nonsense')).toBeNull();
  });
});

describe('attendance recording', () => {
  it('previews without writing, classifies every row, and finalizes present/absent from the eligible roster', async () => {
    const w = await world();
    const csv = csvOf([pad(1), pad(2), pad(1), '22AG1A9999', 'SHORT', pad(9), pad(50)]);
    const preview = await w.admin.call('post', '/attendance/preview', { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv });
    expect(preview.status).toBe(200);
    expect(preview.body.counts).toMatchObject({ totalRows: 7, present: 2, duplicates: 1, unknown: 1, invalid: 1, outOfBatch: 2 });
    expect(preview.body.present.map((p: any) => p.rollNumber).sort()).toEqual([pad(1), pad(2)]);
    expect(preview.body.absent.map((a: any) => a.rollNumber)).toEqual([pad(3)]);
    expect(await AttendanceSession.countDocuments()).toBe(0);

    const created = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv, finalize: true });
    expect(created.status).toBe(201);
    expect(created.body.session).toMatchObject({ status: 'FINALIZED', eligibleCount: 3, presentCount: 2, absentCount: 1, percentage: 66.7 });
    const recorded = await AttendanceRecord.find({ sessionId: created.body.session._id }).lean();
    expect(recorded.filter((r) => r.status === 'PRESENT')).toHaveLength(2);
    expect(recorded.filter((r) => r.status === 'ABSENT')).toHaveLength(1);
  });

  it('supports headerless CSVs, lowercase rolls, alternative columns, optional timestamps and column mapping', async () => {
    const w = await world();
    const headerless = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: `${pad(1).toLowerCase()}\n${pad(2)}\n`,
    });
    expect(headerless.status).toBe(200);
    expect(headerless.body.counts.present).toBe(2);
    const alt = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING',
      csv: `Barcode,Timestamp\n${pad(1)},2026-12-07 09:24:12\n`,
    });
    expect(alt.body.present[0].scanAt).toBe('2026-12-07T03:54:12.000Z');
    const ambiguous = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: `Who,When\n${pad(1)},09:24\n`,
    });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.details.code).toBe('COLUMN_MAPPING_REQUIRED');
    const mapped = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: `Who,When\n${pad(1)},09:24\n`, columnMap: { rollColumn: 0, timestampColumn: 1 },
    });
    expect(mapped.status).toBe(200);
    expect(mapped.body.present[0].rollNumber).toBe(pad(1));
  });

  it('keeps the earliest valid scan timestamp and counts duplicates once', async () => {
    const w = await world();
    const preview = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING',
      csv: `rollNumber,scannedAt\n${pad(1)},2026-12-07 09:30:00\n${pad(1)},2026-12-07 09:24:12\n${pad(2)},not-a-date\n`,
    });
    expect(preview.body.counts).toMatchObject({ present: 2, duplicates: 1, invalidTimestamps: 1 });
    const p1 = preview.body.present.find((p: any) => p.rollNumber === pad(1));
    expect(p1.scanAt).toBe('2026-12-07T03:54:12.000Z');
  });

  it('rejects malformed, empty and oversized files and future dates', async () => {
    const w = await world();
    expect((await w.admin.call('post', '/attendance/preview', { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: 'rollNumber\n"unclosed\n' })).status).toBe(400);
    expect((await w.admin.call('post', '/attendance/preview', { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: '\n\n' })).status).toBe(400);
    const big = 'rollNumber\n' + Array.from({ length: 5002 }, (_, i) => `22AG1A${String(i).padStart(4, '0')}`).join('\n');
    expect((await w.admin.call('post', '/attendance/preview', { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: big })).status).toBe(400);
    expect((await w.admin.call('post', '/attendance/preview', { batchId: w.bA._id, attendanceDate: isoDay(3), sessionType: 'MORNING', csv: csvOf([pad(1)]) })).status).toBe(400);
  });

  it('excludes enrollments that were not eligible on the attendance date and reports pending enrollments', async () => {
    const w = await world();
    const later = await makeStudent(pad(80), 'Later Student');
    await enroll(later._id, w.bA._id, new Date(Date.now() + 5 * 86_400_000));
    await PendingEnrollment.create({ batchId: w.bA._id, rollNumber: pad(90), claimCodeHash: 'hash', status: 'PENDING', createdBy: (await User.findOne({ role: 'SUPER_ADMIN' }))!._id });
    const preview = await w.admin.call('post', '/attendance/preview', {
      batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: csvOf([pad(80)]),
    });
    expect(preview.body.counts.notEligible).toBe(1);
    expect(preview.body.present).toHaveLength(0);
    expect(preview.body.pendingCount).toBe(1);
    expect(preview.body.rosterCount).toBe(3);
  });

  it('prevents duplicate sessions and keeps Morning and Afternoon independent', async () => {
    const w = await world();
    const first = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    expect(first.status).toBe(201);
    const duplicate = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:45', csv: csvOf([pad(2)]), finalize: true });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ATTENDANCE_EXISTS');
    const afternoon = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'AFTERNOON', attendanceTime: '14:00', csv: csvOf([pad(2)]), finalize: true });
    expect(afternoon.status).toBe(201);
    expect(await AttendanceSession.countDocuments()).toBe(2);
  });

  it('supports the draft → finalize lifecycle and blocks finalization when the roster changed', async () => {
    const w = await world();
    const draft = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]) });
    expect(draft.body.session.status).toBe('DRAFT');
    expect(await AttendanceRecord.countDocuments({ sessionStatus: 'FINALIZED' })).toBe(0);
    // A new eligible student appears after the draft: finalization must not silently change history.
    const added = await makeStudent(pad(81), 'Added Student');
    await enroll(added._id, w.bA._id, daysAgo(10));
    const blocked = await w.admin.call('post', `/attendance/sessions/${draft.body.session._id}/finalize`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ROSTER_CHANGED');
  });

  it('finalizes a draft, validates reasons for finalized corrections, and preserves correction history', async () => {
    const w = await world();
    const draft = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1), pad(2)]) });
    const finalized = await w.admin.call('post', `/attendance/sessions/${draft.body.session._id}/finalize`, {});
    expect(finalized.body.session).toMatchObject({ status: 'FINALIZED', presentCount: 2, absentCount: 1 });
    const noReason = await w.admin.call('patch', `/attendance/sessions/${draft.body.session._id}/records`, {
      corrections: [{ studentId: String(w.a3._id), status: 'PRESENT' }], reason: '',
    });
    expect(noReason.status).toBe(400);
    const corrected = await w.admin.call('patch', `/attendance/sessions/${draft.body.session._id}/records`, {
      corrections: [{ studentId: String(w.a3._id), status: 'PRESENT' }, { studentId: String(w.a2._id), status: 'ABSENT' }],
      reason: 'Scanner missed a student',
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.session).toMatchObject({ presentCount: 2, absentCount: 1 });
    const chitra = corrected.body.records.find((r: any) => String(r.studentId) === String(w.a3._id));
    expect(chitra.status).toBe('PRESENT');
    expect(chitra.corrections[0]).toMatchObject({ from: 'ABSENT', to: 'PRESENT', reason: 'Scanner missed a student' });
    const logs = await AuditLog.find({ action: 'attendance.session.correct' }).lean();
    expect(logs).toHaveLength(1);
  });

  it('adds missing scans and replaces a finalized roster with a corrected CSV', async () => {
    const w = await world();
    const created = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    const id = created.body.session._id;
    const added = await w.admin.call('post', `/attendance/sessions/${id}/import`, { mode: 'ADD', csv: csvOf([pad(2)]), reason: 'Missing scan' });
    expect(added.status).toBe(200);
    expect(added.body.session).toMatchObject({ presentCount: 2, absentCount: 1 });
    const noReason = await w.admin.call('post', `/attendance/sessions/${id}/import`, { mode: 'REPLACE', csv: csvOf([pad(3)]) });
    expect(noReason.status).toBe(400);
    const replaced = await w.admin.call('post', `/attendance/sessions/${id}/import`, { mode: 'REPLACE', csv: csvOf([pad(3)]), reason: 'Wrong file uploaded' });
    expect(replaced.body.session).toMatchObject({ presentCount: 1, absentCount: 2 });
    expect(replaced.body.records.find((r: any) => r.rollNumber === pad(3)).status).toBe('PRESENT');
  });

  it('cancels a session, excludes it from analytics, and frees the slot', async () => {
    const w = await world();
    const created = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    const cancelled = await w.admin.call('post', `/attendance/sessions/${created.body.session._id}/cancel`, { reason: 'Recorded by mistake' });
    expect(cancelled.body.session.status).toBe('CANCELLED');
    const totals = (await w.admin.call('get', `/attendance/overview?batchId=${w.bA._id}`)).body.totals;
    expect(totals.sessions).toBe(0);
    expect(totals.percentage).toBeNull();
    const again = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:40', csv: csvOf([pad(2)]), finalize: true });
    expect(again.status).toBe(201);
    expect((await AttendanceRecord.countDocuments({ sessionStatus: 'CANCELLED' }))).toBe(3);
  });

  it('handles concurrent finalization with exactly one winner and repairs tampered summaries', async () => {
    const w = await world();
    const draft = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]) });
    const id = draft.body.session._id;
    const results = await Promise.all([
      w.admin.call('post', `/attendance/sessions/${id}/finalize`, {}),
      w.admin.call('post', `/attendance/sessions/${id}/finalize`, {}),
    ]);
    expect(results.map((r: any) => r.status).sort()).toEqual([200, 409]);
    await AttendanceSession.updateOne({ _id: id }, { $set: { presentCount: 99 } });
    const reconciled = await w.admin.call('post', '/attendance/reconcile', {});
    expect(reconciled.body.repaired).toBe(1);
    const fixed = await AttendanceSession.findById(id).lean();
    expect(fixed!.presentCount).toBe(1);
  });
});

describe('attendance analytics and exports', () => {
  async function seeded() {
    const w = await world();
    await record(w.admin, { batchId: w.bA._id, attendanceDate: D1, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1), pad(2)]), finalize: true });
    await record(w.admin, { batchId: w.bA._id, attendanceDate: D1, sessionType: 'AFTERNOON', attendanceTime: '14:00', csv: csvOf([pad(1)]), finalize: true });
    await record(w.admin, { batchId: w.bA._id, attendanceDate: D2, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1), pad(2), pad(3)]), finalize: true });
    await record(w.admin, { batchId: w.bB._id, attendanceDate: D2, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(9)]), finalize: true });
    return w;
  }

  it('computes daily, weekly and monthly attendance with missing sessions left unrecorded', async () => {
    const w = await seeded();
    const daily = (await w.admin.call('get', `/attendance/analytics/daily?from=${D1}&to=${D2}&batchId=${w.bA._id}`)).body;
    expect(daily.days[0]).toMatchObject({ date: D1, morningPct: 66.7, afternoonPct: 33.3 });
    expect(daily.days[0].overall).toMatchObject({ eligible: 6, present: 3, absent: 3 });
    const weekly = (await w.admin.call('get', `/attendance/analytics/weekly?from=${D1}&to=${D2}&batchId=${w.bA._id}`)).body;
    expect(weekly.totals).toMatchObject({ eligible: 9, present: 6, absent: 3, percentage: 66.7, sessions: 3 });
    expect(weekly.daily).toHaveLength(2);
    const monthly = (await w.admin.call('get', `/attendance/analytics/monthly?from=${D1}&to=${D2}&batchId=${w.bA._id}`)).body;
    expect(monthly.totals.percentage).toBe(66.7);
    const oneDay = (await w.admin.call('get', `/attendance/analytics/daily?from=${D3}&to=${D3}`)).body;
    expect(oneDay.days[0]).toMatchObject({ morning: null, afternoon: null, overall: { eligible: 0, percentage: null } });
  });

  it('weights overall batch attendance and computes college attendance and low-attendance thresholds', async () => {
    const w = await seeded();
    const batches = (await w.admin.call('get', '/attendance/analytics/batches')).body;
    expect(batches.items).toHaveLength(2);
    const A = batches.items.find((b: any) => b.name === 'Batch A');
    expect(A).toMatchObject({ eligible: 9, present: 6, absent: 3, percentage: 66.7, hasData: true });
    const B = batches.items.find((b: any) => b.name === 'Batch B');
    expect(B).toMatchObject({ eligible: 1, present: 1, percentage: 100, hasData: true });
    expect(batches.weighted).toMatchObject({ eligible: 10, present: 7, percentage: 70 });
    const college = (await w.admin.call('get', '/attendance/analytics/colleges')).body;
    const collegeA = college.items.find((r: any) => r.batch === 'Batch A');
    expect(collegeA).toMatchObject({ college: 'JNTU', eligible: 9, present: 6, percentage: 66.7 });
    expect(college.weighted).toMatchObject({ eligible: 10, present: 7, percentage: 70 });
    const low = (await w.admin.call('get', `/attendance/analytics/low?batchId=${w.bA._id}&threshold=75`)).body;
    expect(low.items.map((r: any) => r.rollNumber).sort()).toEqual([pad(2), pad(3)]);
    expect(low.items.every((r: any) => r.eligible > 0)).toBe(true);
    const emptyRange = (await w.admin.call('get', `/attendance/analytics/low?batchId=${w.bA._id}&from=${D5}&to=${D5}`)).body;
    expect(emptyRange.items).toHaveLength(0); // no recorded sessions: nobody is flagged
  });

  it('reports individual student attendance, never a misleading 0% without eligible sessions', async () => {
    const w = await seeded();
    const data = (await w.admin.call('get', `/attendance/students/${w.a2._id}?from=${D1}&to=${D1}`)).body;
    expect(data.summary).toMatchObject({ eligible: 2, present: 1, absent: 1, percentage: 50 });
    expect(data.summary.morning.percentage).toBe(100);
    expect(data.summary.afternoon.percentage).toBe(0);
    expect(data.daily[0]).toMatchObject({ morning: 'PRESENT', afternoon: 'ABSENT' });
    const none = (await w.admin.call('get', `/attendance/students/${w.outsider._id}`)).body;
    expect(none.summary).toMatchObject({ eligible: 0, percentage: null });
  });

  it('builds a bounded register and a stable historical roster', async () => {
    const w = await seeded();
    const register = (await w.admin.call('get', `/attendance/register?batchId=${w.bA._id}&from=${D1}&to=${D2}`)).body;
    expect(register.columns).toHaveLength(3);
    const asha = register.items.find((r: any) => r.rollNumber === pad(1));
    expect(asha).toMatchObject({ present: 3, absent: 0, percentage: 100 });
    expect(asha.cells.filter((c: string) => c === 'PRESENT')).toHaveLength(3);
    // New enrolment and roll-number change must not rewrite history.
    const newcomer = await makeStudent(pad(82), 'Newcomer');
    await enroll(newcomer._id, w.bA._id, daysAgo(0));
    await User.updateOne({ _id: w.a2._id }, { $set: { rollNumber: pad(42) } });
    const session = (await w.admin.call('get', `/attendance/sessions?batchId=${w.bA._id}&from=${D1}&to=${D1}`)).body.items[0];
    const detail = (await w.admin.call('get', `/attendance/sessions/${session._id}`)).body;
    expect(detail.session.eligibleCount).toBe(3);
    expect(detail.records.map((r: any) => r.rollNumber).sort()).toEqual([pad(1), pad(2), pad(3)]);
    expect(detail.records.map((r: any) => String(r.studentId))).toContain(String(w.a2._id));
  });

  it('exports CSV and XLSX with authorization, and neutralises spreadsheet formulas', async () => {
    const w = await world();
    await User.updateOne({ _id: w.a1._id }, { $set: { fullName: '=HYPERLINK("http://evil")' } });
    const created = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    const csv = await w.admin.call('get', `/attendance/export?type=session&sessionId=${created.body.session._id}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain("'=HYPERLINK");
    const xlsx = await w.admin.call('get', `/attendance/export?type=session&sessionId=${created.body.session._id}&format=xlsx`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const trainerBatch = await w.trainer.call('get', `/attendance/export?type=batch&format=csv`);
    expect(trainerBatch.text).not.toContain('Batch B');
    expect((await w.admin.call('get', '/attendance/template')).text).toContain('rollNumber');
  });
});

describe('attendance security', () => {
  it('denies students, keeps trainer scope and allows Super Admin globally', async () => {
    const w = await world();
    const created = await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    await User.updateOne({ _id: w.a1._id }, { $set: { googleSub: 'gs-a1' } });
    const student = await login(tok('gs-a1', w.a1.email, 'Asha Rao'));
    await record(w.admin, { batchId: w.bB._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(9)]), finalize: true });
    expect((await student.call('post', '/attendance/sessions', { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:00', csv: '' })).status).toBe(403);
    expect((await student.call('get', '/attendance/overview')).status).toBe(403);
    expect((await student.call('get', `/attendance/students/${w.a2._id}`)).status).toBe(403);
    const own = (await student.call('get', '/student/attendance')).body;
    expect(own.student.rollNumber).toBe(pad(1));
    expect(own.history).toHaveLength(1);

    // Trainer can read/record their own batch only.
    expect((await w.trainer.call('get', `/attendance/sessions/${created.body.session._id}`)).status).toBe(200);
    expect((await w.trainer.call('get', `/attendance/sessions?batchId=${w.bB._id}`)).status).toBe(404);
    expect((await w.trainer.call('post', '/attendance/preview', { batchId: w.bB._id, attendanceDate: TODAY, sessionType: 'MORNING', csv: csvOf([pad(9)]) })).status).toBe(404);
    expect((await w.trainer.call('get', `/attendance/students/${w.b1._id}`)).status).toBe(404);
    expect((await w.trainer.call('get', '/attendance/overview')).body.totals.sessions).toBe(1); // their batch only
    expect((await w.admin.call('get', '/attendance/overview')).body.totals.sessions).toBe(2);
    expect((await w.trainer.call('post', '/attendance/reconcile', {})).status).toBe(403);
  });

  it('records attendance audit events without raw CSV content', async () => {
    const w = await world();
    await record(w.admin, { batchId: w.bA._id, attendanceDate: TODAY, sessionType: 'MORNING', attendanceTime: '09:30', csv: csvOf([pad(1)]), finalize: true });
    const logs = await AuditLog.find({ action: { $in: ['attendance.session.create', 'attendance.session.finalize'] } }).lean();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logs)).not.toContain(pad(1));
  });
});
