import ExcelJS from 'exceljs';
import { z } from 'zod';
import { idSchema } from '../administration/contracts.js';
import { AppError } from '../middleware/errors.js';
import { querySchema } from './contracts.js';
export const reportTypes = [
  'DAY',
  'PROBLEM',
  'STUDENT',
  'BATCH',
  'COMPLETE',
] as const;
export type ReportType = (typeof reportTypes)[number];
export const exportFilters = querySchema.safeExtend({
  year: z.coerce.number().int().min(1).max(4).optional(),
  search: z.string().trim().max(100).optional(),
  collegeId: idSchema.optional(),
  courseId: idSchema.optional(),
  rollNumber: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9]*$/)
    .optional(),
  studentName: z.string().trim().max(120).optional(),
});
export const exportSchema = z
  .object({
    filters: exportFilters,
    format: z.enum(['CSV', 'XLSX']),
    reportType: z.enum(reportTypes).default('STUDENT'),
    includeDetails: z.boolean().default(false),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (d) => d.reportType !== 'DAY' || !!d.filters.day,
    'Choose a Learning Day for a Day-wise report',
  );
export const MAX_EXPORT_ROWS = 20000,
  MAX_EXPORT_STUDENTS = 2000,
  MAX_EXPORT_BYTES = 10 * 1024 * 1024;
export interface ReportRow {
  studentId: string;
  roll: string;
  name: string;
  year: number | null;
  college: string;
  course: string;
  batch: string;
  assignmentId: string;
  day: number;
  problem: string;
  platform: string;
  difficulty: string;
  problemKey: string;
  status: string;
  verification: string;
  acceptedAt: string | null;
  evidence: string | null;
  lastSync: string | null;
  lastSuccess: string | null;
}
export interface ReportStudent {
  id: string;
  roll: string;
  name: string;
  year: number | null;
  lastSuccess: string | null;
}
type Value = string | number | Date | null;
interface Sheet {
  name: string;
  headers: string[];
  rows: Value[][];
  percent: number[];
  dates?: number[];
}
const fail = (code: string, message: string, status = 422): never => {
  throw new AppError(status, code, message);
};
export const reportMetrics = (rows: Pick<ReportRow, 'status'>[]) => {
  const assigned = rows.length,
    solved = rows.filter((r) => r.status === 'SOLVED_VERIFIED').length,
    attempted = rows.filter((r) => r.status === 'ATTEMPTED_VERIFIED').length,
    unavailable = rows.filter(
      (r) => r.status === 'VERIFICATION_UNAVAILABLE',
    ).length;
  return {
    assigned,
    solved,
    attempted,
    noVerifiedSolve: assigned - solved - unavailable,
    unavailable,
    completion: assigned ? solved / assigned : null,
    coverage: assigned ? (assigned - unavailable) / assigned : null,
  };
};
const metricsValues = (rows: ReportRow[]): Value[] => {
  const m = reportMetrics(rows);
  return [
    m.assigned,
    m.solved,
    m.attempted,
    m.noVerifiedSolve,
    m.unavailable,
    m.completion,
    m.coverage,
  ];
};
const metricHeaders = [
  'Assigned opportunities',
  'Verified solved',
  'Verified attempted',
  'No verified solve (checked)',
  'Verification unavailable',
  'Verified completion (%)',
  'Verification coverage (%)',
];
export const safeReportText = (v: string) =>
  /^(?:\s*[=+@\-]|[\t\r\n])/.test(v) ? "'" + v : v;
const date = (v: string | null) => (v ? new Date(v) : null);
const contextHeaders = ['College', 'Course', 'Batch'];
const year = (v: number | null): Value => v ?? 'Not provided';
export async function buildProgressReport(
  context: {
    college: string;
    course: string;
    batch: string;
    exportedAt: string;
    assignedProblems: number;
    students: ReportStudent[];
    rows: ReportRow[];
  },
  type: ReportType,
  format: 'CSV' | 'XLSX',
  includeDetails = false,
) {
  const { rows, students } = context;
  if (rows.length > MAX_EXPORT_ROWS)
    fail(
      'EXPORT_TOO_LARGE',
      'More than 20000 matching assignment rows. Refine Learning Day, platform or Student filters.',
      413,
    );
  if (
    !students.length ||
    (!rows.length && type !== 'BATCH' && type !== 'COMPLETE')
  )
    fail(
      'NO_REPORT_DATA',
      'No eligible records match these report filters.',
      404,
    );
  const prefix = [context.college, context.course, context.batch];
  const studentSheet: Sheet = {
    name: 'Student Progress',
    headers: [
      'Batch',
      'Student',
      'Roll number',
      'College',
      'Course',
      'Year of Study',
      ...['Assigned problems', ...metricHeaders.slice(1)],
      'Last successful synchronization',
    ],
    rows: students.map((s) => {
      const own = rows.filter((r) => r.studentId === s.id);
      return [
        context.batch,
        s.name,
        s.roll,
        context.college,
        context.course,
        year(s.year),
        ...metricsValues(own),
        date(s.lastSuccess),
      ];
    }),
    percent: [11, 12],
    dates: [13],
  };
  const grouped = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = row.studentId + ':' + row.day;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const daySheet: Sheet = {
    name: 'Day-wise Progress',
    headers: [
      ...contextHeaders,
      'Roll number',
      'Student',
      'Year of Study',
      'Learning Day',
      ...['Assigned problems', ...metricHeaders.slice(1)],
      'Last successful synchronization',
    ],
    rows: [...grouped.values()].map((group) => {
      const first = group[0]!;
      return [
        ...prefix,
        first.roll,
        first.name,
        year(first.year),
        first.day,
        ...metricsValues(group),
        date(
          group
            .map((r) => r.lastSuccess)
            .filter((v): v is string => !!v)
            .sort()
            .at(-1) ?? null,
        ),
      ];
    }),
    percent: [12, 13],
    dates: [14],
  };
  const problems = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const group = problems.get(row.assignmentId) ?? [];
    group.push(row);
    problems.set(row.assignmentId, group);
  }
  const problemSheet: Sheet = {
    name: 'Problem-wise Progress',
    headers: [
      ...contextHeaders,
      'Learning Day',
      'Problem',
      'Platform',
      'Difficulty',
      'Canonical problem identifier',
      'Assignment identity',
      'Eligible Students',
      'Verified solved',
      'Verified attempted',
      'No verified solve (checked)',
      'Verification unavailable',
      'Verified completion (%)',
      'Verification coverage (%)',
    ],
    rows: [...problems.values()].map((group) => {
      const r = group[0]!,
        m = reportMetrics(group);
      return [
        ...prefix,
        r.day,
        r.problem,
        r.platform,
        r.difficulty,
        r.problemKey,
        r.assignmentId,
        new Set(group.map((v) => v.studentId)).size,
        m.solved,
        m.attempted,
        m.noVerifiedSolve,
        m.unavailable,
        m.completion,
        m.coverage,
      ];
    }),
    percent: [14, 15],
  };
  const detailed: Sheet = {
    name: 'Detailed Progress',
    headers: [
      ...contextHeaders,
      'Roll number',
      'Student',
      'Year of Study',
      'Learning Day',
      'Problem',
      'Platform',
      'Difficulty',
      'Canonical problem identifier',
      'Assignment identity',
      'Progress status',
      'External account verification status',
      'Accepted submission timestamp',
      'Evidence reference',
      'Last synchronization',
      'Last successful synchronization',
    ],
    rows: rows.map((r) => [
      ...prefix,
      r.roll,
      r.name,
      year(r.year),
      r.day,
      r.problem,
      r.platform,
      r.difficulty,
      r.problemKey,
      r.assignmentId,
      r.status,
      r.verification,
      date(r.acceptedAt),
      r.evidence,
      date(r.lastSync),
      date(r.lastSuccess),
    ]),
    percent: [],
    dates: [14, 16, 17],
  };
  const m = reportMetrics(rows);
  const summary: Sheet = {
    name: 'Summary',
    headers: ['Metric', 'Value'],
    rows: [
      ['College', context.college],
      ['Course', context.course],
      ['Batch', context.batch],
      ['Export timestamp (UTC)', new Date(context.exportedAt)],
      ['Total eligible Students', students.length],
      ['Assigned problems (distinct assignments)', context.assignedProblems],
      ['Total assignment opportunities', m.assigned],
      ['Verified solved', m.solved],
      ['Verified attempted', m.attempted],
      ['No verified solve (checked)', m.noVerifiedSolve],
      ['Verification unavailable', m.unavailable],
      ['Verified completion (%)', m.completion],
      ['Verification coverage (%)', m.coverage],
      [
        'Counting policy',
        'Attempted is a subset of checked no-verified-solve; unavailable is separate. No statement that a Student did not solve.',
      ],
      [
        'Completion denominator',
        'Matching Student × assignment opportunities; unavailable remains in the denominator.',
      ],
      [
        'Date policy',
        'UTC; accepted timestamp for solves, otherwise first verified attempt; unavailable records have no inferred submission date.',
      ],
    ],
    percent: [],
  };
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b),
    platforms = [...new Set(rows.map((r) => r.platform))].sort();
  for (const day of days) {
    const x = reportMetrics(rows.filter((r) => r.day === day));
    summary.rows.push(
      ['Day ' + day + ' assignment opportunities', x.assigned],
      ['Day ' + day + ' verified solved', x.solved],
    );
  }
  for (const platform of platforms) {
    const x = reportMetrics(rows.filter((r) => r.platform === platform));
    summary.rows.push(
      [platform + ' assignment opportunities', x.assigned],
      [platform + ' verified solved', x.solved],
      [platform + ' unavailable', x.unavailable],
    );
  }
  const dayAggregate: Sheet = {
    name: 'Day-wise Progress',
    headers: ['Learning Day', ...metricHeaders],
    rows: days.map((d) => [
      d,
      ...metricsValues(rows.filter((r) => r.day === d)),
    ]),
    percent: [6, 7],
  };
  const platformSheet: Sheet = {
    name: 'Platform Progress',
    headers: ['Platform', ...metricHeaders],
    rows: platforms.map((p) => [
      p,
      ...metricsValues(rows.filter((r) => r.platform === p)),
    ]),
    percent: [6, 7],
  };
  let sheets: Sheet[] =
    type === 'COMPLETE'
      ? [summary, studentSheet, daySheet, problemSheet, detailed]
      : type === 'BATCH'
        ? [summary, dayAggregate, platformSheet, problemSheet]
        : type === 'DAY'
          ? [daySheet]
          : type === 'PROBLEM'
            ? [problemSheet, ...(includeDetails ? [detailed] : [])]
            : [detailed];
  // Legacy calls can request the Student totals via explicit internal default; public Student report is per assignment.
  if (type === 'STUDENT' && !includeDetails) sheets = [studentSheet, detailed];
  const batchFlat: Sheet = {
    name: 'Batch Progress',
    headers: [
      'Record type',
      ...contextHeaders,
      'Learning Day',
      'Platform',
      'Problem',
      'Eligible Students',
      'Distinct assigned problems',
      ...metricHeaders,
      'Export timestamp (UTC)',
    ],
    percent: [14, 15],
    dates: [16],
    rows: [
      [
        'OVERALL',
        ...prefix,
        null,
        null,
        null,
        students.length,
        context.assignedProblems,
        ...metricsValues(rows),
        new Date(context.exportedAt),
      ],
    ],
  };
  for (const day of days) {
    const group = rows.filter((r) => r.day === day);
    batchFlat.rows.push([
      'DAY',
      ...prefix,
      day,
      null,
      null,
      new Set(group.map((r) => r.studentId)).size,
      new Set(group.map((r) => r.assignmentId)).size,
      ...metricsValues(group),
      new Date(context.exportedAt),
    ]);
  }
  for (const platform of platforms) {
    const group = rows.filter((r) => r.platform === platform);
    batchFlat.rows.push([
      'PLATFORM',
      ...prefix,
      null,
      platform,
      null,
      new Set(group.map((r) => r.studentId)).size,
      new Set(group.map((r) => r.assignmentId)).size,
      ...metricsValues(group),
      new Date(context.exportedAt),
    ]);
  }
  for (const group of problems.values()) {
    const first = group[0]!;
    batchFlat.rows.push([
      'PROBLEM',
      ...prefix,
      first.day,
      first.platform,
      first.problem,
      new Set(group.map((r) => r.studentId)).size,
      1,
      ...metricsValues(group),
      new Date(context.exportedAt),
    ]);
  }
  let buffer: Buffer;
  if (format === 'CSV') {
    const sheet =
      type === 'COMPLETE'
        ? detailed
        : type === 'BATCH'
          ? batchFlat
          : type === 'STUDENT'
            ? detailed
            : type === 'PROBLEM' && includeDetails
              ? detailed
              : sheets[0]!;
    const cell = (value: Value, column: number) => {
      let text: string;
      if (value === null) text = 'N/A';
      else if (value instanceof Date) text = value.toISOString();
      else if (typeof value === 'number')
        text = String(
          sheet.percent.includes(column)
            ? Math.round(value * 10000) / 100
            : value,
        );
      else text = safeReportText(value);
      return '"' + text.replaceAll('"', '""') + '"';
    };
    buffer = Buffer.from(
      '﻿' +
        [
          sheet.headers
            .map((v) => '"' + v.replaceAll('"', '""') + '"')
            .join(','),
          ...sheet.rows.map((row) => row.map(cell).join(',')),
        ].join('\r\n'),
    );
  } else {
    const book = new ExcelJS.Workbook();
    book.creator = 'Algora';
    book.created = new Date(context.exportedAt);
    for (const data of sheets) {
      const sheet = book.addWorksheet(data.name, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.addRow(data.headers);
      for (const row of data.rows)
        sheet.addRow(
          row.map((v) =>
            typeof v === 'string' ? safeReportText(v) : (v ?? 'N/A'),
          ),
        );
      sheet.columns = data.headers.map((header, i) => ({
        width: Math.min(48, Math.max(16, header.length + 3)),
        key: String(i),
      }));
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF101B2B' },
      };
      sheet.getRow(1).height = 30;
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: data.headers.length },
      };
      for (const index of data.percent)
        sheet.getColumn(index + 1).numFmt = '0.00%';
      for (const index of data.dates ?? [])
        sheet.getColumn(index + 1).numFmt = 'yyyy-mm-dd hh:mm:ss "UTC"';
      if (data.name === 'Summary') {
        sheet.getColumn(1).width = 48;
        sheet.getColumn(2).width = 90;
        for (let i = 2; i <= sheet.rowCount; i++) {
          const row = sheet.getRow(i);
          row.font = { bold: true };
          if (
            String(row.getCell(1).value).endsWith('(%)') &&
            typeof row.getCell(2).value === 'number'
          )
            row.getCell(2).numFmt = '0.00%';
          if (row.getCell(2).value instanceof Date)
            row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss "UTC"';
        }
      }
    }
    buffer = Buffer.from(await book.xlsx.writeBuffer());
  }
  if (buffer.length > MAX_EXPORT_BYTES)
    fail(
      'EXPORT_TOO_LARGE',
      'Prepared report exceeds 10 MiB. Refine the filters.',
      413,
    );
  const batch =
    context.batch
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'Batch';
  const suffix =
    type === 'COMPLETE'
      ? 'Complete_Report'
      : type === 'DAY'
        ? 'Day_' + String(rows[0]?.day ?? '').padStart(2, '0') + '_Progress'
        : type[0] + type.slice(1).toLowerCase() + '_Progress';
  return {
    filename: 'Algora_' + batch + '_' + suffix + '.' + format.toLowerCase(),
    mime:
      format === 'CSV'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buffer.toString('base64'),
    rowCount: rows.length,
    studentCount: students.length,
    reportType: type,
  };
}
