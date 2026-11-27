import ExcelJS from 'exceljs';
import type { UserDoc } from '../../models';
import { toCsv } from '../../lib/csv';
import { attendanceRegister, batchAnalysis, collegeAnalysis, dailyAnalysis, lowAttendance, rangeTotals } from './attendance.analytics';
import { getSessionDetail, studentAttendanceData } from './attendance.service';

export type ExportType = 'session' | 'student' | 'batch' | 'college' | 'register' | 'low' | 'daily' | 'weekly' | 'monthly';

interface Column { header: string; width?: number; type?: 'date' | 'percent' | 'number' }
export interface Sheet { name: string; columns: Column[]; rows: unknown[][] }
export interface BuiltExport { filename: string; sheets: Sheet[] }

export interface ExportParams {
  type: ExportType; batchId?: string; studentId?: string; sessionId?: string; collegeId?: string;
  from?: string; to?: string; month?: string; sessionType?: 'MORNING' | 'AFTERNOON'; threshold?: number; q?: string;
}

const SESSION_LABEL = (t: string) => (t === 'MORNING' ? 'Morning' : 'Afternoon');
const dateText = (d: string) => new Date(`${d}T00:00:00Z`);

const detailColumns: Column[] = [
  { header: 'Student name', width: 28 }, { header: 'Roll number', width: 16 }, { header: 'College', width: 30 },
  { header: 'Batch', width: 24 }, { header: 'Date', width: 13, type: 'date' }, { header: 'Session', width: 11 },
  { header: 'Attendance time', width: 16 }, { header: 'Attendance status', width: 18 }, { header: 'Scan timestamp', width: 22 },
  { header: 'Recorded by', width: 24 }, { header: 'Marking method', width: 20 },
];

const summaryColumns: Column[] = [
  { header: 'Student name', width: 28 }, { header: 'Roll number', width: 16 }, { header: 'College', width: 30 },
  { header: 'Eligible sessions', width: 16, type: 'number' }, { header: 'Present', width: 10, type: 'number' },
  { header: 'Absent', width: 10, type: 'number' }, { header: 'Attendance %', width: 14, type: 'percent' },
  { header: 'Morning %', width: 12, type: 'percent' }, { header: 'Afternoon %', width: 13, type: 'percent' },
];

