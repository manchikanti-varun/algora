import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { AppError } from '../middleware/errors.js';
import { previewSchema, type Row, type EnrollmentRecord } from './contracts.js';
const fail = (message: string): never => {
  throw new AppError(400, 'INVALID_IMPORT', message);
};
export const MAX_ROWS = 200,
  MAX_FILE_BYTES = 1024 * 1024;
export function boundedRows(rows: Row[]) {
  if (!rows.length || rows.length > MAX_ROWS)
    fail('Provide between 1 and 200 nonblank rows');
  return rows;
}
function header(values: unknown[]) {
  const indices = values
    .map((v, i) =>
      typeof v === 'string' &&
      ['rollnumber', 'rollno'].includes(v.replace(/[\s_]/g, '').toLowerCase())
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  if (indices.length !== 1) fail('Exactly one Roll Number column is required');
  return indices[0]!;
}
export async function parseImport(input: unknown): Promise<{
  rows: Row[];
  warnings: string[];
  source: EnrollmentRecord['source'];
}> {
  const d = previewSchema.parse(input);
  if (d.kind === 'PASTE')
    return {
      rows: boundedRows(
        d.text
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((value, i) => ({ row: i + 1, value: value.slice(0, 100) })),
      ),
      warnings: [],
      source: 'BULK_PASTE',
    };
  if (
    !d.base64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      d.base64,
    )
  )
    fail('Invalid file encoding');
  const data = Buffer.from(d.base64, 'base64');
  if (data.length > MAX_FILE_BYTES) fail('File must be at most 1 MiB');
  try {
    let table: unknown[][];
    let rows: Row[] = [];
    const warnings: string[] = [];
    if (d.kind === 'CSV') {
      const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(data);
      table = parse(utf8, {
        bom: true,
        skip_empty_lines: true,
        max_record_size: 8192,
        relax_column_count: false,
      }) as unknown[][];
      const index = header(table[0] ?? []);
      if (table[0]!.length > 1)
        warnings.push('Extra columns are ignored; only Roll Number is used.');
      rows = table
        .slice(1)
        .filter((r) => r.some((v) => String(v ?? '').trim()))
        .map((r, i) => ({
          row: i + 2,
          value: String(r[index] ?? '').slice(0, 100),
        }));
    } else {
      let bytes = 0,
        entries = 0;
      const unpacked = unzipSync(data, {
        filter: (file) => {
          bytes += file.originalSize;
          entries++;
          if (
            bytes > 8 * 1024 * 1024 ||
            entries > 500 ||
            file.originalSize > 4 * 1024 * 1024
          )
            fail('Workbook expands beyond safe limits');
          return true;
        },
      });
      const book = new ExcelJS.Workbook();
      // Feed the workbook parser a bounded, re-packed archive rather than trusting
      // original ZIP size metadata a second time.
      if (
        Object.values(unpacked).reduce((n, v) => n + v.length, 0) >
        8 * 1024 * 1024
      )
        fail('Workbook expands beyond safe limits');
      await book.xlsx.load(
        Buffer.from(zipSync(unpacked, { level: 0 })) as never,
      );
      const sheet = book.worksheets[0] ?? fail('Workbook has no worksheet');
      if (sheet.rowCount > MAX_ROWS + 1)
        fail('Workbook has more than 200 data rows');
      const headers: unknown[] = [];
      sheet
        .getRow(1)
        .eachCell({ includeEmpty: true }, (c) => headers.push(c.value));
      const index = header(headers) + 1;
      if (headers.length > 1)
        warnings.push('Extra columns are ignored; only Roll Number is used.');
      warnings.push('Only the first worksheet is imported.');
      sheet.eachRow((row, n) => {
        if (n === 1 || !row.hasValues) return;
        const c = row.getCell(index);
        let value = '',
          error: string | undefined;
        if (typeof c.value === 'string') value = c.value;
        else if (
          typeof c.value === 'number' &&
          Number.isSafeInteger(c.value) &&
          /^\d{10}$/.test(String(c.value)) &&
          ['General', '0'].includes(c.numFmt ?? 'General')
        )
          value = String(c.value);
        else if (c.value === null || c.value === undefined) value = '';
        else
          error =
            'Use plain text roll numbers; formulas, links and ambiguous numeric formats are rejected';
        if (!value.trim() && !error) return;
        rows.push({
          row: n,
          value: value.slice(0, 100),
          ...(error ? { error } : {}),
        });
      });
    }
    return {
      rows: boundedRows(rows),
      warnings,
      source: d.kind === 'CSV' ? 'CSV' : 'EXCEL',
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    return fail('Malformed or unsupported import file');
  }
}
