import { beforeEach, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { setupCoding } from './coding-fixtures.js';
import {
  buildProgressReport,
  reportMetrics,
  exportSchema,
  MAX_EXPORT_ROWS,
  type ReportRow,
} from '../coding/reports.js';
let f: Awaited<ReturnType<typeof setupCoding>>;
beforeEach(async () => {
  f = await setupCoding();
});
async function workbook(
  type: 'DAY' | 'PROBLEM' | 'STUDENT' | 'BATCH' | 'COMPLETE' = 'COMPLETE',
  filters: Record<string, unknown> = {},
) {
  const result = await f.service.exported(
    f.owner.id,
    f.batch,
    filters,
    'XLSX',
    'test',
    type,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(result.base64, 'base64'));
  return { result, book };
}
it('complete workbook includes all 120 Students across roster pages, with exactly five formatted sheets', async () => {
  for (let i = 1; i < 120; i++) await f.addStudent();
  for (let i = 1; i < 100; i++) {
    const day = {
      ...structuredClone(f.frozen),
      id: i.toString(16).padStart(24, '0'),
      dayNumber: 100 + i,
    };
    f.repo.curriculum.frozen.set(day.id, day);
  }
  const { result, book } = await workbook('COMPLETE', {
    page: 4,
    pageSize: 1,
    assignmentPage: 8,
  });
  expect(result.studentCount).toBe(120);
  expect(result.rowCount).toBe(12000);
  expect(book.worksheets.map((s) => s.name)).toEqual([
    'Summary',
    'Student Progress',
    'Day-wise Progress',
    'Problem-wise Progress',
    'Detailed Progress',
  ]);
  expect(book.getWorksheet('Student Progress')?.rowCount).toBe(121);
  expect(book.getWorksheet('Detailed Progress')?.rowCount).toBe(12001);
  for (const sheet of book.worksheets) {
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getRow(1).font?.bold).toBe(true);
  }
  expect(book.getWorksheet('Problem-wise Progress')?.getCell('J2').value).toBe(
    120,
  );
  expect(book.getWorksheet('Problem-wise Progress')?.getCell('N2').value).toBe(
    120,
  );
  expect(book.getWorksheet('Summary')?.getCell('B8').value).toBe(12000);
  const rolls = new Set<string>();
  book.getWorksheet('Detailed Progress')!.eachRow((row, n) => {
    if (n > 1) rolls.add(String(row.getCell(4).value));
  });
  expect(rolls.size).toBe(120);
}, 60000);
it.each(['DAY', 'PROBLEM', 'STUDENT', 'BATCH', 'COMPLETE'] as const)(
  'exports %s as safe real CSV across display pages',
  async (type) => {
    const result = await f.service.exported(
      f.owner.id,
      f.batch,
      { page: 9, pageSize: 1, ...(type === 'DAY' ? { day: 100 } : {}) },
      'CSV',
      'test',
      type,
    );
    const csv = Buffer.from(result.base64, 'base64').toString();
    expect(csv).toContain('Batch');
    expect(result.rowCount).toBe(1);
    expect(result.filename).toMatch(/^Algora_[A-Za-z0-9_-]+\.csv$/);
    expect(csv).not.toContain('tokenHash');
    expect(csv).not.toContain('ciphertext');
    expect(csv).not.toContain('proofDigest');
  },
);
it('day-wise export uses only the selected Day and includes canonical College metadata', async () => {
  const second = {
    ...structuredClone(f.frozen),
    id: 'a'.repeat(24),
    dayNumber: 101,
  };
  f.repo.curriculum.frozen.set(second.id, second);
  const { book, result } = await workbook('DAY', { day: 101 });
  expect(book.worksheets).toHaveLength(1);
  expect(book.worksheets[0]?.name).toBe('Day-wise Progress');
  expect(book.worksheets[0]?.getCell('G2').value).toBe(101);
  expect(result.rowCount).toBe(1);
  expect(result.filename).toContain('Day_101');
});
it('problem aggregates separate solved, unsuccessful and unavailable coverage with numeric percentage cells', async () => {
  const a = await f.link();
  await f.verify(a.id);
  await f.queue();
  await f.service.processOne();
  await f.addStudent();
  const { book } = await workbook('PROBLEM');
  const s = book.worksheets[0]!;
  expect(s.getCell('J2').value).toBe(2);
  expect(s.getCell('K2').value).toBe(1);
  expect(s.getCell('M2').value).toBe(0);
  expect(s.getCell('N2').value).toBe(1);
  expect(s.getCell('O2').value).toBe(0.5);
  expect(s.getCell('P2').value).toBe(0.5);
  expect(s.getCell('O2').numFmt).toBe('0.00%');
});
it('uses distinct assignment identities for identical problems on different Days', async () => {
  const second = {
    ...structuredClone(f.frozen),
    id: 'a'.repeat(24),
    dayNumber: 101,
  };
  f.repo.curriculum.frozen.set(second.id, second);
  const { book } = await workbook();
  expect(book.getWorksheet('Problem-wise Progress')?.rowCount).toBe(3);
  expect(book.getWorksheet('Summary')?.getCell('B7').value).toBe(2);
  expect(book.getWorksheet('Summary')?.getCell('B8').value).toBe(2);
});
it('Student report contains assignment details, year and safe missing-year values', async () => {
  delete f.repo.curriculum.learning.students.profiles.get(f.student.profile.id)!
    .yearOfStudy;
  const { book } = await workbook('STUDENT');
  expect(book.getWorksheet('Detailed Progress')?.getCell('F2').value).toBe(
    'Not provided',
  );
  expect(book.getWorksheet('Detailed Progress')?.getCell('M2').value).toBe(
    'VERIFICATION_UNAVAILABLE',
  );
  expect(book.getWorksheet('Detailed Progress')?.getCell('O2').value).toBe(
    'N/A',
  );
});
it('Batch report includes summaries for Days, platforms and assigned problems', async () => {
  const { book } = await workbook('BATCH');
  expect(book.worksheets.map((s) => s.name)).toEqual([
    'Summary',
    'Day-wise Progress',
    'Platform Progress',
    'Problem-wise Progress',
  ]);
  expect(book.getWorksheet('Summary')?.getCell('B6').value).toBe(1);
  expect(book.getWorksheet('Summary')?.getCell('B7').value).toBe(1);
});
it('filters by Student name, roll, status and actual College/Course relationships', async () => {
  const other = await f.addStudent();
  f.repo.curriculum.learning.students.profiles.get(other.profile.id)!.fullName =
    'Different Learner';
  const result = await f.service.exported(
    f.owner.id,
    f.batch,
    {
      studentName: 'different',
      rollNumber: other.profile.rollNumber,
      status: 'VERIFICATION_UNAVAILABLE',
      collegeId: f.college,
      courseId: f.course,
    },
    'CSV',
    'test',
    'COMPLETE',
  );
  expect(result.studentCount).toBe(1);
  expect(Buffer.from(result.base64, 'base64').toString()).toContain(
    other.profile.rollNumber,
  );
  await expect(
    f.service.exported(
      f.owner.id,
      f.batch,
      { collegeId: 'a'.repeat(24) },
      'CSV',
      'test',
      'COMPLETE',
    ),
  ).rejects.toMatchObject({ code: 'REPORT_SCOPE_MISMATCH' });
});
it('returns no-matching-data rather than a fabricated empty success', async () => {
  await expect(
    f.service.exported(
      f.owner.id,
      f.batch,
      { studentName: 'no match' },
      'CSV',
      'test',
      'COMPLETE',
    ),
  ).rejects.toMatchObject({ code: 'NO_REPORT_DATA' });
});
it('requires current scoped permissions and rechecks authority before releasing the file', async () => {
  await expect(workbook()).resolves.toBeDefined();
  await expect(
    f.service.exported(f.admin.id, f.batch, {}, 'CSV', 'test', 'COMPLETE'),
  ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
  const transaction = f.repo.transaction.bind(f.repo);
  vi.spyOn(f.repo, 'transaction').mockImplementation(async (work) => {
    f.repo.curriculum.learning.students.admin.auth.users.get(
      f.owner.id,
    )!.accountStatus = 'SUSPENDED';
    return transaction(work);
  });
  await expect(
    f.service.exported(f.owner.id, f.batch, {}, 'CSV', 'test', 'COMPLETE'),
  ).rejects.toMatchObject({ code: 'ACCOUNT_INELIGIBLE' });
});
it('requires a Day and rejects unsupported report/filter values', () => {
  expect(
    exportSchema.safeParse({
      reportType: 'DAY',
      format: 'CSV',
      filters: {},
      confirmed: true,
    }).success,
  ).toBe(false);
  expect(
    exportSchema.safeParse({
      reportType: 'ALL_SECRET_DATA',
      format: 'CSV',
      filters: {},
      confirmed: true,
    }).success,
  ).toBe(false);
  expect(
    exportSchema.safeParse({
      reportType: 'COMPLETE',
      format: 'CSV',
      filters: { sort: 'unsafe' },
      confirmed: true,
    }).success,
  ).toBe(false);
});
it('rejects oversized matching exports before generating any partial file', async () => {
  const row = { status: 'VERIFICATION_UNAVAILABLE' } as ReportRow;
  await expect(
    buildProgressReport(
      {
        college: 'Example College',
        course: 'DSA',
        batch: 'Batch',
        exportedAt: new Date().toISOString(),
        assignedProblems: 1,
        students: [],
        rows: Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => row),
      },
      'COMPLETE',
      'CSV',
    ),
  ).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 413 });
});
it('uses N/A for a zero denominator and never conflates unavailable with checked no-solve', () => {
  expect(reportMetrics([])).toMatchObject({ completion: null, coverage: null });
  expect(
    reportMetrics([
      { status: 'SOLVED_VERIFIED' },
      { status: 'ATTEMPTED_VERIFIED' },
      { status: 'NOT_STARTED' },
      { status: 'VERIFICATION_UNAVAILABLE' },
    ]),
  ).toEqual({
    assigned: 4,
    solved: 1,
    attempted: 1,
    noVerifiedSolve: 2,
    unavailable: 1,
    completion: 0.25,
    coverage: 0.75,
  });
});
it('guards CSV/XLSX literal cells and sanitizes the complete report filename', async () => {
  f.repo.curriculum.learning.students.profiles.get(
    f.student.profile.id,
  )!.fullName = ' 	=HYPERLINK("unsafe")';
  f.repo.curriculum.learning.batches.get(f.batch)!.name =
    '../../Batch / "unsafe"';
  const csv = await f.service.exported(
    f.owner.id,
    f.batch,
    {},
    'CSV',
    'test',
    'COMPLETE',
  );
  expect(csv.filename).not.toMatch(/[\\/]/);
  expect(Buffer.from(csv.base64, 'base64').toString()).toContain(
    "' 	=HYPERLINK",
  );
  const { book } = await workbook('COMPLETE');
  expect(book.getWorksheet('Student Progress')?.getCell('B2').type).toBe(
    ExcelJS.ValueType.String,
  );
  expect(
    String(book.getWorksheet('Student Progress')?.getCell('B2').value),
  ).toContain("' 	=");
});
it('audits the export type and matching assignment count', async () => {
  await workbook('COMPLETE');
  const audit = f.repo.curriculum.learning.students.admin.audits
    .filter((a) => a.action === 'CODING_REPORT_EXPORTED')
    .at(-1)!;
  expect(audit.metadata).toMatchObject({ after: 'COMPLETE', count: 1 });
});

