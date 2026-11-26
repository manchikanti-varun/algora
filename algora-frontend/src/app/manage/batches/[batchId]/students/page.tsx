'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Eye, Upload, UserMinus, UserPlus } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, fmtDate, Input, Menu, Modal, Notice, Pagination, SearchInput, StatusBadge, TableSkeleton, timeAgo, useConfirm, usePageTitle, useToast } from '@/components/ui';
import { useBatch } from '@/components/manage/BatchContext';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, errorMessage, qs } from '@/lib/api';

interface Enr { _id: string; enrolledAt: string; studentId: { _id: string; fullName: string; rollNumber: string; leetcodeUsername?: string } }
interface Pending { _id: string; rollNumber: string; email?: string; status: string; createdAt: string; claimedAt?: string }
interface ImportResult { line: number; rollNumber: string; result: string; error?: string; claimCode?: string }
type Code = { rollNumber: string; claimCode: string };
const PAGE_SIZE = 100;

export default function Page() {
  const { batch, reload } = useBatch();
  usePageTitle(`Students · ${batch.name}`);
  const [f, set] = useUrlState({ page: '1', q: '' });
  const page = Math.max(1, Number(f.page) || 1);
  // The enrollments endpoint has no search, so the loaded page (up to 100 students) is filtered in the browser.
  const enr = useApi<{ items: Enr[]; total: number; page: number; pageSize: number }>(`/batches/${batch._id}/enrollments${qs({ page, pageSize: PAGE_SIZE })}`);
  const pend = useApi<{ items: Pending[] }>(`/batches/${batch._id}/pending`);
  const toast = useToast(); const confirm = useConfirm();
  const ro = batch.status === 'ARCHIVED';
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [impOpen, setImpOpen] = useState(false);
  const [roll, setRoll] = useState(''); const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [imp, setImp] = useState<{ summary: Record<string, number>; results: ImportResult[] } | null>(null);
  const refresh = () => Promise.all([enr.reload(), pend.reload(), reload()]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const items = enr.data?.items ?? [];
    return q ? items.filter((e) => [e.studentId.fullName, e.studentId.rollNumber, e.studentId.leetcodeUsername ?? ''].some((v) => v.toLowerCase().includes(q))) : items;
  }, [enr.data, f.q]);

  const showCodes = (c: Code[]) => { setDownloaded(false); setCodes(c); };
  async function addOne(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api<{ result: string; claimCode?: string; rollNumber: string }>(`/batches/${batch._id}/enrollments`, { method: 'POST', body: { rollNumber: roll, email: email || undefined } });
      setEnrollOpen(false);
      if (r.result === 'PENDING') { showCodes([{ rollNumber: r.rollNumber, claimCode: r.claimCode! }]); toast.info('Roll number reserved. Share the claim code with the student.'); }
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
      if (c.length) { setImpOpen(false); showCodes(c); }
      await refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const downloadCodes = (c: Code[]) => {
    const csv = 'rollNumber,claimCode\n' + c.map((x) => `${x.rollNumber},${x.claimCode}`).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `claim-codes-${batch.name.replace(/\W+/g, '-')}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  };
  async function closeCodes() {
    if (!downloaded && !(await confirm({ title: 'Close without downloading?', body: 'Claim codes cannot be shown again. You can create a new code for a reserved enrollment later, which cancels the old one.', confirmLabel: 'Close anyway', danger: true }))) return;
    setCodes(null);
    if (imp) setImpOpen(true);
  }
  const pendingOnly = (pend.data?.items ?? []).filter((p) => p.status === 'PENDING');

  return (
    <div className="space-y-6">
      <Card title={`Students (${enr.data?.total ?? '…'})`} flush
        actions={!ro && <>
          <Button variant="secondary" size="sm" icon={<Upload size={15} aria-hidden />} onClick={() => { setImp(null); setImpOpen(true); }}>Import CSV</Button>
          <Button size="sm" icon={<UserPlus size={15} aria-hidden />} onClick={() => setEnrollOpen(true)}>Enroll student</Button>
        </>}>
        <div className="border-b border-line px-4 py-3">
          <SearchInput value={f.q} onChange={(v) => set({ q: v })} placeholder="Search name, roll number or LeetCode" label="Search students" />
        </div>
        {enr.error ? <ErrorState message={enr.error} retry={enr.reload} /> : !enr.data ? <div className="p-4"><TableSkeleton /></div> : (
          <>
            <DataTable rows={rows} rowKey={(e) => e._id}
              empty={f.q ? <EmptyState title="No matching students" body="Try a different name or roll number." compact />
                : <EmptyState title="No students enrolled" body="Enroll a student by roll number, or import a CSV." action={!ro ? <Button onClick={() => setEnrollOpen(true)}>Enroll student</Button> : undefined} />}
              columns={[
                { key: 'n', header: 'Student', cell: (e) => <><Link className="font-medium text-fg hover:text-accent-fg hover:underline" href={`/manage/students/${e.studentId._id}`}>{e.studentId.fullName}</Link><span className="block text-xs text-fg-subtle">{e.studentId.rollNumber}</span></> },
                { key: 'l', header: 'LeetCode', cell: (e) => e.studentId.leetcodeUsername ?? <StatusBadge status="UNLINKED" /> },
                { key: 'd', header: 'Enrolled', optional: true, cell: (e) => fmtDate(e.enrolledAt) },
                { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (e) => (
                  <Menu label={`Actions for ${e.studentId.fullName}`} items={[
                    { label: 'View progress', href: `/manage/students/${e.studentId._id}`, icon: <Eye size={15} aria-hidden /> },
                    { label: 'Remove from batch', icon: <UserMinus size={15} aria-hidden />, danger: true, hidden: ro, onSelect: async () => {
                      if (await confirm({ title: `Remove ${e.studentId.fullName} from ${batch.name}?`, body: 'They lose access to this batch. Verified progress is kept, and enrolling them again restores it.', confirmLabel: 'Remove', danger: true })) {
                        try { await api(`/batches/${batch._id}/enrollments/${e.studentId._id}`, { method: 'DELETE' }); toast.success('Student removed'); refresh(); } catch (er) { toast.error(errorMessage(er)); }
                      }
                    } },
                  ]} />
                ) },
              ]} />
            <Pagination page={page} pageSize={enr.data.pageSize} total={enr.data.total} onPage={(p) => set({ page: String(p) })} />
          </>
        )}
      </Card>

      <Card title={`Reserved enrollments (${pendingOnly.length})`} description="Roll numbers reserved for students who have not registered yet. The claim code is shown only once; create a new one if it is lost." flush>
        {pend.error ? <ErrorState message={pend.error} retry={pend.reload} /> : !pend.data ? <div className="p-4"><TableSkeleton rows={2} /></div> : (
          <DataTable rows={pend.data.items} rowKey={(p) => p._id} empty={<EmptyState compact title="No reserved enrollments" />}
            columns={[
              { key: 'r', header: 'Roll number', cell: (p) => <span className="font-medium">{p.rollNumber}</span> },
              { key: 'e', header: 'Reserved email', optional: true, cell: (p) => p.email ?? '—' },
              { key: 'c', header: 'Created', optional: true, cell: (p) => timeAgo(p.createdAt) },
              { key: 's', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
              { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (p) => p.status === 'PENDING' && !ro && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={async () => {
                    if (await confirm({ title: 'Create a new claim code?', body: 'The previous code stops working immediately.', confirmLabel: 'New claim code' })) {
                      try { showCodes([await api<Code>(`/batches/${batch._id}/pending/${p._id}/regenerate`, { method: 'POST' })]); } catch (e) { toast.error(errorMessage(e)); }
                    }
                  }}>New claim code</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (await confirm({ title: `Cancel the reservation for ${p.rollNumber}?`, confirmLabel: 'Cancel reservation', danger: true })) {
                      try { await api(`/batches/${batch._id}/pending/${p._id}`, { method: 'DELETE' }); toast.success('Reservation cancelled'); refresh(); } catch (e) { toast.error(errorMessage(e)); }
                    }
                  }}>Cancel reservation</Button>
                </div>) },
            ]} />
        )}
      </Card>

      <Modal open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Enroll a student" description="Students who have not registered yet get a reserved spot and a one-time claim code."
        footer={<><Button variant="secondary" onClick={() => setEnrollOpen(false)}>Cancel</Button><Button type="submit" form="enroll-form" loading={busy}>Enroll</Button></>}>
        <form id="enroll-form" onSubmit={addOne} className="space-y-3">
          <Input label="Roll number" value={roll} onChange={(e) => setRoll(e.target.value.toUpperCase())} required pattern="[A-Za-z0-9]{10}" maxLength={10} hint="Exactly 10 letters or digits." />
          <Input label="Student email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="If set, a student signing in with this Google email can claim the spot without a code." />
        </form>
      </Modal>

      <Modal open={impOpen} onClose={() => setImpOpen(false)} title="Import students from CSV" footer={<Button variant="secondary" onClick={() => setImpOpen(false)}>Close</Button>}>
        <div className="space-y-3 text-sm">
          <p className="text-fg-muted">Columns: <code>rollNumber</code> (required) and <code>email</code> (optional). Up to 2,000 rows and 1 MB. Roll numbers of students who have not registered are reserved, and you get claim codes to download.</p>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-surface px-3.5 text-sm font-medium text-fg ring-1 ring-inset ring-line-strong focus-within:outline-2 focus-within:outline-offset-2 hover:bg-hover">
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} aria-label="CSV file" onChange={(e) => { const file = e.target.files?.[0]; if (file) importCsv(file); e.target.value = ''; }} />
            <Upload size={15} aria-hidden />{busy ? 'Importing…' : 'Choose CSV file'}
          </label>
          {imp && (
            <div className="space-y-2" aria-live="polite">
              <p className="flex flex-wrap gap-2">{Object.entries(imp.summary).map(([k, v]) => <Badge key={k} tone={k === 'INVALID' ? 'danger' : k === 'PENDING' ? 'warning' : k.includes('DUPLICATE') ? 'neutral' : 'success'}>{k.replace(/_/g, ' ').toLowerCase()}: {v}</Badge>)}</p>
              {imp.results.some((r) => r.result === 'INVALID') && <ul className="max-h-40 overflow-y-auto text-xs text-danger-fg">{imp.results.filter((r) => r.result === 'INVALID').map((r) => <li key={r.line}>Line {r.line}: {r.rollNumber || '(empty)'} · {r.error}</li>)}</ul>}
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!codes} onClose={closeCodes} title="Claim codes"
        footer={<><Button variant="secondary" onClick={closeCodes}>Done</Button><Button onClick={() => downloadCodes(codes!)}>Download CSV</Button></>}>
        <div className="space-y-3">
          <Notice tone="warn">Download these now. Claim codes cannot be shown again.</Notice>
          <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-sm">{codes?.map((c) => <li key={c.rollNumber} className="flex justify-between gap-3 rounded bg-subtle px-3 py-1.5"><span>{c.rollNumber}</span><span className="select-all">{c.claimCode}</span></li>)}</ul>
        </div>
      </Modal>
    </div>
  );
}