/** Build the requested report. Authorization and filters are applied by the called services. */
export async function buildAttendanceExport(user: UserDoc, p: ExportParams): Promise<BuiltExport> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (p.type === 'session') {
    if (!p.sessionId) throw new Error('sessionId required');
    const detail = await getSessionDetail(user, p.sessionId);
    const rows = detail.records.map((r) => [
      r.studentName, r.rollNumber, r.college ?? '', detail.session.batchName ?? '', dateText(detail.session.attendanceDate),
      SESSION_LABEL(detail.session.sessionType), detail.session.attendanceTime, r.status, r.scanAt ? new Date(r.scanAt) : '',
      detail.session.finalizedBy ?? detail.session.createdBy ?? '', r.markingSource,
    ]);
    return { filename: `algora-attendance-${detail.session.batchName ?? 'session'}-${detail.session.attendanceDate}-${detail.session.sessionType.toLowerCase()}-${stamp}.xlsx`, sheets: [{ name: 'Attendance', columns: detailColumns, rows }] };
  }
  if (p.type === 'student') {
    if (!p.studentId) throw new Error('studentId required');
    const data = await studentAttendanceData(p.studentId, { batchId: p.batchId, from: p.from, to: p.to, sessionType: p.sessionType });
    const summary = [[
      data.student.fullName, data.student.rollNumber, data.student.college ?? '', data.summary.eligible, data.summary.present,
      data.summary.absent, data.summary.percentage, data.summary.morning.percentage, data.summary.afternoon.percentage,
    ]];
    const history = data.history.map((h: { attendanceDate: string; sessionType: string; status: string; scanAt: Date | string | null; rollNumber: string }) => [
      h.attendanceDate ? dateText(h.attendanceDate) : '', SESSION_LABEL(h.sessionType), h.status, h.scanAt ? new Date(h.scanAt) : '', h.rollNumber,
    ]);
    return {
      filename: `algora-attendance-${data.student.rollNumber}-${stamp}.xlsx`,
      sheets: [
        { name: 'Summary', columns: summaryColumns, rows: summary },
        { name: 'History', columns: [{ header: 'Date', width: 13, type: 'date' }, { header: 'Session', width: 11 }, { header: 'Status', width: 12 }, { header: 'Scan timestamp', width: 22 }, { header: 'Roll number at the time', width: 20 }], rows: history },
      ],
    };
  }
  if (p.type === 'batch') {
    const data = await batchAnalysis(user, { batchId: p.batchId, collegeId: p.collegeId, from: p.from, to: p.to, sessionType: p.sessionType });
    const rows = data.items.map((r) => [r.name, r.status, r.students, r.sessions, r.eligible, r.present, r.absent, r.percentage, r.morning.percentage, r.afternoon.percentage]);
    return {
      filename: `algora-attendance-batch-${stamp}.xlsx`,
      sheets: [{ name: 'Batch attendance', columns: [
        { header: 'Batch', width: 28 }, { header: 'Status', width: 11 }, { header: 'Students', width: 10, type: 'number' },
        { header: 'Recorded sessions', width: 18, type: 'number' }, { header: 'Eligible opportunities', width: 20, type: 'number' },
        { header: 'Present', width: 10, type: 'number' }, { header: 'Absent', width: 10, type: 'number' },
        { header: 'Attendance %', width: 14, type: 'percent' }, { header: 'Morning %', width: 12, type: 'percent' }, { header: 'Afternoon %', width: 13, type: 'percent' },
      ], rows }],
    };
  }
  if (p.type === 'college') {
    const data = await collegeAnalysis(user, { batchId: p.batchId, collegeId: p.collegeId, from: p.from, to: p.to, sessionType: p.sessionType });
    return {
      filename: `algora-attendance-college-${stamp}.xlsx`,
      sheets: [{ name: 'College attendance', columns: [
        { header: 'College', width: 32 }, { header: 'Batch', width: 26 }, { header: 'Eligible opportunities', width: 20, type: 'number' },
        { header: 'Present', width: 10, type: 'number' }, { header: 'Absent', width: 10, type: 'number' }, { header: 'Attendance %', width: 14, type: 'percent' },
      ], rows: data.items.map((r) => [r.college, r.batch, r.eligible, r.present, r.absent, r.percentage]) }],
    };
  }
  if (p.type === 'low') {
    if (!p.from || !p.to) throw new Error('date range required');
    const all: Awaited<ReturnType<typeof lowAttendance>>['items'] = [];
    for (let page = 1; page <= 20; page++) {
      const chunk = await lowAttendance(user, { batchId: p.batchId, collegeId: p.collegeId, from: p.from, to: p.to, sessionType: p.sessionType, threshold: p.threshold, q: p.q, page, pageSize: 200 });
      all.push(...chunk.items);
      if (all.length >= chunk.total) break;
    }
    return {
      filename: `algora-low-attendance-${stamp}.xlsx`,
      sheets: [{ name: 'Low attendance', columns: [
        { header: 'Student name', width: 28 }, { header: 'Roll number', width: 16 }, { header: 'Batch', width: 26 }, { header: 'College', width: 30 },
        { header: 'Eligible sessions', width: 16, type: 'number' }, { header: 'Present', width: 10, type: 'number' },
        { header: 'Absent', width: 10, type: 'number' }, { header: 'Attendance %', width: 14, type: 'percent' },
      ], rows: all.map((r) => [r.name, r.rollNumber, r.batch, r.college ?? '', r.eligible, r.present, r.absent, r.percentage]) }],
    };
  }
  if (p.type === 'register') {
    if (!p.batchId || !p.from || !p.to) throw new Error('batch and date range required');
    const first = await attendanceRegister(user, { batchId: p.batchId, from: p.from, to: p.to, q: p.q, pageSize: 100, page: 1 });
    const data = { ...first, items: [...first.items] };
    // Every page, so a 200+ student batch is exported completely (bounded by the register date-range limit).
    for (let page = 2; data.items.length < first.total && page <= 50; page++) {
      const next = await attendanceRegister(user, { batchId: p.batchId, from: p.from, to: p.to, q: p.q, pageSize: 100, page });
      if (!next.items.length) break;
      data.items.push(...next.items);
    }
    const columns: Column[] = [
      { header: 'Roll number', width: 16 }, { header: 'Student', width: 28 }, { header: 'College', width: 28 },
      ...data.columns.map((c) => ({ header: `${c.date} ${c.sessionType === 'MORNING' ? 'M' : 'A'}`, width: 15 })),
      { header: 'Present', width: 10, type: 'number' }, { header: 'Absent', width: 10, type: 'number' }, { header: 'Attendance %', width: 14, type: 'percent' },
    ];
    return {
      filename: `algora-attendance-register-${stamp}.xlsx`,
      sheets: [{ name: 'Register', columns, rows: data.items.map((r) => [
        r.rollNumber, r.name, r.college ?? '', ...r.cells.map((c) => (c === 'PRESENT' ? 'P' : c === 'ABSENT' ? 'A' : '')), r.present, r.absent, r.percentage,
      ]) }],
    };
  }
  // daily / weekly / monthly summary
  const from = p.from ?? `${(p.month ?? new Date().toISOString()).slice(0, 7)}-01`;
  const to = p.to ?? `${(p.month ?? new Date().toISOString()).slice(0, 7)}-31`;
  const [daily, totals] = await Promise.all([
    dailyAnalysis(user, { batchId: p.batchId, collegeId: p.collegeId, from, to, sessionType: p.sessionType }),
    rangeTotals(user, { batchId: p.batchId, collegeId: p.collegeId, from, to }),
  ]);
  const rows = daily.days.map((d) => [
    dateText(d.date), d.morning?.present ?? '', d.morning?.absent ?? '', d.morningPct ?? '',
    d.afternoon?.present ?? '', d.afternoon?.absent ?? '', d.afternoonPct ?? '', d.overall.present, d.overall.absent, d.overall.percentage,
  ]);
  return {
    filename: `algora-attendance-${p.type}-${stamp}.xlsx`,
    sheets: [{
      name: 'Daily attendance',
      columns: [
        { header: 'Date', width: 13, type: 'date' }, { header: 'Morning present', width: 16, type: 'number' }, { header: 'Morning absent', width: 16, type: 'number' },
        { header: 'Morning %', width: 12, type: 'percent' }, { header: 'Afternoon present', width: 18, type: 'number' }, { header: 'Afternoon absent', width: 18, type: 'number' },
        { header: 'Afternoon %', width: 14, type: 'percent' }, { header: 'Present', width: 10, type: 'number' }, { header: 'Absent', width: 10, type: 'number' }, { header: 'Overall %', width: 12, type: 'percent' },
      ],
      rows: [...rows, [], ['Total', '', '', '', '', '', '', totals.totals.present, totals.totals.absent, totals.totals.percentage]],
    }],
  };
}

