'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  BarList, Button, Card, Combobox, DataTable, DescriptionList, DifficultyBadge, EmptyState, ErrorState, Grid, InlineSelect,
  Menu, PageHeader, Pagination, ProgressBar, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useToast,
  type Column, type Option,
} from '@/components/ui';
import type { CourseDetail, Overview, Paged, PerfRow } from '@/components/manage/types';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { download, errorMessage, qs } from '@/lib/api';
import { attendancePct, localToday, type BatchAttendanceRow, type DailyRow, type LowAttendanceRow } from '@/lib/attendance';
import { loadBatches, loadColleges, loadCourses, loadStudents } from '@/lib/options';

type Tab = 'overview' | 'students' | 'batches' | 'courses' | 'chapters' | 'problems' | 'colleges' | 'attendance';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'students', label: 'Students' }, { key: 'batches', label: 'Batches' },
  { key: 'courses', label: 'Courses' }, { key: 'chapters', label: 'Chapters' }, { key: 'problems', label: 'Problems' },
  { key: 'colleges', label: 'Colleges' }, { key: 'attendance', label: 'Attendance' },
];
const isTab = (v: string): v is Tab => TABS.some((t) => t.key === v);
const monthStart = () => `${localToday().slice(0, 7)}-01`;

interface StudentDetail {
  student: { _id: string; fullName: string; rollNumber: string; college?: string | null; email?: string };
  enrollments: { batchId: string; batch?: string; status: string }[];
  contexts: PerfRow[];
  chapters: { batch: string; course: string; chapter: string; problems: number; solved: number; completionPct: number | null }[];
  attendance: { eligible: number; present: number; absent: number; percentage: number | null; morning: { eligible: number; percentage: number | null }; afternoon: { eligible: number; percentage: number | null } };
  attendanceHistory: { attendanceDate: string; sessionType: string; status: string }[];
  link: { state?: string } | null;
  history: { slug: string; title: string; firstVerifiedAt: string | null; lastVerifiedAt: string | null }[];
}
interface BatchDetail extends Overview {
  batch: { _id: string; name: string; status: string; startDate?: string; endDate?: string; college?: string | null; colleges?: string[]; courses?: { _id: string; title: string }[]; trainers?: { fullName: string; trainerId?: string }[]; pendingEnrollments?: number };
  attendance: { enrolled: number; totals: { sessions: number; percentage: number | null; present: number; eligible: number } };
  chapters: { chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }[];
  rows?: PerfRow[];
}
interface CourseDetailData extends Omit<Overview, 'batchComparison'> {
  course: { _id: string; title: string; status: string };
  chapters: { chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null }[];
  uniqueStudents: number; contexts: number;
  batches: { _id: string; name: string; status: string; students: number; avgCompletionPct: number | null }[];
  batchComparison: { batchId: string; batch: string; students: number; avgCompletionPct: number | null; verified: number }[];
  rows?: PerfRow[];
}
interface ChapterDetail {
  course: { _id: string; title: string };
  chapter: { _id: string; title: string };
  summary: { chapter: string; problems: number; students: number; completedStudents: number; avgCompletionPct: number | null };
  difficulty: Overview['difficulty'];
  problems: { problem: string; slug: string; difficulty: string; students: number; verifiedSolved: number; solvedPct: number | null }[];
  items?: PerfRow[];
}
interface ProblemDetailData {
  problem: { title: string; slug: string; difficulty: string; number: number | null } | null;
  scope: { students: number; verified: number };
  verificationPct: number | null;
  items: (PerfRow & { verified: boolean; chapter: string })[];
}
interface CollegeDetailData extends Overview {
  college: { _id: string; name: string; code?: string | null; status: string };
  attendance: { weighted: { eligible: number; present: number; percentage: number | null } };
  rows?: PerfRow[];
}
interface AttendanceOverview { items: BatchAttendanceRow[]; weighted: { eligible: number; present: number; percentage: number | null } }

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

