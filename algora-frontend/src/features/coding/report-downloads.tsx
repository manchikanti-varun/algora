'use client';
import { useState } from 'react';
import { z } from 'zod';
import { apiMutate, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
const types = [
  ['DAY', 'Day-wise'],
  ['PROBLEM', 'Problem-wise'],
  ['STUDENT', 'Student-wise'],
  ['BATCH', 'Batch-wise'],
  ['COMPLETE', 'Complete Batch'],
] as const;
const fileSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(120)
    .refine((v) => !/[\\/\u0000-\u001f]/.test(v)),
  mime: z.string(),
  base64: z.string().max(14 * 1024 * 1024),
  rowCount: z.number().optional(),
});
export function ReportDownloads({
  batchId,
  filters,
}: {
  batchId: string;
  filters: Record<string, unknown>;
}) {
  const [type, setType] = useState<string>('COMPLETE'),
    [details, setDetails] = useState(false),
    [roll, setRoll] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [lastFormat, setLastFormat] = useState<'CSV' | 'XLSX'>('XLSX');
  async function download(format: 'CSV' | 'XLSX') {
    setLastFormat(format);
    setMessage('');
    setFailed(false);
    if (type === 'DAY' && !filters.day) {
      setMessage('Choose a Learning Day before downloading a Day-wise report.');
      setFailed(true);
      return;
    }
    setBusy(true);
    try {
      // Display pagination is intentionally absent from the export request.
      const { page, pageSize, assignmentPage, ...matching } = filters;
      void page;
      void pageSize;
      void assignmentPage;
      const result = await apiMutate(
        '/batches/' + batchId + '/progress/export',
        'POST',
        fileSchema,
        {
          reportType: type,
          includeDetails: details,
          format,
          confirmed: true,
          filters: {
            ...matching,
            rollNumber: roll || undefined,
            studentName: name || undefined,
          },
        },
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) =>
          c.charCodeAt(0),
        ),
        url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setMessage(
        'Download ready: ' +
          result.filename +
          (result.rowCount !== undefined
            ? ' · ' + result.rowCount + ' matching assignment rows'
            : ''),
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof ApiError
          ? error.status === 403
            ? 'Permission denied. Current College progress.view authority is required.'
            : error.code === 'EXPORT_TOO_LARGE'
              ? 'Export too large. Refine the Learning Day, platform, Student or status filters.'
              : error.code === 'NO_REPORT_DATA'
                ? 'No matching records for these filters.'
                : error.message
          : 'Export failed. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="student-card" aria-label="Progress report downloads">
      <h2>Download progress reports</h2>
      <p>
        Downloads include all matching authorized records across roster and
        assignment pages. Complete Excel has five worksheets; Complete CSV is
        one flat assignment-detail file. Limits: 2,000 roster members, 20,000
        matching assignment rows and 10 MiB per file. Larger exports require
        narrower filters.
      </p>
      <div className="coding-filters">
        <label>
          Report type
          <select
            value={type}
            disabled={busy}
            onChange={(e) => {
              setType(e.target.value);
              setMessage('');
            }}
          >
            {types.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Report Student roll number
          <input
            maxLength={10}
            pattern="[A-Za-z0-9]*"
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Report Student name
          <input
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      {type === 'PROBLEM' && (
        <label>
          <input
            type="checkbox"
            checked={details}
            onChange={(e) => setDetails(e.target.checked)}
            disabled={busy}
          />{' '}
          Include Student/problem breakdown (CSV uses flat detail rows)
        </label>
      )}
      <div className="admin-actions">
        <Button disabled={busy} onClick={() => void download('XLSX')}>
          Download Excel
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void download('CSV')}
        >
          Download CSV
        </Button>
        {failed && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void download(lastFormat)}
          >
            Retry download
          </Button>
        )}
      </div>
      {busy && <p role="status">Generating complete report…</p>}
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
      <p>
        Completion divides verified solves by matching Student × assignment
        opportunities. “No verified solve (checked)” includes verified
        unsuccessful attempts, excludes unavailable verification, and never
        claims a Student did not solve.
      </p>
    </section>
  );
}
