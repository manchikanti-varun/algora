'use client';
import Link from 'next/link';
import { Download, FileUp, RotateCcw, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  Badge, Button, Card, Combobox, DescriptionList, ErrorState, Field, fmtDateTime, InlineSelect, Modal,
  Notice, Pagination, Select, StatusBadge, Tabs, Textarea, useToast, DataTable, EmptyState, type Column,
} from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, ApiError, errorMessage } from '@/lib/api';
import {
  attendanceStatusLabel, fmtAttendanceDate, localNowTime, localToday, sessionLabel,
  type AttendanceCounts, type ClassifiedRow, type PreviewResult, type PresentEntry, type RosterStudent, type SessionType,
} from '@/lib/attendance';
import { loadBatches } from '@/lib/options';

const RESULT: Record<ClassifiedRow['result'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PRESENT: { label: 'Present', tone: 'success' },
  DUPLICATE: { label: 'Duplicate scan', tone: 'warning' },
  UNKNOWN: { label: 'Unknown roll number', tone: 'danger' },
  INVALID: { label: 'Invalid roll number', tone: 'danger' },
  OUT_OF_BATCH: { label: 'Another batch', tone: 'danger' },
  NOT_ELIGIBLE: { label: 'Not eligible', tone: 'warning' },
};

const PAGE = 25;

