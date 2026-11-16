import ExcelJS from 'exceljs';
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^(?:\s*[=+@\-]|[\t\r\n])/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export async function attendanceFile(
  headers: string[],
  data: (string | number)[][],
  format: 'CSV' | 'XLSX',
  numeric = false,
) {
  let buffer: Buffer, mime: string;
  if (format === 'CSV') {
    buffer = Buffer.from(
      '\ufeff' +
        [headers, ...data]
          .map((row) => row.map(csvCell).join(','))
          .join('\r\n'),
    );
    mime = 'text/csv;charset=utf-8';
  } else {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Attendance');
    sheet.addRow(headers);
    for (const row of data)
      sheet.addRow(row.map((v) => (numeric ? v : String(v))));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((col) => {
      col.width = 24;
    });
    buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return { mime, base64: buffer.toString('base64') };
}