const formulaSafe = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** CSV uses the first sheet. Values from the database are escaped against spreadsheet formula injection. */
export function renderCsv(built: BuiltExport): string {
  const sheet = built.sheets[0];
  return toCsv(sheet.columns.map((c) => c.header), sheet.rows.map((row) => row.map(formulaSafe)));
}

export async function renderXlsx(built: BuiltExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Algora';
  for (const sheet of built.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width ?? 16 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of sheet.rows) {
      if (!row.length) { ws.addRow([]); continue; }
      ws.addRow(row.map((v, i) => {
        const type = sheet.columns[i]?.type;
        if (v === '' || v === null || v === undefined) return null;
        if (type === 'date' && v instanceof Date) return v;
        if (type === 'percent' && typeof v === 'number') return v / 100;
        if (type === 'number' && typeof v === 'number') return v;
        return formulaSafe(v);
      }));
    }
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.type === 'date') col.numFmt = 'yyyy-mm-dd';
      if (c.type === 'percent') col.numFmt = '0.0%';
      col.alignment = { vertical: 'top' };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const SAMPLE_ATTENDANCE_CSV = [
  'rollNumber,scannedAt',
  '22AG1A0501,2026-12-07 09:24:12',
  '22AG1A0502,2026-12-07 09:24:18',
  '22AG1A0503,2026-12-07 09:24:25',
  '22AG1A0504,2026-12-07 09:24:31',
  '',
].join('\n');
