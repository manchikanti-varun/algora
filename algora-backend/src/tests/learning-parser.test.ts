import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { parseImport, MAX_FILE_BYTES } from '../learning/parser.js';
const csv = (value: string) => ({
  kind: 'CSV',
  base64: Buffer.from(value).toString('base64'),
});
async function xlsx(rows: unknown[][]) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Roster');
  for (const row of rows) sheet.addRow(row);
  const second = book.addWorksheet('Ignored');
  second.addRow(['Email']);
  return {
    kind: 'XLSX',
    base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
  };
}
describe('bounded safe roll-only import parsing', () => {
  it('accepts newline/comma/whitespace paste and preserves row order', async () => {
    expect(
      (
        await parseImport({
          kind: 'PASTE',
          text: '23a91a05b2,24CS001A12\n22B81A1234\t0000000001',
        })
      ).rows.map((r) => r.value),
    ).toEqual(['23a91a05b2', '24CS001A12', '22B81A1234', '0000000001']);
  });
  it.each(['Roll Number', 'RollNumber', 'Roll_No', 'Roll No'])(
    'accepts header alias %s',
    async (header) => {
      expect(
        (
          await parseImport(
            csv('\uFEFF' + header + '\n23A91A05B2\n\n0000000001'),
          )
        ).rows.map((r) => r.value),
      ).toEqual(['23A91A05B2', '0000000001']);
    },
  );
  it('handles quoted CSV fields and ignores extra PII columns with a warning', async () => {
    const p = await parseImport(
      csv(
        'Roll Number,Email\n"23A91A05B2","not-retained@example.test"\n"0000000001","ignored@example.test"',
      ),
    );
    expect(p.warnings.length).toBe(1);
    expect(JSON.stringify(p)).not.toContain('@');
    expect(p.rows[1]?.value).toBe('0000000001');
  });
  it('does not accept email/phone as enrollment identifiers or ambiguous duplicate roll headers', async () => {
    for (const text of [
      'Email\nstudent@example.test',
      'Phone Number\n12025550123',
      'RollNumber,Roll_No\n23A91A05B2,24CS001A12',
    ])
      await expect(parseImport(csv(text))).rejects.toMatchObject({
        code: 'INVALID_IMPORT',
      });
  });
  it('rejects malformed UTF-8, encoding and CSV quoting', async () => {
    await expect(
      parseImport({
        kind: 'CSV',
        base64: Buffer.from([0xff, 0xfe, 0xff]).toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    await expect(
      parseImport({ kind: 'CSV', base64: '!bad' }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    await expect(
      parseImport(csv('RollNumber\n"unclosed')),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
  });
  it('enforces file and row limits for paste/CSV', async () => {
    await expect(
      parseImport({
        kind: 'CSV',
        base64: Buffer.alloc(MAX_FILE_BYTES + 1, 65).toString('base64'),
      }),
    ).rejects.toBeDefined();
    await expect(
      parseImport({
        kind: 'PASTE',
        text: Array(201).fill('23A91A05B2').join('\n'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    await expect(
      parseImport(
        csv('RollNumber\n' + Array(201).fill('23A91A05B2').join('\n')),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
  });
  it('parses first XLSX worksheet and preserves string leading zeros', async () => {
    const parsed = await parseImport(
      await xlsx([
        ['Roll Number', 'Extra'],
        ['0000000001', 'ignored'],
        ['23A91A05B2', 'ignored'],
      ]),
    );
    expect(parsed.source).toBe('EXCEL');
    expect(parsed.rows[0]?.value).toBe('0000000001');
    expect(parsed.warnings).toContain('Only the first worksheet is imported.');
  });
  it('rejects formulas/hyperlinks and ambiguous numeric formatting as identifiers without executing', async () => {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Roster');
    sheet.addRow(['Roll Number']);
    sheet.addRow([{ formula: '"23A91A05B2"', result: '23A91A05B2' }]);
    sheet.addRow([
      { text: '23A91A05B3', hyperlink: 'https://example.test/private' },
    ]);
    sheet.addRow([1]);
    sheet.getCell('A4').numFmt = '0000000000';
    const parsed = await parseImport({
      kind: 'XLSX',
      base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((r) => !!r.error)).toBe(true);
  });
  it('accepts unambiguous ten-digit integer cells but never pads short numeric rolls', async () => {
    const parsed = await parseImport(
      await xlsx([['RollNumber'], [1234567890], [123]]),
    );
    expect(parsed.rows[0]?.value).toBe('1234567890');
    expect(parsed.rows[1]?.error).toBeTruthy();
  });
  it('rejects malformed workbooks and oversized expanded archives', async () => {
    await expect(
      parseImport({
        kind: 'XLSX',
        base64: Buffer.from('not a zip').toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
    const bomb = zipSync({
      'xl/worksheets/sheet1.xml': strToU8('a'.repeat(5 * 1024 * 1024)),
    });
    await expect(
      parseImport({
        kind: 'XLSX',
        base64: Buffer.from(bomb).toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
  });
  it('rejects unsupported formats and oversized worksheet row ranges', async () => {
    await expect(
      parseImport({ kind: 'XLS', base64: 'AAAA' }),
    ).rejects.toBeDefined();
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Roster');
    sheet.addRow(['RollNumber']);
    sheet.getCell('A202').value = '23A91A05B2';
    await expect(
      parseImport({
        kind: 'XLSX',
        base64: Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT' });
  });
});
