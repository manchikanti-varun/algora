'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, fmtDate, Input, Modal, Notice, Pagination, StatusBadge, TableSkeleton, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';

interface Enr { _id: string; enrolledAt: string; studentId: { _id: string; fullName: string; rollNumber: string; leetcodeUsername?: string } }
interface Pending { _id: string; rollNumber: string; email?: string; status: string; createdAt: string; claimedAt?: string }
interface ImportResult { line: number; rollNumber: string; result: string; error?: string; claimCode?: string }
type Code = { rollNumber: string; claimCode: string };

export default function Page() {
  const { batch, reload } = useBatch();
  const [page, setPage] = useState(1);
  const enr = useApi<{ items: Enr[]; total: number; page: number; pageSize: number }>(`/batches/${batch._id}/enrollments${qs({ page })}`);
  const pend = useApi<{ items: Pending[] }>(`/batches/${batch._id}/pending`);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  const [roll, setRoll] = useState(''); const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [imp, setImp] = useState<{ summary: Record<string, number>; results: ImportResult[] } | null>(null);
  const refresh = () => Promise.all([enr.reload(), pend.reload(), reload()]);

  async function addOne(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api<{ result: string; claimCode?: string; rollNumber: string }>(`/batches/${batch._id}/enrollments`, { method: 'POST', body: { rollNumber: roll, email: email || undefined } });
      if (r.result === 'PENDING') { setCodes([{ rollNumber: r.rollNumber, claimCode: r.claimCode! }]); toast.info('Roll number reserved. Share the claim code with the student.'); }
      else toast.success(r.result === 'ALREADY_ENROLLED' ? 'Already enrolled' : r.result === 'REACTIVATED' ? 'Enrollment reactivated' : 'Student enrolled');
      setRoll(''); setEmail(''); await refresh();
    } catch (e2) { toast.error(errorMessage(e2)); } finally { setBusy(false); }
  }
  async function importCsv(file: File) {
    if (file.size > 1_000_000) return toast.error('CSV must be under 1 MB');
    setBusy(true);
    try {
      const r = await api<{ summary: Record<string, number>; results: ImportResult[] }>(`/batches/${batch._id}/enrollments/import`, { method: 'POST', body: { csv: await file.text() } });
      setImp(r);
      const c = r.results.filter((x) => x.claimCode).map((x) => ({ rollNumber: x.rollNumber, claimCode: x.claimCode! }));
      if (c.length) setCodes(c);
      await refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const downloadCodes = (c: Code[]) => {
    const csv = 'rollNumber,claimCode\n' + c.map((x) => `${x.rollNumber},${x.claimCode}`).join('\n') + '\n';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `claim-codes-${batch.name.replace(/\W+/g, '-')}.csv` });
    a.click();
  };
  const pendingOnly = (pend.data?.items ?? []).filter((p) => p.status === 'PENDING');

  return (
    <div className="space-y-4">
      {!ro && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Enroll by roll number">
          <form onSubmit={addOne} className="space-y-3">
            <Input label="Roll number" value={roll} onChange={(e) => setRoll(e.target.value.toUpperCase())} required pattern="[A-Za-z0-9]{10}" maxLength={10} hint="Students who have not registered yet get a reserved spot and a one-time claim code." />
            <Input label="Student email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="If set, a student signing in with this Google email can claim the spot without the code." />
            <Button loading={busy} type="submit">Enroll</Button>
          </form>
        </Card>
        <Card title="Bulk enroll from CSV">
          <p className="mb-3 text-sm text-slate-600">Columns: <code>rollNumber</code> (required), <code>email</code> (optional). Up to 2,000 rows, 1 MB.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} />Choose CSV file…
          </label>
          {imp && (
            <div className="mt-4 space-y-2">
              <p className="flex flex-wrap gap-2 text-sm">{Object.entries(imp.summary).map(([k, v]) => <Badge key={k} tone={k === 'INVALID' ? 'red' : k === 'PENDING' ? 'amber' : k.includes('DUPLICATE') ? 'gray' : 'green'}>{k.replace(/_/g, ' ').toLowerCase()}: {v}</Badge>)}</p>
              {imp.results.some((r) => r.result === 'INVALID') && <ul className="max-h-40 overflow-y-auto text-xs text-rose-700">{imp.results.filter((r) => r.result === 'INVALID').map((r) => <li key={r.line}>Line {r.line}: {r.rollNumber || '(empty)'} · {r.error}</li>)}</ul>}
            </div>
          )}
        </Card>
      </div>}

      <Card title={`Enrolled students (${enr.data?.total ?? '…'})`}>
        {enr.error ? <ErrorState message={enr.error} retry={enr.reload} /> : !enr.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={enr.data.items} rowKey={(e) => e._id} empty={<EmptyState title="No students enrolled" body="Enroll by roll number or import a CSV." />} columns={[
              { key: 'r', header: 'Roll number', cell: (e) => <code className="text-xs">{e.studentId.rollNumber}</code> },
              { key: 'n', header: 'Name', cell: (e) => <Link className="font-medium text-indigo-700 hover:underline" href={`/manage/students/${e.studentId._id}`}>{e.studentId.fullName}</Link> },
              { key: 'l', header: 'LeetCode', cell: (e) => e.studentId.leetcodeUsername ?? '—' },
              { key: 'd', header: 'Enrolled', cell: (e) => fmtDate(e.enrolledAt) },
              { key: 'x', header: '', className: 'text-right', cell: (e) => !ro && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Remove ${e.studentId.fullName} from ${batch.name}?`, body: 'They lose access to this batch. Their verified progress is kept, and re-enrolling restores it.', confirmLabel: 'Remove', danger: true })) { try { await api(`/batches/${batch._id}/enrollments/${e.studentId._id}`, { method: 'DELETE' }); toast.success('Student removed'); refresh(); } catch (er) { toast.error(errorMessage(er)); } } }}>Remove</Button> },
            ]} />
            <Pagination page={page} pageSize={enr.data.pageSize} total={enr.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Card title={`Pending enrollments (${pendingOnly.length})`}>
        <p className="mb-3 text-sm text-slate-600">Reserved roll numbers for students who have not registered. The claim code is shown only once; regenerate it if it is lost.</p>
        {pend.error ? <ErrorState message={pend.error} retry={pend.reload} /> : !pend.data ? <TableSkeleton rows={2} /> : (
          <DataTable rows={pend.data.items} rowKey={(p) => p._id} empty={<EmptyState title="No pending enrollments" />} columns={[
            { key: 'r', header: 'Roll number', cell: (p) => <code className="text-xs">{p.rollNumber}</code> },
            { key: 'e', header: 'Reserved email', cell: (p) => p.email ?? '—' },
            { key: 'c', header: 'Created', cell: (p) => timeAgo(p.createdAt) },
            { key: 's', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
            { key: 'x', header: '', className: 'text-right', cell: (p) => p.status === 'PENDING' && !ro && <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={async () => { if (await confirm({ title: 'Generate a new claim code?', body: 'The previous code stops working immediately.', confirmLabel: 'Generate' })) { try { const r = await api<Code>(`/batches/${batch._id}/pending/${p._id}/regenerate`, { method: 'POST' }); setCodes([r]); } catch (e) { toast.error(errorMessage(e)); } } }}>New code</Button>
              <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: `Cancel reservation for ${p.rollNumber}?`, confirmLabel: 'Cancel reservation', danger: true })) { try { await api(`/batches/${batch._id}/pending/${p._id}`, { method: 'DELETE' }); toast.success('Reservation cancelled'); refresh(); } catch (e) { toast.error(errorMessage(e)); } } }}>Cancel</Button>
            </div> },
          ]} />
        )}
      </Card>

      <Modal open={!!codes} onClose={() => setCodes(null)} title="Claim codes" footer={<><Button variant="secondary" onClick={() => downloadCodes(codes!)}>Download CSV</Button><Button onClick={() => setCodes(null)}>Done</Button></>}>
        <Notice tone="warn">Copy or download these now. They are not stored and cannot be shown again.</Notice>
        <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-sm">{codes?.map((c) => <li key={c.rollNumber} className="flex justify-between gap-3 rounded bg-slate-50 px-3 py-1.5"><span>{c.rollNumber}</span><span className="select-all">{c.claimCode}</span></li>)}</ul>
      </Modal>
    </div>
  );
}
