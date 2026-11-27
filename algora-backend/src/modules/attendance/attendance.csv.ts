import { badRequest } from '../../lib/errors';
import { normalizeRoll } from '../../lib/normalize';
import { DEFAULT_TIMEZONE, wallTimeToDate } from './attendance.time';

/** Configurable, additive limits. Raw uploads are never stored. */
export const MAX_CSV_BYTES = Number(process.env.ATTENDANCE_CSV_MAX_BYTES ?? 2_000_000);
export const MAX_CSV_ROWS = Number(process.env.ATTENDANCE_CSV_MAX_ROWS ?? 5000);
export const ROLL_PATTERN = /^[A-Z0-9]{10}$/;

export interface RawCsvRow { line: number; cells: string[] }
export interface ParsedCsv { header: string[] | null; rows: RawCsvRow[] }

const normHeader = (v: string) => v.trim().toLowerCase().replace(/[\s_.\-/\\]+/g, '');

/** Header names scanners commonly export for the scanned value. Checked in priority order (most specific first). */
const ROLL_HEADERS = [
  'rollnumber', 'rollno', 'rollnum', 'roll', 'studentrollnumber', 'registrationnumber', 'regno', 'registrationno',
  'qrcode', 'qrcontent', 'qrdata', 'qr', 'barcode', 'barcodecontent', 'scannedcode', 'scannedvalue', 'scanneddata',
  'data', 'text', 'value', 'code', 'content', 'scan',
];
const TIME_HEADERS = ['scannedat', 'scanat', 'scantime', 'scannedtime', 'scannedon', 'timestamp', 'datetime', 'datetime', 'time', 'date', 'at'];

/**
 * RFC4180-style CSV parser (quotes, escaped quotes, CRLF/LF, UTF-8 BOM, quoted newlines). A naive comma split is never
 * used. Blank rows are skipped. The first non-empty row is returned as `header` only when it looks like a header.
 */
export function parseAttendanceCsv(text: string): ParsedCsv {
  if (typeof text !== 'string') throw badRequest('Upload a CSV file.');
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw badRequest(`The CSV file is larger than ${Math.round(MAX_CSV_BYTES / 1024)} KB.`);
  const src = text.replace(/^\uFEFF/, '');
  const rows: RawCsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const pushRow = () => {
    cells.push(cell);
    cell = '';
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: startLine, cells });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === ',') {
      cells.push(cell); cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      pushRow();
      line++;
      startLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) throw badRequest('The CSV file is malformed: a quoted value is not closed.');
  if (cell !== '' || cells.length) pushRow();

  if (!rows.length) throw badRequest('The CSV file is empty.');
  if (rows.length > MAX_CSV_ROWS + 1) throw badRequest(`The CSV has more than ${MAX_CSV_ROWS} attendance rows.`);

  const first = rows[0];
  const looksLikeHeader = first.cells.some((c) => {
    const n = normHeader(c);
    return ROLL_HEADERS.includes(n) || TIME_HEADERS.includes(n);
  });
  if (!looksLikeHeader) return { header: null, rows };
  const header = first.cells.map((c) => c.trim());
  const data = rows.slice(1);
  if (!data.length) throw badRequest('The CSV contains a header but no attendance rows.');
  return { header, rows: data };
}

export interface ColumnResolution {
  rollIndex: number | null;
  timeIndex: number | null;
  /** True when the roll-number column could not be identified confidently. The UI must ask for a mapping. */
  ambiguous: boolean;
  header: string[] | null;
  /** Detected columns for a mapping UI: index + display name. */
  columns: { index: number; label: string; kind: 'roll' | 'time' | 'other' }[];
}

/**
 * Resolve which column holds the scanned value. Never guesses silently: if several plausible columns exist, or a
 * multi-column file has no header, the caller is told the mapping is ambiguous.
 */
export function resolveColumns(parsed: ParsedCsv, mapping?: { rollColumn?: number | null; timestampColumn?: number | null }): ColumnResolution {
  const { header, rows } = parsed;
  const width = Math.max(...rows.map((r) => r.cells.length), header?.length ?? 0);
  const columns = Array.from({ length: width }, (_, index) => {
    const raw = header?.[index]?.trim();
    const n = raw ? normHeader(raw) : '';
    return { index, label: raw || `Column ${index + 1}`, kind: (ROLL_HEADERS.includes(n) ? 'roll' : TIME_HEADERS.includes(n) ? 'time' : 'other') as 'roll' | 'time' | 'other' };
  });

  const explicit = (v: number | null | undefined) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < width ? v : null);
  let rollIndex = explicit(mapping?.rollColumn);
  if (rollIndex === null && mapping?.rollColumn === undefined) {
    if (header) {
      for (const name of ROLL_HEADERS) {
        const found = header.map((h, i) => (normHeader(h) === name ? i : -1)).filter((i) => i >= 0);
        if (found.length === 1) { rollIndex = found[0]; break; }
        if (found.length > 1) break; // duplicate header names: ambiguous
      }
    } else if (width === 1) {
      rollIndex = 0;
    }
  }
  let timeIndex = explicit(mapping?.timestampColumn);
  if (timeIndex === null && mapping?.timestampColumn === undefined && header) {
    for (const name of TIME_HEADERS) {
      const found = header.map((h, i) => (normHeader(h) === name ? i : -1)).filter((i) => i >= 0);
      if (found.length === 1) { timeIndex = found[0]; break; }
    }
  }
  const ambiguous = rollIndex === null;
  return { rollIndex, timeIndex, ambiguous, header, columns };
}

/** Parse a scanner timestamp. Wall-clock values without a zone are interpreted in the session timezone. */
export function parseScanTime(raw: string | undefined, tz = DEFAULT_TIMEZONE): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (iso) {
    const [, y, mo, d, h, mi, s, zone] = iso;
    if (zone === 'Z') return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}Z`);
    if (zone) {
      const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${zone.slice(0, 3)}:${zone.slice(-2)}`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return wallTimeToDate(+y, +mo, +d, +h, +mi, +(s ?? 0), tz);
  }
  const slash = /^(\d{4})\/(\d{2})\/(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (slash) {
    const [, y, mo, d, h, mi, s] = slash;
    return wallTimeToDate(+y, +mo, +d, +h, +mi, +(s ?? 0), tz);
  }
  const dayFirst = /^(\d{2})[-/](\d{2})[-/](\d{4})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (dayFirst) {
    const [, d, mo, y, h, mi, s] = dayFirst;
    return wallTimeToDate(+y, +mo, +d, +h, +mi, +(s ?? 0), tz);
  }
  const epoch = /^\d{10,13}$/.exec(v);
  if (epoch) {
    const n = Number(v);
    return new Date(v.length === 10 ? n * 1000 : n);
  }
  return null;
}

export const normalizeAttendanceRoll = (raw: string) => normalizeRoll(raw ?? '');
export const isValidRoll = (roll: string) => ROLL_PATTERN.test(roll);