export function RecordAttendance({ batchId: fixedBatchId, batchName, onRecorded }: { batchId?: string; batchName?: string; onRecorded?: (id: string) => void }) {
  const router = useRouter();
  const toast = useToast();
  const batch = useApi<{ _id: string; name: string }>(fixedBatchId && !batchName ? `/batches/${fixedBatchId}` : null);
  const [selectedBatch, setSelectedBatch] = useState(fixedBatchId ?? '');
  const [date, setDate] = useState(localToday());
  const [sessionType, setSessionType] = useState<SessionType>('MORNING');
  const [time, setTime] = useState(localNowTime());
  const [notes, setNotes] = useState('');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<{ columns: PreviewResult['columns']['columns']; roll: string; stamp: string } | null>(null);
  /** Mapping the user confirmed in the column picker. Persisted so finalization re-parses with the same columns. */
  const [appliedMap, setAppliedMap] = useState<{ rollColumn: number; timestampColumn: number | null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'finalize' | 'draft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const effectiveBatch = fixedBatchId ?? selectedBatch;
  const effectiveBatchName = batchName ?? batch.data?.name;
  const stale = (fn: () => void) => { setPreview(null); setConfirmed(false); setAppliedMap(null); setError(null); fn(); };

  async function readFile(file?: File | null) {
    if (!file) return;
    if (file.size > 2_000_000) { setError('The CSV file is larger than 2 MB.'); return; }
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain/.test(file.type)) { setError('Choose a CSV file exported by your scanner.'); return; }
    const text = await file.text();
    stale(() => { setCsv(text); setFileName(file.name); setMapping(null); });
  }

  const mapBody = useMemo(() => (mapping ? { rollColumn: Number(mapping.roll), timestampColumn: mapping.stamp === '' ? null : Number(mapping.stamp) } : undefined), [mapping]);

  async function doPreview(map = mapBody) {
    if (!effectiveBatch) { setError('Choose a batch.'); return; }
    if (!csv.trim()) { setError('Upload the CSV file exported by your scanner.'); return; }
    setBusy('preview'); setError(null);
    try {
      const r = await api<PreviewResult>('/attendance/preview', {
        method: 'POST', body: { batchId: effectiveBatch, attendanceDate: date, sessionType, attendanceTime: time, csv, columnMap: map },
      });
      setPreview(r); setAppliedMap(map ?? null); setMapping(null); setConfirmed(false);
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { code?: string; columns?: PreviewResult['columns']['columns'] } | undefined) : undefined;
      if (details?.code === 'COLUMN_MAPPING_REQUIRED' && details.columns) {
        setMapping({ columns: details.columns, roll: '', stamp: '' });
        setError('We could not identify the roll-number column. Choose it below, then review again.');
      } else setError(errorMessage(e));
    } finally { setBusy(null); }
  }

  async function save(finalize: boolean) {
    setBusy(finalize ? 'finalize' : 'draft'); setError(null);
    try {
      const r = await api<{ session: { _id: string } }>('/attendance/sessions', {
        method: 'POST',
        body: { batchId: effectiveBatch, attendanceDate: date, sessionType, attendanceTime: time, notes: notes.trim() || undefined, csv, columnMap: appliedMap ?? undefined, finalize },
      });
      toast.success(finalize ? 'Attendance has been recorded successfully.' : 'Attendance saved as a draft.');
      setConfirmed(false);
      if (onRecorded) onRecorded(r.session._id);
      else router.push(`/manage/attendance/sessions/${r.session._id}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const counts: AttendanceCounts | null = preview?.counts ?? null;
  const issueRows = preview ? preview.rows.filter((r) => r.result !== 'PRESENT') : [];

  return (
    <div className="space-y-6">
      <Card title="Attendance details" description="Select the batch, date and session, then upload the CSV exported by your QR scanner.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Combobox label="Batch" labelHidden={false} value={effectiveBatch} selectedLabel={effectiveBatchName} load={loadBatches} disabled={!!fixedBatchId}
            onChange={(value) => stale(() => setSelectedBatch(value))} placeholder="Select a batch" />
          <Field label="Attendance date">
            {(id) => <input id={id} type="date" max={localToday()} value={date} onChange={(e) => stale(() => setDate(e.target.value))}
              className="block w-full rounded-lg border-0 bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />}
          </Field>
          <Field label="Session">
            {() => <InlineSelect label="Session" value={sessionType} onChange={(v) => stale(() => setSessionType(v as SessionType))}
              options={[{ value: 'MORNING', label: 'Morning' }, { value: 'AFTERNOON', label: 'Afternoon' }]} className="h-9 w-full" />}
          </Field>
          <Field label="Attendance time">
            {(id) => <input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="block w-full rounded-lg border-0 bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />}
          </Field>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Scanned roll numbers (CSV)" hint={fileName ? `Selected: ${fileName}` : 'One roll number per row. Timestamps are optional. Files are not stored.'}>
            {(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} id={id} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
                <Button type="button" variant="secondary" icon={<FileUp size={15} aria-hidden />} onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
                {csv && <Button type="button" variant="ghost" size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => { setCsv(''); setFileName(''); setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}>Remove</Button>}
                <a className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-fg hover:underline" href="/api/v1/attendance/template">
                  <Download size={14} aria-hidden />Sample CSV
                </a>
              </div>
            )}
          </Field>
          <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
        </div>
        {mapping && (
          <div className="mt-4 rounded-lg border border-line bg-subtle p-4">
            <p className="text-sm font-medium text-fg">Map the scanned column</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">This file has several columns and no recognisable header. Choose which column holds the scan.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Select label="Roll number column" value={mapping.roll} onChange={(e) => setMapping({ ...mapping, roll: e.target.value })}
                options={[{ value: '', label: 'Select a column' }, ...mapping.columns.map((c) => ({ value: String(c.index), label: `${c.label}${c.kind !== 'other' ? ` (${c.kind})` : ''}` }))]} />
              <Select label="Scan time column (optional)" value={mapping.stamp} onChange={(e) => setMapping({ ...mapping, stamp: e.target.value })}
                options={[{ value: '', label: 'No timestamp column' }, ...mapping.columns.map((c) => ({ value: String(c.index), label: c.label }))]} />
            </div>
            <Button className="mt-3" variant="secondary" size="sm" disabled={mapping.roll === ''} loading={busy === 'preview'}
              onClick={() => void doPreview({ rollColumn: Number(mapping.roll), timestampColumn: mapping.stamp === '' ? null : Number(mapping.stamp) })}>Use these columns</Button>
          </div>
        )}
        {error && <div className="mt-4"><ErrorState title="Attendance not recorded" message={error} /></div>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button icon={<Upload size={15} aria-hidden />} loading={busy === 'preview'} disabled={!!busy || !effectiveBatch || !csv.trim()} onClick={() => void doPreview()}>
            Review attendance
          </Button>
          <Link className="text-[13px] text-fg-muted hover:text-fg hover:underline" href={`/manage/attendance/sessions?batchId=${effectiveBatch}`}>View recorded sessions</Link>
        </div>
      </Card>

      {preview && counts && (
        <Card title="Preview" description="Nothing is saved until you confirm." actions={<Badge tone="warning">Not yet recorded</Badge>}>
          <DescriptionList cols={4} items={[
            { label: 'Batch', value: preview.batch.name },
            { label: 'Date', value: fmtAttendanceDate(preview.attendanceDate) },
            { label: 'Session', value: sessionLabel(preview.sessionType) },
            { label: 'Attendance time', value: time },
            { label: 'Eligible students', value: preview.rosterCount },
            { label: 'Uploaded rows', value: counts.totalRows },
            { label: 'Present', value: <span className="font-medium text-success-fg">{counts.present}</span> },
            { label: 'Absent', value: <span className="font-medium text-danger-fg">{counts.absent}</span> },
          ]} />
          {preview.pendingCount > 0 && (
            <div className="mt-4"><Notice tone="info" title={`${preview.pendingCount} reserved enrollment${preview.pendingCount === 1 ? '' : 's'}`}>
              Students without an account are not counted as present or absent.
            </Notice></div>
          )}
          {preview.existingSession && (
            <div className="mt-4"><Notice tone="warn" title="Attendance has already been recorded for this session">
              <Link className="font-medium text-accent-fg hover:underline" href={`/manage/attendance/sessions/${preview.existingSession._id}`}>Open the existing session</Link> to review it or make a correction. A second session cannot be created for the same batch, date and session.
            </Notice></div>
          )}
          {!!(counts.duplicates || counts.unknown || counts.invalid || counts.outOfBatch || counts.notEligible) && (
            <div className="mt-4">
              <Notice tone="warn" title="Some uploaded rows need attention">
                {counts.duplicates > 0 && `${counts.duplicates} duplicate scan${counts.duplicates === 1 ? '' : 's'}. `}
                {counts.unknown > 0 && `${counts.unknown} unknown roll number${counts.unknown === 1 ? '' : 's'}. `}
                {counts.invalid > 0 && `${counts.invalid} invalid roll number${counts.invalid === 1 ? '' : 's'}. `}
                {counts.outOfBatch > 0 && `${counts.outOfBatch} from another batch. `}
                {counts.notEligible > 0 && `${counts.notEligible} not eligible on this date. `}
                These rows are shown under Upload issues and are not counted as present.
              </Notice>
            </div>
          )}
          <div className="mt-5">
            <PreviewTabs present={preview.present} absent={preview.absent} issues={issueRows} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="secondary" disabled={!!busy} onClick={() => setPreview(null)}>Review a different file</Button>
            <Button loading={busy === 'draft'} disabled={!!busy || !!preview.existingSession} onClick={() => void save(false)}>Save as draft</Button>
            <Button loading={busy === 'finalize'} disabled={!!busy || !!preview.existingSession} onClick={() => setConfirmed(true)}>Confirm attendance</Button>
          </div>
        </Card>
      )}

      <Modal open={confirmed} onClose={() => setConfirmed(false)} title="Finalize attendance?"
        description={`${sessionLabel(sessionType)} attendance for ${effectiveBatchName ?? 'the selected batch'} on ${fmtAttendanceDate(date)}.`}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmed(false)}>Back to preview</Button>
          <Button loading={busy === 'finalize'} onClick={() => void save(true)}>Finalize attendance</Button>
        </>}>
        {counts && (
          <div className="space-y-3 text-sm text-fg-muted">
            <p><span className="font-medium text-fg">{counts.present}</span> present and <span className="font-medium text-fg">{counts.absent}</span> absent out of {preview?.rosterCount} eligible students.</p>
            <p>Finalizing saves the eligible roster with this session. Later enrollment or roll-number changes will not alter this attendance.</p>
            {counts.duplicates > 0 && <p>{counts.duplicates} duplicate scan{counts.duplicates === 1 ? '' : 's'} counted once.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function PreviewTabs({ present, absent, issues }: { present: PresentEntry[]; absent: RosterStudent[]; issues: ClassifiedRow[] }) {
  const [tab, setTab] = useState('present');
  const [page, setPage] = useState(1);
  const rows: (PresentEntry | RosterStudent)[] = tab === 'present' ? present : absent;
  const columns: Column<PresentEntry | RosterStudent>[] = [
    { key: 'roll', header: 'Roll number', cell: (r) => <span className="font-medium tabular-nums">{r.rollNumber}</span> },
    { key: 'name', header: 'Student', cell: (r) => r.name },
    { key: 'college', header: 'College', cell: (r) => r.collegeName ?? '—' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={'scanAt' in r ? 'PRESENT' : 'ABSENT'} label={attendanceStatusLabel('scanAt' in r ? 'PRESENT' : 'ABSENT')} /> },
    { key: 'scan', header: 'Scan time', cell: (r) => ('scanAt' in r && r.scanAt ? fmtDateTime(r.scanAt) : '—') },
  ];
  const issueColumns: Column<ClassifiedRow>[] = [
    { key: 'line', header: 'Line', cell: (r) => <span className="tabular-nums">{r.line}</span> },
    { key: 'roll', header: 'Uploaded value', cell: (r) => r.raw || '—' },
    { key: 'result', header: 'Issue', cell: (r) => <Badge tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Badge> },
    { key: 'message', header: 'Details', cell: (r) => r.message },
  ];
  const shown = tab === 'issues' ? issues : rows;
  const total = shown.length;
  return (
    <>
      <Tabs active={tab} onChange={(k) => { setTab(k); setPage(1); }} tabs={[
        { key: 'present', label: 'Present', count: present.length },
        { key: 'absent', label: 'Absent', count: absent.length },
        { key: 'issues', label: 'Upload issues', count: issues.length },
      ]} />
      {tab === 'issues'
        ? <DataTable columns={issueColumns} rows={issues.slice((page - 1) * PAGE, page * PAGE)} rowKey={(r) => `${r.line}-${r.result}`} caption="Upload issues" empty={<EmptyState compact title="No upload issues" body="Every row was a valid scan of an eligible student." />} />
        : <DataTable columns={columns} rows={rows.slice((page - 1) * PAGE, page * PAGE)} rowKey={(r) => r.studentId} caption={tab === 'present' ? 'Present students' : 'Absent students'}
            empty={<EmptyState compact title={tab === 'present' ? 'No students present' : 'No students absent'} />} />}
      <Pagination page={page} pageSize={PAGE} total={total} onPage={setPage} />
    </>
  );
}
