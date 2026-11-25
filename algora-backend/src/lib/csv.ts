import { badRequest } from './errors';

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 2000;

/** Minimal RFC4180 parser (quotes, escaped quotes, CRLF, BOM). Returns header-keyed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  if (Buffer.byteLength(text) > MAX_CSV_BYTES) throw badRequest('CSV too large');
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (q) throw badRequest('Malformed CSV: unterminated quote');
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw badRequest('CSV needs a header and at least one row');
  if (rows.length - 1 > MAX_CSV_ROWS) throw badRequest(`CSV has more than ${MAX_CSV_ROWS} rows`);
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]/g, ''));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Neutralise spreadsheet formula injection when exporting untrusted values. */
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