it('enforces the roster cap with a refinement error rather than silently taking the first pages', async () => {
  const original = f.repo.read;
  vi.spyOn(f.repo, 'read', 'get').mockImplementation(() => ({
    ...original,
    curriculum: {
      ...original.curriculum,
      learning: {
        ...original.curriculum.learning,
        enrollments: async () => ({
          items: [],
          total: 2001,
          page: 1,
          pageSize: 50,
          totalPages: 41,
        }),
      },
    },
  }));
  await expect(
    f.service.exported(f.owner.id, f.batch, {}, 'CSV', 'test', 'COMPLETE'),
  ).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 413 });
});
it('represents empty assignment denominators as N/A in a Batch workbook', async () => {
  f.frozen.problemAssignments = [];
  const { book } = await workbook('BATCH');
  const summary = book.getWorksheet('Summary')!;
  let value: unknown;
  summary.eachRow((row) => {
    if (row.getCell(1).value === 'Verified completion (%)')
      value = row.getCell(2).value;
  });
  expect(value).toBe('N/A');
});
it('problem exports can include a detailed Student breakdown', async () => {
  const file = await f.service.exported(
      f.owner.id,
      f.batch,
      {},
      'XLSX',
      'test',
      'PROBLEM',
      true,
    ),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(file.base64, 'base64'));
  expect(book.worksheets.map((s) => s.name)).toEqual([
    'Problem-wise Progress',
    'Detailed Progress',
  ]);
});