export default function Page() {
  const [f, set] = useUrlState({
    tab: 'overview', batchId: '', courseId: '', chapterId: '', collegeId: '', studentId: '', slug: '',
    difficulty: '', q: '', from: monthStart(), to: localToday(), page: '1',
  });
  const tab: Tab = isTab(f.tab) ? f.tab : 'overview';
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const scope = { batchId: f.batchId, courseId: f.courseId, collegeId: f.collegeId, chapterId: f.chapterId, difficulty: f.difficulty, q: f.q };
  const attendanceScope = { batchId: f.batchId, collegeId: f.collegeId, from: f.from, to: f.to };

  const exp = async (key: string, path: string) => {
    setBusy(key);
    try { await download(path); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const report = (type: string, format: 'csv' | 'xlsx', extra: Record<string, string | undefined> = {}) =>
    `/reports/export${qs({ ...scope, type, format, ...extra })}`;
  const attendanceExport = (type: string, format: 'csv' | 'xlsx') =>
    `/attendance/export${qs({ type, format, batchId: f.batchId, collegeId: f.collegeId, from: f.from, to: f.to, threshold: 75 })}`;

  const clear = () => set({ batchId: '', courseId: '', chapterId: '', collegeId: '', studentId: '', slug: '', difficulty: '', q: '', page: '1' });
  const pickTab = (t: Tab) => { setPage(1); set({ tab: t, page: '1', studentId: t === 'students' ? f.studentId : '', slug: t === 'problems' ? f.slug : '' }); };
  const pickCollege = (collegeId: string) => { setPage(1); set({ collegeId, batchId: '', courseId: '', chapterId: '' }); };
  const pickBatch = (batchId: string) => { setPage(1); set({ batchId, courseId: '', chapterId: '' }); };
  const pickCourse = (courseId: string) => { setPage(1); set({ courseId, chapterId: '', slug: '' }); };

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics & Reports" subtitle="Inspect performance for the batches you can access, then export exactly what you are looking at."
        actions={<Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button>} />
      <Tabs active={tab} onChange={(k) => pickTab(k as Tab)} tabs={TABS} />
      {tab === 'overview' && <OverviewView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} page={page} setPage={setPage} pickBatch={pickBatch} pickCourse={pickCourse} pickCollege={pickCollege} />}
      {tab === 'students' && <StudentsView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} page={page} setPage={setPage} pickBatch={pickBatch} pickCourse={pickCourse} pickCollege={pickCollege} />}
      {tab === 'batches' && <BatchesView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} pickBatch={pickBatch} pickCourse={pickCourse} pickCollege={pickCollege} page={page} setPage={setPage} />}
      {tab === 'courses' && <CoursesView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} pickCourse={pickCourse} pickBatch={pickBatch} pickCollege={pickCollege} page={page} setPage={setPage} />}
      {tab === 'chapters' && <ChaptersView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} pickCourse={pickCourse} pickBatch={pickBatch} pickCollege={pickCollege} page={page} setPage={setPage} />}
      {tab === 'problems' && <ProblemsView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} pickCourse={pickCourse} pickBatch={pickBatch} pickCollege={pickCollege} page={page} setPage={setPage} />}
      {tab === 'colleges' && <CollegesView f={f} set={set} scope={scope} exp={exp} report={report} busy={busy} pickCollege={pickCollege} pickBatch={pickBatch} pickCourse={pickCourse} page={page} setPage={setPage} />}
      {tab === 'attendance' && <AttendanceView f={f} set={set} attendanceScope={attendanceScope} attendanceExport={attendanceExport} busy={busy} exp={exp} report={report} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- overview
function OverviewView({ f, set, scope, exp, report, busy }: ViewProps) {
  const o = useApi<Overview>(`/analytics/overview${qs(scope)}`);
  const att = useApi<AttendanceOverview>(`/attendance/analytics/batches${qs({ batchId: f.batchId, collegeId: f.collegeId })}`);
  const t = o.data?.totals;
  return (
    <>
      <FilterBar>
        <Combobox label="Batch" value={f.batchId} onChange={(v) => set({ batchId: v })} load={loadBatches} emptyLabel="All batches" />
        <Combobox label="College" value={f.collegeId} onChange={(v) => set({ collegeId: v })} load={loadColleges} emptyLabel="All colleges" />
        <Combobox label="Course" value={f.courseId} onChange={(v) => set({ courseId: v })} load={loadCourses} emptyLabel="All courses" />
        <Difficulty value={f.difficulty} onChange={(difficulty) => set({ difficulty })} />
        <ExportMenu label="Export overview" busy={busy}
          items={[
            { key: 'students-csv', label: 'Students (filtered) — CSV', onSelect: () => exp('students-csv', report('student', 'csv')) },
            { key: 'students-xlsx', label: 'Students (filtered) — XLSX', onSelect: () => exp('students-xlsx', report('student', 'xlsx')) },
            { key: 'batches-csv', label: 'Batches — CSV', onSelect: () => exp('batches-csv', report('batch', 'csv')) },
            { key: 'batches-xlsx', label: 'Batches — XLSX', onSelect: () => exp('batches-xlsx', report('batch', 'xlsx')) },
            { key: 'chapters-csv', label: 'Chapters — CSV', onSelect: () => exp('chapters-csv', report('chapter', 'csv')) },
            { key: 'problems-csv', label: 'Problems — CSV', onSelect: () => exp('problems-csv', report('problem', 'csv')) },
          ]} />
      </FilterBar>
      {o.error ? <ErrorState message={o.error} retry={o.reload} /> : !o.data ? <TableSkeleton rows={6} /> : (
        <>
          <Grid>
            <StatCard label="Students in scope" value={o.data.verification.studentsInScope} hint={`${t!.activeStudents7d} active in the last 7 days`} />
            <StatCard label="Average completion" value={pctText(t!.avgCompletionPct)} hint={`${t!.batches} batches · ${t!.courses} courses`} />
            <StatCard label="Verified problems" value={t!.verifiedCompletions} hint="Student and problem pairs" tone="good" />
            <StatCard label="LeetCode connection" value={pctText(o.data.verification.coveragePct)} hint={`${o.data.verification.verifiedLinks} of ${o.data.verification.studentsInScope} connected`} />
          </Grid>
          <Grid>
            <StatCard label="Attendance" value={attendancePct(att.data?.weighted.percentage ?? null)} hint={`${att.data?.weighted.present ?? 0} of ${att.data?.weighted.eligible ?? 0} opportunities`} />
            <StatCard label="Batches with attendance" value={`${(att.data?.items ?? []).filter((b) => b.hasData).length} / ${att.data?.items.length ?? 0}`} hint="Weighted overall, not an average of percentages" />
            <StatCard label="Students needing support" value={o.data.needsSupport.length} hint="Low completion or no connected account" tone={o.data.needsSupport.length ? 'warn' : 'default'} />
            <StatCard label="Problems completed fully" value={t!.completedAllAvailable} hint="Students with every available problem verified" />
          </Grid>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Course completion"><BarList items={o.data.courseCompletion.map((c) => ({ label: c.title, value: c.avgCompletionPct, sub: `${c.rows} student-course rows` }))} max={100} format={(n) => `${n}%`} empty="No course data yet" /></Card>
            <Card title="Batch comparison"><BarList items={o.data.batchComparison.map((b) => ({ label: b.name, value: b.avgCompletionPct, sub: `${b.students} students` }))} max={100} format={(n) => `${n}%`} empty="No batch data yet" /></Card>
          </div>
          <Card title="Performance by difficulty" description="Verified problems out of available problems in scope">
            <div className="space-y-3">
              {(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-sm"><span className="text-fg">{k[0] + k.slice(1).toLowerCase()}</span><span className="tabular-nums text-fg-muted">{o.data!.difficulty[k].available ? `${o.data!.difficulty[k].solved} / ${o.data!.difficulty[k].available}` : 'Not assigned'}</span></div>
                  {o.data!.difficulty[k].available > 0 && <ProgressBar value={(o.data!.difficulty[k].solved / o.data!.difficulty[k].available) * 100} label={`${k} completion`} />}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Students who may need support" description="Low verified completion after a successful update, or no connected account" flush>
            <DataTable rows={o.data.needsSupport.slice(0, 10)} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Students needing support"
              empty={<EmptyState compact title="Nobody flagged" body="No students currently match these criteria." />}
              columns={[
                { key: 'name', header: 'Student', cell: (r) => <Link className="font-medium text-accent-fg hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link> },
                { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
                { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                { key: 'course', header: 'Course', cell: (r) => r.course },
                { key: 'completion', header: 'Completion', className: 'min-w-40', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
                { key: 'link', header: 'LeetCode', cell: (r) => <StatusBadge status={r.linkState} /> },
              ]} />
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- students
function StudentsView({ f, set, scope, exp, report, busy, page, setPage }: ViewProps) {
  const selected = f.studentId;
  const d = useApi<StudentDetail>(selected ? `/analytics/students/${selected}${qs({ batchId: f.batchId, courseId: f.courseId })}` : null);
  const all = useApi<Paged<PerfRow>>(!selected ? `/analytics/students${qs({ ...scope, page, sort: 'points', dir: 'desc' })}` : null);
  const [label, setLabel] = useState('');
  const detail = d.data;
  const rows = detail?.contexts ?? [];
  const accessible = rows.reduce((a, r) => a + r.accessible, 0);
  const solved = rows.reduce((a, r) => a + r.solved, 0);
  return (
    <>
      <FilterBar>
        <Combobox label="Student" value={selected} selectedLabel={label} load={loadStudents} placeholder="Search name or roll number" onChange={(id, o) => { setLabel(o?.label ?? ''); setPage(1); set({ studentId: id }); }} emptyLabel="Choose a student" />
        <Combobox label="College" value={f.collegeId} onChange={(v) => set({ collegeId: v })} load={loadColleges} emptyLabel="All colleges" />
        <Combobox label="Batch" value={f.batchId} onChange={(v) => { setPage(1); set({ batchId: v, courseId: '' }); }} load={loadBatches} emptyLabel="All batches" />
        <Combobox label="Course" value={f.courseId} onChange={(v) => { setPage(1); set({ courseId: v }); }} load={loadCourses} emptyLabel="All courses" />
        <ExportMenu label="Export" busy={busy} items={selected ? [
          { key: 's-csv', label: 'Selected student — CSV', onSelect: () => exp('s-csv', report('student', 'csv', { studentId: selected })) },
          { key: 's-xlsx', label: 'Selected student — XLSX', onSelect: () => exp('s-xlsx', report('student', 'xlsx', { studentId: selected })) },
        ] : [
          { key: 'a-csv', label: 'All matching students — CSV', onSelect: () => exp('a-csv', report('student', 'csv')) },
          { key: 'a-xlsx', label: 'All matching students — XLSX', onSelect: () => exp('a-xlsx', report('student', 'xlsx')) },
        ]} />
      </FilterBar>
      {!selected && (
        <Card title="All students" description="Filtered student and course rows. Select a student above for individual analysis." flush>
          {all.error ? <div className="p-4"><ErrorState message={all.error} retry={all.reload} /></div> : !all.data ? <TableSkeleton rows={8} /> : (
            <>
              <DataTable rows={all.data.items} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="All students"
                onRowClick={(r) => { setPage(1); set({ studentId: r.studentId }); }}
                empty={<EmptyState title="No students match these filters" />}
                columns={[
                  { key: 'name', header: 'Student', cell: (r) => <span><span className="font-medium text-fg">{r.name}</span><p className="text-xs text-fg-subtle">{r.rollNumber}</p></span> },
                  { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                  { key: 'course', header: 'Course', cell: (r) => r.course },
                  { key: 'solved', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
                  { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
                  { key: 'points', header: 'Points', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{r.points}</span> },
                  { key: 'rank', header: 'Rank', align: 'right', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
                  { key: 'college', header: 'College', optional: true, defaultHidden: true, cell: (r) => r.college ?? '—' },
                ]} />
              <Pagination page={page} pageSize={all.data.pageSize} total={all.data.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}
      {selected && (d.error ? <ErrorState message={d.error} retry={d.reload} /> : !detail ? <TableSkeleton rows={8} /> : (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-fg">{detail.student.fullName}</h2>
                <p className="text-sm text-fg-muted">{detail.student.rollNumber} · {detail.student.college ?? 'No college'}</p>
                <p className="mt-1 text-[13px] text-fg-subtle">LeetCode: {detail.link?.state ? <StatusBadge status={detail.link.state} /> : <StatusBadge status="UNLINKED" />}</p>
              </div>
              <Link className="text-sm font-medium text-accent-fg hover:underline" href={`/manage/students/${detail.student._id}`}>Open student record</Link>
            </div>
            <DescriptionList cols={3} items={[
              { label: 'Batches', value: detail.enrollments.map((e) => e.batch).filter(Boolean).join(', ') || 'None' },
              { label: 'Course contexts', value: rows.length },
              { label: 'Attendance', value: `${attendancePct(detail.attendance.percentage)} (${detail.attendance.present}/${detail.attendance.eligible})` },
            ]} />
          </Card>
          <Grid>
            <StatCard label="Verified / available" value={`${solved} / ${accessible}`} hint="Across the selected contexts only" />
            <StatCard label="Completion" value={accessible ? pctText(Math.round((solved / accessible) * 1000) / 10) : '—'} hint="Weighted, not an average of percentages" />
            <StatCard label="Points" value={rows.reduce((a, r) => a + r.points, 0)} hint="Sum of the selected contexts" />
            <StatCard label="Chapters tracked" value={detail.chapters.length} hint="Visible chapters in these contexts" />
          </Grid>
          <Card title="Learning contexts" description="Metrics are never merged across unrelated batch-course contexts" flush>
            <DataTable rows={rows} rowKey={(r) => r.batchCourseId} caption="Student contexts"
              empty={<EmptyState title="No learning contexts" body="This student is not enrolled in an active batch-course." />}
              columns={[
                { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                { key: 'course', header: 'Course', cell: (r) => r.course },
                { key: 'solved', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
                { key: 'e', header: 'Easy', align: 'right', cell: (r) => r.easy },
                { key: 'm', header: 'Medium', align: 'right', cell: (r) => r.medium },
                { key: 'h', header: 'Hard', align: 'right', cell: (r) => r.hard },
                { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
                { key: 'points', header: 'Points', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{r.points}</span> },
                { key: 'rank', header: 'Batch rank', align: 'right', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
              ]} />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Chapter-wise performance" flush>
              <DataTable rows={detail.chapters} rowKey={(r) => `${r.batch}-${r.course}-${r.chapter}`} caption="Chapter performance"
                empty={<EmptyState compact title="No chapter data" />}
                columns={[
                  { key: 'chapter', header: 'Chapter', cell: (r) => <span><span className="font-medium">{r.chapter}</span><p className="text-xs text-fg-subtle">{r.batch} · {r.course}</p></span> },
                  { key: 'solved', header: 'Verified', align: 'right', cell: (r) => <span className="tabular-nums">{r.solved} / {r.problems}</span> },
                  { key: 'pct', header: 'Completion', className: 'min-w-32', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Chapter completion" /> },
                ]} />
            </Card>
            <Card title="Attendance summary" description="Finalized sessions only">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span>Overall</span><span className="font-semibold tabular-nums">{attendancePct(detail.attendance.percentage)}</span></div>
                <ProgressBar value={detail.attendance.percentage} label="Attendance" />
                <div className="flex justify-between text-fg-muted"><span>Morning</span><span className="tabular-nums">{attendancePct(detail.attendance.morning.percentage)}</span></div>
                <div className="flex justify-between text-fg-muted"><span>Afternoon</span><span className="tabular-nums">{attendancePct(detail.attendance.afternoon.percentage)}</span></div>
                {detail.attendance.eligible === 0 && <p className="text-xs text-fg-subtle">No eligible finalized sessions yet — this is not 0% attendance.</p>}
                {detail.attendanceHistory.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line pt-2">
                    {detail.attendanceHistory.map((h) => (
                      <li key={`${h.attendanceDate}-${h.sessionType}`} className="flex justify-between py-1.5 text-[13px]"><span>{h.attendanceDate} · {h.sessionType[0] + h.sessionType.slice(1).toLowerCase()}</span><StatusBadge status={h.status} /></li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
          <Card title="Recent verification activity" flush>
            <DataTable rows={detail.history.slice(0, 15)} rowKey={(r) => r.slug} caption="Recent verification activity"
              empty={<EmptyState compact title="No verified evidence yet" body="A missing record means Algora has not observed accepted-submission evidence, not that the student never solved it." />}
              columns={[
                { key: 'title', header: 'Problem', cell: (r) => <a className="text-accent-fg hover:underline" href={`https://leetcode.com/problems/${r.slug}/`} target="_blank" rel="noopener noreferrer">{r.title}</a> },
                { key: 'first', header: 'First verified', cell: (r) => (r.firstVerifiedAt ? timeAgo(r.firstVerifiedAt) : '—') },
                { key: 'last', header: 'Last observed', cell: (r) => (r.lastVerifiedAt ? timeAgo(r.lastVerifiedAt) : '—') },
              ]} />
          </Card>
        </>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- batches
function BatchesView({ f, set, exp, report, busy, pickBatch, page, setPage }: ViewProps) {
  const router = useRouter();
  const d = useApi<BatchDetail>(f.batchId ? `/analytics/batches/${f.batchId}${qs({ courseId: f.courseId, difficulty: f.difficulty, q: f.q })}` : null);
  const bcs = useApi<{ items: { status: string; courseId: { _id: string; title: string } }[] }>(f.batchId ? `/batches/${f.batchId}/courses` : null);
  const courses = (bcs.data?.items ?? []).filter((b) => b.status === 'ACTIVE');
  const detail = d.data;
  const rows = detail?.rows ?? [];
  const paged = rows.slice((page - 1) * 25, page * 25);
  return (
    <>
      <FilterBar>
        <Combobox label="Batch" value={f.batchId} selectedLabel={detail?.batch.name} load={loadBatches} placeholder="Search batches" onChange={pickBatch} emptyLabel="Choose a batch" />
        {f.batchId && <InlineSelect label="Course" value={f.courseId} onChange={(courseId) => { setPage(1); set({ courseId }); }} options={[{ value: '', label: 'All assigned courses' }, ...courses.map((c) => ({ value: c.courseId._id, label: c.courseId.title }))]} />}
        <Difficulty value={f.difficulty} onChange={(difficulty) => { setPage(1); set({ difficulty }); }} />
        <ExportMenu label="Export batch" busy={busy} items={[
          { key: 'b-csv', label: 'Student rows — CSV', onSelect: () => exp('b-csv', report('student', 'csv')) },
          { key: 'b-xlsx', label: 'Student rows — XLSX', onSelect: () => exp('b-xlsx', report('student', 'xlsx')) },
          { key: 'bs-csv', label: 'Batch summary — CSV', onSelect: () => exp('bs-csv', report('batch', 'csv')) },
        ]} />
      </FilterBar>
      {!f.batchId && <EmptyState title="Choose a batch" body="Pick a batch to inspect its courses, chapters and student performance. Nothing is downloaded automatically." />}
      {f.batchId && (d.error ? <ErrorState message={d.error} retry={d.reload} /> : !detail ? <TableSkeleton rows={8} /> : (
        <>
          <Card title={detail.batch.name} description={`${detail.batch.college ?? 'No college'} · ${fmtDate(detail.batch.startDate)} – ${fmtDate(detail.batch.endDate)}`}>
            <DescriptionList cols={3} items={[
              { label: 'Status', value: <StatusBadge status={detail.batch.status} /> },
              { label: 'Trainers', value: detail.batch.trainers?.map((t) => t.fullName).join(', ') || 'None assigned' },
              { label: 'Courses', value: detail.batch.courses?.map((c) => c.title).join(', ') || 'None assigned' },
              { label: 'Reserved enrollments', value: detail.batch.pendingEnrollments ?? 0 },
              { label: 'Enrolled students', value: detail.verification.studentsInScope },
              { label: 'Attendance', value: `${attendancePct(detail.attendance.totals.percentage)} (${detail.attendance.totals.sessions} finalized sessions)` },
            ]} />
          </Card>
          <Grid>
            <StatCard label="Average completion" value={pctText(detail.totals.avgCompletionPct)} />
            <StatCard label="Verified problems" value={detail.totals.verifiedCompletions} tone="good" />
            <StatCard label="LeetCode coverage" value={pctText(detail.verification.coveragePct)} hint={`${detail.verification.verifiedLinks} of ${detail.verification.studentsInScope}`} />
            <StatCard label="Students needing support" value={detail.needsSupport.length} tone={detail.needsSupport.length ? 'warn' : 'default'} />
          </Grid>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Chapter performance" flush>
              <DataTable rows={detail.chapters} rowKey={(r) => r.chapter} caption="Chapter performance"
                empty={<EmptyState compact title="No visible chapters" body="No chapter is visible to this batch yet." />}
                columns={[
                  { key: 'chapter', header: 'Chapter', cell: (r) => r.chapter },
                  { key: 'problems', header: 'Problems', align: 'right', cell: (r) => r.problems },
                  { key: 'completed', header: 'Completed', align: 'right', cell: (r) => <span className="tabular-nums">{r.completedStudents} / {r.students}</span> },
                  { key: 'pct', header: 'Average', className: 'min-w-32', cell: (r) => <ProgressBar value={r.avgCompletionPct} size="sm" label="Average completion" /> },
                ]} />
            </Card>
            <Card title="Performance by difficulty">
              <div className="space-y-3">
                {(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-sm"><span>{k[0] + k.slice(1).toLowerCase()}</span><span className="tabular-nums text-fg-muted">{detail.difficulty[k].available ? `${detail.difficulty[k].solved} / ${detail.difficulty[k].available}` : 'Not assigned'}</span></div>
                    {detail.difficulty[k].available > 0 && <ProgressBar value={(detail.difficulty[k].solved / detail.difficulty[k].available) * 100} label={`${k} completion`} />}
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <Card title="Student performance" description="Filtered by the batch and course above" flush>
            <DataTable rows={paged} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Batch students" empty={<EmptyState title="No students match these filters" />}
              columns={studentColumns}
              onRowClick={(r) => router.push(`/manage/analytics?tab=students&studentId=${r.studentId}&batchId=${f.batchId}`)} />
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
          </Card>
          <Card title="Students who may need support" flush>
            <DataTable rows={detail.needsSupport} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Students needing support"
              empty={<EmptyState compact title="Nobody flagged" />}
              columns={[
                { key: 'name', header: 'Student', cell: (r) => r.name },
                { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
                { key: 'course', header: 'Course', cell: (r) => r.course },
                { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
                { key: 'link', header: 'LeetCode', cell: (r) => <StatusBadge status={r.linkState} /> },
              ]} />
          </Card>
        </>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- courses
function CoursesView({ f, set, exp, report, busy, pickCourse, page, setPage }: ViewProps) {
  const d = useApi<CourseDetailData>(f.courseId ? `/analytics/courses/${f.courseId}${qs({ batchId: f.batchId, collegeId: f.collegeId, difficulty: f.difficulty })}` : null);
  const detail = d.data;
  const rows = detail?.rows ?? [];
  const paged = rows.slice((page - 1) * 25, page * 25);
  return (
    <>
      <FilterBar>
        <Combobox label="Course" value={f.courseId} selectedLabel={detail?.course.title} load={loadCourses} placeholder="Search courses" onChange={pickCourse} emptyLabel="Choose a course" />
        <Combobox label="Batch" value={f.batchId} onChange={(v) => { setPage(1); set({ batchId: v }); }} load={loadBatches} emptyLabel="All batches" />
        <Combobox label="College" value={f.collegeId} onChange={(v) => { setPage(1); set({ collegeId: v }); }} load={loadColleges} emptyLabel="All colleges" />
        <Difficulty value={f.difficulty} onChange={(difficulty) => { setPage(1); set({ difficulty }); }} />
        <ExportMenu label="Export course" busy={busy} items={[
          { key: 'cs-csv', label: 'Course summary — CSV', onSelect: () => exp('cs-csv', report('course', 'csv')) },
          { key: 'cs-xlsx', label: 'Course summary — XLSX', onSelect: () => exp('cs-xlsx', report('course', 'xlsx')) },
          { key: 'cst-csv', label: 'Student context rows — CSV', onSelect: () => exp('cst-csv', report('student', 'csv')) },
          { key: 'cch-csv', label: 'Chapters — CSV', onSelect: () => exp('cch-csv', report('chapter', 'csv')) },
        ]} />
      </FilterBar>
      {!f.courseId && <EmptyState title="Choose a course" body="Select a course to inspect its batches, chapters and student performance." />}
      {f.courseId && (d.error ? <ErrorState message={d.error} retry={d.reload} /> : !detail ? <TableSkeleton rows={8} /> : (
        <>
          <Grid>
            <StatCard label="Unique students" value={detail.uniqueStudents} hint={`${detail.contexts} batch-course rows`} />
            <StatCard label="Average completion" value={pctText(detail.totals.avgCompletionPct)} />
            <StatCard label="Verified problems" value={detail.totals.verifiedCompletions} tone="good" />
            <StatCard label="Batches" value={detail.batches.length} hint="Authorized batches using this course" />
          </Grid>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Batches using this course" flush>
              <DataTable rows={detail.batches} rowKey={(r) => r._id} caption="Course batches"
                empty={<EmptyState compact title="No authorized batches" />}
                columns={[
                  { key: 'name', header: 'Batch', cell: (r) => <span className="font-medium">{r.name}</span> },
                  { key: 'students', header: 'Students', align: 'right', cell: (r) => r.students },
                  { key: 'pct', header: 'Completion', className: 'min-w-32', cell: (r) => <ProgressBar value={r.avgCompletionPct} size="sm" label="Average completion" /> },
                ]} />
            </Card>
            <Card title="Chapter completion" flush>
              <DataTable rows={detail.chapters} rowKey={(r) => r.chapter} caption="Course chapters"
                empty={<EmptyState compact title="No visible chapters" />}
                columns={[
                  { key: 'chapter', header: 'Chapter', cell: (r) => r.chapter },
                  { key: 'problems', header: 'Problems', align: 'right', cell: (r) => r.problems },
                  { key: 'completed', header: 'Completed', align: 'right', cell: (r) => <span className="tabular-nums">{r.completedStudents} / {r.students}</span> },
                  { key: 'pct', header: 'Average', className: 'min-w-28', cell: (r) => <ProgressBar value={r.avgCompletionPct} size="sm" label="Average completion" /> },
                ]} />
            </Card>
          </div>
          <Card title="Student performance" description="One row per student and batch context. The same student in two batches appears twice on purpose." flush>
            <DataTable rows={paged} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Course students" columns={studentColumns} empty={<EmptyState title="No students match these filters" />} />
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
          </Card>
        </>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- chapters
function ChaptersView({ f, set, exp, report, busy, pickCourse, page, setPage }: ViewProps) {
  const course = useApi<CourseDetail>(f.courseId ? `/courses/${f.courseId}` : null);
  const d = useApi<ChapterDetail>(f.courseId && f.chapterId ? `/analytics/chapter${qs({ courseId: f.courseId, chapterId: f.chapterId, batchId: f.batchId, difficulty: f.difficulty })}` : null);
  const detail = d.data;
  const rows = detail?.items ?? [];
  const paged = rows.slice((page - 1) * 25, page * 25);
  return (
    <>
      <FilterBar>
        <Combobox label="Course" value={f.courseId} selectedLabel={course.data?.title} load={loadCourses} placeholder="Search courses" onChange={pickCourse} emptyLabel="Choose a course" />
        <InlineSelect label="Chapter" value={f.chapterId} onChange={(chapterId) => { setPage(1); set({ chapterId }); }}
          options={[{ value: '', label: 'Choose a chapter' }, ...(course.data?.chapters ?? []).filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c._id, label: c.title }))]} />
        <Combobox label="Batch" value={f.batchId} onChange={(v) => { setPage(1); set({ batchId: v }); }} load={loadBatches} emptyLabel="All batches" />
        <Difficulty value={f.difficulty} onChange={(difficulty) => { setPage(1); set({ difficulty }); }} />
        <ExportMenu label="Export chapter" busy={busy} items={[
          { key: 'ch-p', label: 'Problem rows — CSV', onSelect: () => exp('ch-p', report('problem', 'csv')) },
          { key: 'ch-px', label: 'Problem rows — XLSX', onSelect: () => exp('ch-px', report('problem', 'xlsx')) },
          { key: 'ch-c', label: 'Chapter summary — CSV', onSelect: () => exp('ch-c', report('chapter', 'csv')) },
        ]} />
      </FilterBar>
      {!f.courseId && <EmptyState title="Choose a course, then a chapter" body="Chapter analysis respects the chapters currently visible to students." />}
      {f.courseId && !f.chapterId && <EmptyState title="Choose a chapter" body="Select a chapter to see problem and student completion." />}
      {detail && (
        <>
          <Grid>
            <StatCard label="Available problems" value={detail.summary.problems} />
            <StatCard label="Eligible students" value={detail.summary.students} />
            <StatCard label="Completed chapter" value={`${detail.summary.completedStudents} / ${detail.summary.students}`} tone="good" />
            <StatCard label="Average completion" value={pctText(detail.summary.avgCompletionPct)} />
          </Grid>
          <Card title={`${detail.chapter.title} — problems`} flush>
            <DataTable rows={detail.problems} rowKey={(r) => r.slug} caption="Chapter problems"
              empty={<EmptyState compact title="No visible problems" />}
              columns={[
                { key: 'problem', header: 'Problem', cell: (r) => <a className="text-accent-fg hover:underline" href={`https://leetcode.com/problems/${r.slug}/`} target="_blank" rel="noopener noreferrer">{r.problem}</a> },
                { key: 'd', header: 'Difficulty', cell: (r) => <DifficultyBadge d={r.difficulty} /> },
                { key: 'v', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.verifiedSolved} / {r.students}</span> },
                { key: 'pct', header: 'Share verified', className: 'min-w-36', cell: (r) => <ProgressBar value={r.solvedPct} size="sm" label="Share verified" /> },
              ]} />
          </Card>
          <Card title="Student chapter completion" flush>
            <DataTable rows={paged} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Chapter students" empty={<EmptyState title="No students match these filters" />}
              columns={[
                { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
                { key: 'name', header: 'Student', cell: (r) => r.name },
                { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                { key: 'solved', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
                { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Chapter completion" /> },
              ]} />
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
          </Card>
        </>
      )}
      {f.chapterId && d.error && <ErrorState message={d.error} retry={d.reload} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- problems
function ProblemsView({ f, set, exp, report, busy, pickCourse, page, setPage }: ViewProps) {
  const course = useApi<CourseDetail>(f.courseId ? `/courses/${f.courseId}` : null);
  const problems: Option[] = useMemo(() => (course.data?.chapters ?? []).filter((c) => !f.chapterId || c._id === f.chapterId).flatMap((c) => c.problems.filter((p) => p.status === 'ACTIVE').map((p) => ({
    value: p.slug, label: `${c.title} · ${p.title}`, detail: `#${p.order + 1} · ${p.difficulty[0] + p.difficulty.slice(1).toLowerCase()}`,
  }))), [course.data, f.chapterId]);
  const d = useApi<ProblemDetailData>(f.courseId && f.slug ? `/analytics/problem${qs({ courseId: f.courseId, slug: f.slug, batchId: f.batchId, difficulty: f.difficulty })}` : null);
  const detail = d.data;
  const rows = detail?.items ?? [];
  const paged = rows.slice((page - 1) * 25, page * 25);
  const selected = problems.find((p) => p.value === f.slug);
  return (
    <>
      <FilterBar>
        <Combobox label="Course" value={f.courseId} selectedLabel={course.data?.title} load={loadCourses} placeholder="Search courses" onChange={pickCourse} emptyLabel="Choose a course" />
        <InlineSelect label="Chapter" value={f.chapterId} onChange={(chapterId) => { setPage(1); set({ chapterId, slug: '' }); }}
          options={[{ value: '', label: 'All chapters' }, ...(course.data?.chapters ?? []).filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c._id, label: c.title }))]} />
        <Combobox label="Problem" value={f.slug} selectedLabel={selected?.label} options={problems} placeholder="Search title, number or slug" onChange={(slug) => { setPage(1); set({ slug }); }} emptyLabel="Choose a problem" />
        <Combobox label="Batch" value={f.batchId} onChange={(v) => { setPage(1); set({ batchId: v }); }} load={loadBatches} emptyLabel="All batches" />
        <ExportMenu label="Export problem" busy={busy} items={[
          { key: 'pr-csv', label: 'Problem rows — CSV', onSelect: () => exp('pr-csv', report('problem', 'csv', { slug: f.slug, courseId: f.courseId })) },
          { key: 'pr-xlsx', label: 'Problem rows — XLSX', onSelect: () => exp('pr-xlsx', report('problem', 'xlsx', { slug: f.slug, courseId: f.courseId })) },
        ]} />
      </FilterBar>
      {!f.courseId && <EmptyState title="Choose a course" body="Pick a course and chapter to analyse a specific problem." />}
      {f.courseId && !f.slug && <EmptyState title="Choose a problem" body="Search by problem title, order number or canonical slug." />}
      {detail && detail.problem && (
        <>
          <Card title={detail.problem.title} description={<span>#{detail.problem.number ?? '—'} · {detail.problem.slug}</span>}>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <DifficultyBadge d={detail.problem.difficulty} />
              <StatusBadge status={detail.verificationPct === null ? 'NO_DATA' : 'VERIFIED'} label={detail.verificationPct === null ? 'No eligible students' : `${detail.verificationPct}% verified`} />
              <span className="text-fg-muted">{detail.scope.verified} of {detail.scope.students} eligible students have verified completion</span>
            </div>
          </Card>
          <Card title="Student records" description="Not verified means Algora has not observed accepted-submission evidence — not that the student never solved it." flush>
            <DataTable rows={paged} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="Problem students" empty={<EmptyState title="No eligible students for this problem" />}
              columns={[
                { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
                { key: 'name', header: 'Student', cell: (r) => r.name },
                { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                { key: 'verified', header: 'Verified', cell: (r) => <StatusBadge status={r.verified ? 'VERIFIED' : 'PENDING_VERIFICATION'} label={r.verified ? 'Verified' : 'Not yet verified'} /> },
                { key: 'last', header: 'Last verified', cell: (r) => (r.lastVerifiedAt ? timeAgo(r.lastVerifiedAt) : '—') },
              ]} />
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
          </Card>
        </>
      )}
      {f.slug && d.error && <ErrorState message={d.error} retry={d.reload} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- colleges
function CollegesView({ f, set, exp, report, busy, pickCollege, page, setPage }: ViewProps) {
  const d = useApi<CollegeDetailData>(f.collegeId ? `/analytics/colleges/${f.collegeId}${qs({ batchId: f.batchId, difficulty: f.difficulty })}` : null);
  const detail = d.data;
  const rows = detail?.rows ?? [];
  const paged = rows.slice((page - 1) * 25, page * 25);
  return (
    <>
      <FilterBar>
        <Combobox label="College" value={f.collegeId} selectedLabel={detail ? `${detail.college.name}${detail.college.code ? ` [${detail.college.code}]` : ''}` : undefined} load={loadColleges} placeholder="Search name, code or alias" onChange={pickCollege} emptyLabel="Choose a college" />
        <Combobox label="Batch" value={f.batchId} onChange={(v) => { setPage(1); set({ batchId: v }); }} load={loadBatches} emptyLabel="All authorized batches" />
        <Difficulty value={f.difficulty} onChange={(difficulty) => { setPage(1); set({ difficulty }); }} />
        <ExportMenu label="Export college" busy={busy} items={[
          { key: 'col-b', label: 'Batch rows — CSV', onSelect: () => exp('col-b', report('batch', 'csv')) },
          { key: 'col-s', label: 'Student rows — CSV', onSelect: () => exp('col-s', report('student', 'csv')) },
          { key: 'col-sx', label: 'Student rows — XLSX', onSelect: () => exp('col-sx', report('student', 'xlsx')) },
        ]} />
      </FilterBar>
      {!f.collegeId && <EmptyState title="Choose a college" body="Trainers only see students from their authorized batches, even for a college-wide view." />}
      {f.collegeId && (d.error ? <ErrorState message={d.error} retry={d.reload} /> : !detail ? <TableSkeleton rows={8} /> : (
        <>
          <Card title={`${detail.college.name}${detail.college.code ? ` [${detail.college.code}]` : ''}`} description="Only batches you are authorized to analyse are included">
            <DescriptionList cols={3} items={[
              { label: 'College code', value: detail.college.code ?? '—' },
              { label: 'Students', value: detail.totals.enrolledStudents },
              { label: 'Batches', value: detail.totals.batches },
              { label: 'Courses', value: detail.totals.courses },
              { label: 'Attendance', value: attendancePct(detail.attendance.weighted.percentage) },
              { label: 'LeetCode coverage', value: pctText(detail.verification.coveragePct) },
            ]} />
          </Card>
          <Grid>
            <StatCard label="Average completion" value={pctText(detail.totals.avgCompletionPct)} />
            <StatCard label="Verified problems" value={detail.totals.verifiedCompletions} tone="good" />
            <StatCard label="Attendance opportunities" value={detail.attendance.weighted.eligible} hint={`${detail.attendance.weighted.present} present`} />
            <StatCard label="Students needing support" value={detail.needsSupport.length} tone={detail.needsSupport.length ? 'warn' : 'default'} />
          </Grid>
          <Card title="Batch comparison" flush>
            <DataTable rows={detail.batchComparison} rowKey={(r) => r.batchId} caption="College batches"
              empty={<EmptyState compact title="No batches in scope" />}
              columns={[
                { key: 'name', header: 'Batch', cell: (r) => r.name },
                { key: 'students', header: 'Students', align: 'right', cell: (r) => r.students },
                { key: 'verified', header: 'Verified', align: 'right', cell: (r) => r.verifiedCompletions },
                { key: 'pct', header: 'Average completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.avgCompletionPct} size="sm" label="Average completion" /> },
              ]} />
          </Card>
          <Card title="Student performance" flush>
            <DataTable rows={paged} rowKey={(r) => `${r.studentId}-${r.batchCourseId}`} caption="College students" columns={studentColumns} empty={<EmptyState title="No students match these filters" />} />
            <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
          </Card>
        </>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- attendance
function AttendanceView({ f, set, attendanceScope, attendanceExport, busy, exp }: { f: PageState; set: SetState; attendanceScope: Record<string, string>; attendanceExport: (type: string, format: 'csv' | 'xlsx') => string; busy: string | null; exp: (key: string, path: string) => void; report: (type: string, format: 'csv' | 'xlsx', extra?: Record<string, string | undefined>) => string }) {
  const [threshold, setThreshold] = useState('75');
  const range = { ...attendanceScope, sessionType: '' };
  const daily = useApi<{ days: DailyRow[] }>(f.from && f.to ? `/attendance/analytics/daily${qs({ ...range, from: f.from, to: f.to })}` : null);
  const batches = useApi<AttendanceOverview>(`/attendance/analytics/batches${qs(range)}`);
  const low = useApi<{ items: LowAttendanceRow[]; total: number; threshold: number }>(`/attendance/analytics/low${qs({ ...range, threshold, pageSize: 100 })}`);
  const days = daily.data?.days ?? [];
  const weighted = batches.data?.weighted;
  return (
    <>
      <FilterBar>
        <Combobox label="Batch" value={f.batchId} onChange={(v) => set({ batchId: v })} load={loadBatches} emptyLabel="All batches" />
        <Combobox label="College" value={f.collegeId} onChange={(v) => set({ collegeId: v })} load={loadColleges} emptyLabel="All colleges" />
        <label className="text-xs text-fg-muted">From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="ml-1 rounded-md bg-surface px-2 py-1 text-sm ring-1 ring-inset ring-line-strong" /></label>
        <label className="text-xs text-fg-muted">To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="ml-1 rounded-md bg-surface px-2 py-1 text-sm ring-1 ring-inset ring-line-strong" /></label>
        <InlineSelect label="Below threshold" value={threshold} onChange={setThreshold}
          options={[{ value: '90', label: 'Below 90%' }, { value: '80', label: 'Below 80%' }, { value: '75', label: 'Below 75%' }, { value: '60', label: 'Below 60%' }, { value: '50', label: 'Below 50%' }]} />
        <ExportMenu label="Export attendance" busy={busy} items={[
          { key: 'at-b', label: 'Batch attendance — CSV', onSelect: () => exp('at-b', attendanceExport('batch', 'csv')) },
          { key: 'at-bx', label: 'Batch attendance — XLSX', onSelect: () => exp('at-bx', attendanceExport('batch', 'xlsx')) },
          { key: 'at-d', label: 'Daily attendance — CSV', onSelect: () => exp('at-d', attendanceExport('daily', 'csv')) },
          { key: 'at-l', label: 'Low attendance — CSV', onSelect: () => exp('at-l', attendanceExport('low', 'csv')) },
          { key: 'at-c', label: 'College attendance — CSV', onSelect: () => exp('at-c', attendanceExport('college', 'csv')) },
        ]} />
      </FilterBar>
      {(!f.from || !f.to) ? <ErrorState title="Choose a date range" message="Select a start and end date to analyse attendance." /> : (
        <>
          <Grid>
            <StatCard label="Overall attendance" value={attendancePct(weighted?.percentage ?? null)} hint={`${weighted?.present ?? 0} of ${weighted?.eligible ?? 0} opportunities`} />
            <StatCard label="Batches with attendance" value={`${(batches.data?.items ?? []).filter((b) => b.hasData).length} / ${batches.data?.items.length ?? 0}`} hint="Weighted, never an average of percentages" />
            <StatCard label="Low attendance students" value={low.data?.total ?? 0} hint={`Below ${threshold}% in this range`} tone={(low.data?.total ?? 0) > 0 ? 'warn' : 'default'} />
            <StatCard label="Recorded days" value={days.filter((d) => d.overall.eligible).length} hint={`${days.length} days in range`} />
          </Grid>
          <Card title="Daily attendance" description="Days without a recorded session stay unrecorded, never absent">
            {days.some((d) => d.overall.eligible) ? (
              <BarList items={days.filter((d) => d.overall.eligible).slice(-31).map((d) => ({ key: d.date, label: d.date, value: d.overall.percentage, sub: `${d.overall.present}/${d.overall.eligible}` }))} max={100} format={(n) => `${Math.round(n)}%`} />
            ) : <p className="py-6 text-center text-sm text-fg-subtle">No attendance has been recorded for this period.</p>}
          </Card>
          <Card title="Batch attendance" flush>
            <DataTable rows={batches.data?.items ?? []} rowKey={(r) => r.batchId} caption="Batch attendance"
              empty={<EmptyState title="No batches in scope" />}
              columns={[
                { key: 'name', header: 'Batch', cell: (r) => r.name },
                { key: 'students', header: 'Students', align: 'right', cell: (r) => r.students },
                { key: 'sessions', header: 'Sessions', align: 'right', cell: (r) => r.sessions || '—' },
                { key: 'pct', header: 'Overall', align: 'right', cell: (r) => (r.hasData ? <span className="font-medium tabular-nums">{attendancePct(r.percentage)}</span> : <StatusBadge status="NO_DATA" label="No attendance" />) },
                { key: 'm', header: 'Morning', align: 'right', cell: (r) => (r.morning.sessions ? attendancePct(r.morning.percentage) : '—') },
                { key: 'a', header: 'Afternoon', align: 'right', cell: (r) => (r.afternoon.sessions ? attendancePct(r.afternoon.percentage) : '—') },
              ]} />
          </Card>
          <Card title={`Students below ${threshold}%`} description="Students with no eligible finalized sessions are never flagged" flush>
            <DataTable rows={low.data?.items ?? []} rowKey={(r) => `${r.studentId}-${r.batchId}`} caption="Low attendance"
              empty={<EmptyState title="No students below this threshold" />}
              columns={[
                { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
                { key: 'name', header: 'Student', cell: (r) => r.name },
                { key: 'batch', header: 'Batch', cell: (r) => r.batch },
                { key: 'eligible', header: 'Eligible', align: 'right', cell: (r) => r.eligible },
                { key: 'present', header: 'Present', align: 'right', cell: (r) => r.present },
                { key: 'absent', header: 'Absent', align: 'right', cell: (r) => r.absent },
                { key: 'pct', header: 'Attendance', align: 'right', cell: (r) => <span className="font-medium tabular-nums text-danger-fg">{attendancePct(r.percentage)}</span> },
              ]} />
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------- shared pieces
const studentColumns: Column<PerfRow>[] = [
  { key: 'roll', header: 'Roll number', cell: (r) => <span className="tabular-nums">{r.rollNumber}</span> },
  { key: 'name', header: 'Student', cell: (r) => <Link className="font-medium text-accent-fg hover:underline" href={`/manage/students/${r.studentId}`}>{r.name}</Link> },
  { key: 'course', header: 'Course', cell: (r) => r.course },
  { key: 'solved', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved} / {r.accessible}</span> },
  { key: 'e', header: 'Easy', align: 'right', cell: (r) => r.easy },
  { key: 'm', header: 'Medium', align: 'right', cell: (r) => r.medium },
  { key: 'h', header: 'Hard', align: 'right', cell: (r) => r.hard },
  { key: 'points', header: 'Points', align: 'right', cell: (r) => <span className="font-semibold tabular-nums">{r.points}</span> },
  { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
  { key: 'rank', header: 'Rank', align: 'right', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
];

type PageState = { tab: string; batchId: string; courseId: string; chapterId: string; collegeId: string; studentId: string; slug: string; difficulty: string; q: string; from: string; to: string; page: string };
type SetState = (patch: Partial<PageState>) => void;
interface ViewProps { f: PageState; set: SetState; scope: Record<string, string>; exp: (key: string, path: string) => void; report: (type: string, format: 'csv' | 'xlsx', extra?: Record<string, string | undefined>) => string; busy: string | null; page: number; setPage: (p: number) => void; pickBatch: (id: string) => void; pickCourse: (id: string) => void; pickCollege: (id: string) => void }

function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Analytics filters">{children}</div>;
}
function Difficulty({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <InlineSelect label="Difficulty" value={value} onChange={onChange}
    options={[{ value: '', label: 'All difficulties' }, { value: 'EASY', label: 'Easy' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HARD', label: 'Hard' }]} />;
}
function ExportMenu({ label, items, busy }: { label: string; items: { key: string; label: string; onSelect: () => void }[]; busy: string | null }) {
  return <Menu label={label} icon={<Download size={15} aria-hidden />} variant="secondary" items={items.map((i) => ({ label: busy === i.key ? `${i.label}…` : i.label, onSelect: i.onSelect, disabled: !!busy }))} />;
}
