'use client';
import Link from 'next/link';
import { ArrowLeft, Ban, CheckCircle2, Download, FileUp, PencilLine, ScanLine } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  Badge, Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, fmtDateTime, Grid, InlineSelect,
  Modal, Notice, PageHeader, Pagination, PageSkeleton, SearchInput, StatCard, StatusBadge, Tabs, Textarea, useConfirm, useToast,
  type Column,
} from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { download, errorMessage, api } from '@/lib/api';
import {
  attendancePct, attendanceStatusLabel, fmtAttendanceDate, sessionLabel, type AttendanceStatus, type SessionDetail, type SessionRecord,
} from '@/lib/attendance';

const PAGE = 25;
const SOURCE: Record<string, string> = { CSV_SCAN: 'Scanner CSV', MANUAL_CORRECTION: 'Manual correction', IMPORT_ADD: 'Added scan', IMPORT_REPLACE: 'Replacement CSV' };

export default function Page() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const d = useApi<SessionDetail>(`/attendance/sessions/${sessionId}`);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<SessionRecord | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<AttendanceStatus>('PRESENT');
  const [correctionTime, setCorrectionTime] = useState('');
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [importOpen, setImportOpen] = useState<'ADD' | 'REPLACE' | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importName, setImportName] = useState('');
  const [importReason, setImportReason] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTime, setEditTime] = useState('');
  const [editNotes, setEditNotes] = useState('');

  if (d.error) return <div className="space-y-6"><PageHeader title="Attendance session" breadcrumbs={[{ label: 'Attendance', href: '/manage/attendance' }, { label: 'Session' }]} /><ErrorState message={d.error} retry={d.reload} /></div>;
  if (!d.data) return <PageSkeleton />;
  const { session, records } = d.data;
  const back = `/manage/batches/${session.batchId}/attendance`;
  const openCorrection = (r: SessionRecord) => {
    setCorrecting(r); setCorrectionStatus(r.status === 'PRESENT' ? 'ABSENT' : 'PRESENT');
    setCorrectionTime(r.scanAt ? new Date(r.scanAt).toISOString().slice(0, 16) : ''); setReason('');
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(ok); try { await fn(); toast.success(ok); await d.reload(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(null); } };

  const filtered = records.filter((r) => (tab === 'all' || r.status === (tab === 'present' ? 'PRESENT' : 'ABSENT'))
    && (!q.trim() || r.rollNumber.toLowerCase().includes(q.trim().toLowerCase()) || r.studentName.toLowerCase().includes(q.trim().toLowerCase())));
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const columns: Column<SessionRecord>[] = [
    { key: 'roll', header: 'Roll number', cell: (r) => <span className="font-medium tabular-nums">{r.rollNumber}</span> },
    { key: 'name', header: 'Student', cell: (r) => r.studentName },
    { key: 'college', header: 'College', cell: (r) => r.college ?? '—' },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={attendanceStatusLabel(r.status)} /> },
    { key: 'scan', header: 'Scan time', cell: (r) => (r.scanAt ? fmtDateTime(r.scanAt) : '—') },
    { key: 'source', header: 'Method', cell: (r) => SOURCE[r.markingSource] ?? r.markingSource },
    ...(session.status === 'FINALIZED' ? [{
      key: 'action', header: 'Correction', align: 'right' as const,
      cell: (r: SessionRecord) => <Button variant="ghost" size="xs" onClick={() => openCorrection(r)}>Correct</Button>,
    }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`${sessionLabel(session.sessionType)} attendance`} docTitle={`${sessionLabel(session.sessionType)} attendance · ${fmtAttendanceDate(session.attendanceDate)}`}
        meta={<StatusBadge status={session.status} />}
        subtitle={`${session.batchName ?? 'Batch'} · ${fmtAttendanceDate(session.attendanceDate)} · ${session.attendanceTime} (${session.timezone})`}
        breadcrumbs={[{ label: 'Attendance', href: '/manage/attendance' }, { label: 'Sessions', href: '/manage/attendance/sessions' }, { label: fmtAttendanceDate(session.attendanceDate) }]}
        actions={<>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={() => { void download(`/attendance/export?type=session&sessionId=${session._id}&format=csv`); }}>CSV</Button>
          <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden />} onClick={() => { void download(`/attendance/export?type=session&sessionId=${session._id}&format=xlsx`); }}>XLSX</Button>
          {session.status !== 'CANCELLED' && <Button variant="secondary" size="sm" icon={<ScanLine size={15} aria-hidden />} onClick={() => { setImportCsv(''); setImportName(''); setImportReason(''); setImportOpen('ADD'); }}>Add scans</Button>}
          {session.status === 'DRAFT' && <Button size="sm" icon={<CheckCircle2 size={15} aria-hidden />} loading={busy === 'Attendance finalized'} onClick={async () => {
            if (!(await confirm({ title: 'Finalize this attendance?', body: 'The eligible roster is saved with the session. Later enrollment changes will not alter it.', confirmLabel: 'Finalize' }))) return;
            await run(() => api(`/attendance/sessions/${session._id}/finalize`, { method: 'POST' }), 'Attendance finalized');
          }}>Finalize</Button>}
        </>} />

      <div className="flex flex-wrap items-center gap-2">
        <Link className="inline-flex items-center gap-1 text-[13px] text-fg-muted hover:text-fg hover:underline" href={back}><ArrowLeft size={14} aria-hidden />Batch attendance</Link>
        {session.status !== 'CANCELLED' && <Button variant="ghost" size="sm" icon={<FileUp size={14} aria-hidden />} onClick={() => { setImportCsv(''); setImportName(''); setImportReason(''); setImportOpen('REPLACE'); }}>Replace from corrected CSV</Button>}
        {session.status === 'DRAFT' && <Button variant="ghost" size="sm" icon={<PencilLine size={14} aria-hidden />} onClick={() => { setEditTime(session.attendanceTime); setEditNotes(session.notes ?? ''); setEditOpen(true); }}>Edit draft</Button>}
        {session.status !== 'CANCELLED' && <Button variant="ghost" size="sm" icon={<Ban size={14} aria-hidden />} onClick={() => { setCancelReason(''); setCancelOpen(true); }}>Cancel session</Button>}
      </div>

      {session.status === 'DRAFT' && <Notice tone="info" title="This attendance is a draft">It is not counted in percentages until finalized. You can replace the CSV, adjust the time or add notes first.</Notice>}
      {session.status === 'CANCELLED' && <Notice tone="warn" title="This session was cancelled">It does not count towards attendance percentages. {session.cancellationReason}</Notice>}

      <Grid>
        <StatCard label="Eligible students" value={session.eligibleCount} />
        <StatCard label="Present" value={session.presentCount} tone="good" />
        <StatCard label="Absent" value={session.absentCount} tone={session.absentCount ? 'bad' : 'default'} />
        <StatCard label="Attendance" value={attendancePct(session.percentage)} hint={session.status === 'FINALIZED' ? 'Finalized' : session.status === 'DRAFT' ? 'Draft — not counted' : 'Cancelled'} />
      </Grid>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Session details">
            <DescriptionList cols={3} items={[
              { label: 'Batch', value: <Link className="text-accent-fg hover:underline" href={`/manage/batches/${session.batchId}`}>{session.batchName ?? 'Batch'}</Link> },
              { label: 'Date', value: fmtAttendanceDate(session.attendanceDate) },
              { label: 'Session', value: sessionLabel(session.sessionType) },
              { label: 'Attendance time', value: `${session.attendanceTime} (${session.timezone})` },
              { label: 'Recorded by', value: session.createdBy ?? '—' },
              { label: 'Finalized by', value: session.finalizedBy ? `${session.finalizedBy} · ${fmtDateTime(session.finalizedAt)}` : '—' },
              { label: 'Last updated', value: fmtDateTime(session.updatedAt) },
              { label: 'Notes', value: session.notes ?? '—' },
              { label: 'Corrections', value: session.revision ? `${session.revision} revision${session.revision === 1 ? '' : 's'}` : 'None' },
            ]} />
          </Card>
        </div>
        <Card title="Upload summary">
          {session.uploadSummary && Object.keys(session.uploadSummary).length ? (
            <DescriptionList cols={2} items={Object.entries(session.uploadSummary).map(([k, v]) => ({ label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), value: String(v) }))} />
          ) : <p className="text-sm text-fg-muted">No scanner file was uploaded for this session.</p>}
        </Card>
      </div>

      <Card title="Students" description="Search by name or roll number" flush>
        <Tabs active={tab} onChange={(k) => { setTab(k); setPage(1); }} tabs={[
          { key: 'all', label: 'All students', count: records.length },
          { key: 'present', label: 'Present', count: records.filter((r) => r.status === 'PRESENT').length },
          { key: 'absent', label: 'Absent', count: records.filter((r) => r.status === 'ABSENT').length },
        ]} />
        <div className="border-b border-line px-4 py-2.5"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name or roll number" /></div>
        <DataTable columns={columns} rows={shown} rowKey={(r) => r._id} caption="Attendance records" empty={<EmptyState compact title="No students in this view" />} />
        <Pagination page={page} pageSize={PAGE} total={filtered.length} onPage={setPage} />
      </Card>

      {!!d.data.correctionHistory.length && (
        <Card title="Correction history" description="Corrections are kept for audit and never deleted." flush>
          <ul className="divide-y divide-line text-sm">
            {d.data.correctionHistory.map((c, i) => (
              <li key={`${c.studentId}-${c.at}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="min-w-0"><span className="font-medium text-fg">{c.studentName ?? 'Student'}</span> <span className="tabular-nums text-fg-muted">{c.rollNumber}</span></span>
                <span className="flex flex-wrap items-center gap-2 text-fg-muted">
                  <Badge tone="neutral">{attendanceStatusLabel(c.from ?? '')}</Badge>→<Badge tone="neutral">{attendanceStatusLabel(c.to ?? '')}</Badge>
                  <span className="text-xs">{fmtDateTime(c.at)}</span>
                  {c.reason && <span className="text-xs">· {c.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!correcting} onClose={() => setCorrecting(null)} title="Correct attendance" description={correcting ? `${correcting.studentName} · ${correcting.rollNumber}` : undefined}
        footer={<>
          <Button variant="secondary" onClick={() => setCorrecting(null)}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 3 || busy !== null} loading={busy === 'Attendance updated'} onClick={async () => {
            if (!correcting) return;
            const body = {
              corrections: [{ studentId: correcting.studentId, status: correctionStatus, scanAt: correctionStatus === 'PRESENT' && correctionTime ? new Date(correctionTime).toISOString() : null }],
              reason,
            };
            if (await run(() => api(`/attendance/sessions/${session._id}/records`, { method: 'PATCH', body }), 'Attendance updated')) setCorrecting(null);
          }}>Save correction</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">A finalized session needs a reason. The previous status and scan time stay in the correction history.</p>
          <InlineSelect label="New attendance status" value={correctionStatus} onChange={(v) => setCorrectionStatus(v as AttendanceStatus)}
            options={[{ value: 'PRESENT', label: 'Present' }, { value: 'ABSENT', label: 'Absent' }]} className="w-full" />
          {correctionStatus === 'PRESENT' && (
            <Field label="Scan time (optional)">{(id) => <input id={id} type="datetime-local" value={correctionTime} onChange={(e) => setCorrectionTime(e.target.value)}
              className="block w-full rounded-lg border-0 bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />}</Field>
          )}
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} hint="At least 3 characters." />
        </div>
      </Modal>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this attendance session?"
        footer={<>
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep session</Button>
          <Button variant="danger" disabled={cancelReason.trim().length < 3 || busy !== null} loading={busy === 'Session cancelled'} onClick={async () => {
            if (await run(() => api(`/attendance/sessions/${session._id}/cancel`, { method: 'POST', body: { reason: cancelReason } }), 'Session cancelled')) setCancelOpen(false);
          }}>Cancel session</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">Cancelled sessions are kept for audit but do not count towards attendance percentages. The batch, date and session become available to record again.</p>
          <Textarea label="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} minLength={3} maxLength={500} />
        </div>
      </Modal>

      <Modal open={!!importOpen} onClose={() => setImportOpen(null)} title={importOpen === 'REPLACE' ? 'Replace attendance from a corrected CSV' : 'Add missing scans'}
        description={importOpen === 'REPLACE' ? 'The whole roster is replaced by this file. Finalized attendance needs a reason.' : 'Only adds present students. Existing absences stay unless the student appears in this file.'}
        footer={<>
          <Button variant="secondary" onClick={() => setImportOpen(null)}>Cancel</Button>
          <Button disabled={!importCsv.trim() || (session.status === 'FINALIZED' && importReason.trim().length < 3) || busy !== null} loading={busy === 'Scans imported'} onClick={async () => {
            const body = { csv: importCsv, mode: importOpen, reason: importReason.trim() || undefined };
            if (await run(() => api(`/attendance/sessions/${session._id}/import`, { method: 'POST', body }), 'Scans imported')) setImportOpen(null);
          }}>{importOpen === 'REPLACE' ? 'Replace attendance' : 'Add scans'}</Button>
        </>}>
        <div className="space-y-3">
          <Field label="Corrected CSV" hint={importName ? `Selected: ${importName}` : 'One roll number per row. Timestamps are optional.'}>
            {(id) => <input id={id} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setImportCsv(await f.text()); setImportName(f.name); }}
              className="block w-full text-sm text-fg-muted" />}
          </Field>
          {session.status === 'FINALIZED' && <Textarea label="Reason" value={importReason} onChange={(e) => setImportReason(e.target.value)} minLength={3} maxLength={500} hint="Required for finalized attendance." />}
        </div>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit draft"
        footer={<>
          <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button loading={busy === 'Draft updated'} onClick={async () => {
            if (await run(() => api(`/attendance/sessions/${session._id}`, { method: 'PATCH', body: { attendanceTime: editTime, notes: editNotes } }), 'Draft updated')) setEditOpen(false);
          }}>Save</Button>
        </>}>
        <div className="space-y-3">
          <Field label="Attendance time">{(id) => <input id={id} type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
            className="block w-full rounded-lg border-0 bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent" />}</Field>
          <Textarea label="Notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} maxLength={1000} />
        </div>
      </Modal>
    </div>
  );
}
