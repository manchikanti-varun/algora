'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { z } from 'zod';
import { apiMutate } from '@/lib/api/client';
import { useAdministration } from '@/features/administration/queries';
import { CollegePicker, CoursePicker } from '@/features/learning/options';
import {
  QueryState,
  DataTable,
  Pagination,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { StudentShell } from '@/features/students/shell';
import { ReportDownloads } from '@/features/coding/report-downloads';
import {
  overviewSchema,
  batchSchema,
  personalSchema,
  type Coding,
  type Follow,
} from './contracts';
export const percent = (value: number | null) =>
  value === null ? 'N/A' : (value * 100).toFixed(1) + '%';
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not yet available';
const reason = (value: string) => value.toLowerCase().replaceAll('_', ' ');
function useFilters() {
  const search = useSearchParams(),
    router = useRouter(),
    path = usePathname();
  const params = new URLSearchParams(search.toString());
  const set = (values: Record<string, string>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(values)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('page' in values)) p.delete('page');
    router.replace(path + '?' + p.toString(), { scroll: false });
  };
  const api = new URLSearchParams(params);
  api.delete('tab');
  return { params, set, query: api.toString() };
}
export function MetricCards({
  items,
}: {
  items: { label: string; value: string | number; href?: string }[];
}) {
  return (
    <div className="analytics-kpis">
      {items.map((item) => (
        <article className="student-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.href && (
            <Link href={item.href}>
              View details <span aria-hidden="true">→</span>
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}
export function CodingCards({ value }: { value: Coding }) {
  return (
    <>
      <MetricCards
        items={[
          { label: 'Assigned opportunities', value: value.assigned },
          { label: 'Verified solved', value: value.solved },
          { label: 'Verified attempted', value: value.attempted },
          {
            label: 'No verified accepted submission checked',
            value: value.noVerifiedSolve,
          },
          { label: 'Verification unavailable', value: value.unavailable },
          { label: 'Verified completion', value: percent(value.completion) },
          { label: 'Verification coverage', value: percent(value.coverage) },
        ]}
      />
      <p className="analytics-note">
        Verified attempted is included in the checked no verified accepted
        submission count. Unavailable verification is separate and does not
        prove a Student has not solved a problem. Completion uses all assigned
        opportunities.
      </p>
    </>
  );
}
export function AnalyticsChart({
  title,
  points,
  line = false,
}: {
  title: string;
  points: { label: string; value: number | null }[];
  line?: boolean;
}) {
  const id = useId(),
    valid = points.filter((p) => p.value !== null);
  if (!valid.length)
    return (
      <section className="student-card">
        <h3>{title}</h3>
        <p>No comparable data yet. Zero denominators are N/A.</p>
      </section>
    );
  const width = Math.max(500, points.length * 55),
    height = 230,
    left = 42,
    bottom = 190,
    step = (width - left - 15) / Math.max(points.length, 1);
  const coords: string[][] = [[]];
  points.forEach((p, i) => {
    if (p.value === null) {
      coords.push([]);
      return;
    }
    coords[coords.length - 1]!.push(
      `${left + step * (i + 0.5)},${bottom - 160 * p.value}`,
    );
  });
  return (
    <figure className="student-card analytics-chart">
      <figcaption>{title}</figcaption>
      <div className="data-table-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
          role="img"
          aria-labelledby={id + '-title ' + id + '-desc'}
        >
          <title id={id + '-title'}>{title}</title>
          <desc id={id + '-desc'}>
            Percentage scale from 0 to 100. Exact values follow in the chart
            description.
          </desc>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line
                x1={left}
                x2={width - 10}
                y1={bottom - t * 160}
                y2={bottom - t * 160}
                className="analytics-gridline"
              />
              <text x={2} y={bottom - t * 160 + 4}>
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {line &&
            coords
              .filter((segment) => segment.length > 1)
              .map((segment, i) => (
                <polyline
                  key={i}
                  points={segment.join(' ')}
                  fill="none"
                  className="analytics-line"
                />
              ))}
          {points.map((p, i) => (
            <g key={p.label}>
              <title>{p.label + ': ' + percent(p.value)}</title>
              {p.value !== null &&
                (line ? (
                  <circle
                    cx={left + step * (i + 0.5)}
                    cy={bottom - 160 * p.value}
                    r={4}
                  />
                ) : (
                  <rect
                    x={left + step * (i + 0.2)}
                    width={step * 0.6}
                    y={bottom - 160 * p.value}
                    height={Math.max(1, 160 * p.value)}
                  />
                ))}
              <text x={left + step * (i + 0.5)} y={210} textAnchor="middle">
                {p.label.length > 14 ? p.label.slice(0, 12) + '…' : p.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="analytics-note">
        {points.map((p) => p.label + ': ' + percent(p.value)).join(' · ')}
      </p>
    </figure>
  );
}
function Filters({
  staff = false,
  superAdmin = false,
  batch = false,
  days = [],
  batches = [],
  personal = false,
  fixedDay,
}: {
  staff?: boolean;
  superAdmin?: boolean;
  batch?: boolean;
  personal?: boolean;
  fixedDay?: number;
  days?: { day: number; title: string }[];
  batches?: { id: string; name: string }[];
}) {
  const { params, set } = useFilters();
  const field = (
    key: string,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={params.get(key) ?? ''}
        onChange={(e) => set({ [key]: e.target.value })}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="student-card">
      <h2>Analytics filters</h2>
      <div className="analytics-filters">
        {staff && !batch && (
          <>
            <CollegePicker
              superAdmin={superAdmin}
              permission="progress.view"
              value={params.get('collegeId') ?? ''}
              onChange={(collegeId) =>
                set({ collegeId, courseId: '', batchId: '', day: '' })
              }
            />
            <CoursePicker
              collegeId={params.get('collegeId') ?? ''}
              value={params.get('courseId') ?? ''}
              onChange={(courseId) => set({ courseId, batchId: '', day: '' })}
            />
          </>
        )}
        {!batch &&
          batches.length > 0 &&
          field(
            'batchId',
            'Batch',
            batches.map((b) => ({ value: b.id, label: b.name })),
          )}
        {fixedDay ? (
          <p>Selected Learning Day {fixedDay}</p>
        ) : days.length ? (
          field(
            'day',
            'Learning Day',
            days.map((d) => ({
              value: String(d.day),
              label: 'Day ' + d.day + ' ' + d.title,
            })),
          )
        ) : (
          <label>
            Learning Day
            <input
              aria-label="Learning Day"
              type="number"
              min={1}
              max={1000000000}
              defaultValue={params.get('day') ?? ''}
              onBlur={(e) => set({ day: e.target.value })}
            />
          </label>
        )}
        {field(
          'platform',
          'Platform',
          ['CODEFORCES', 'LEETCODE', 'CODECHEF'].map((v) => ({
            value: v,
            label: v,
          })),
        )}
        {!personal && (
          <>
            {field(
              'year',
              'Student Year',
              [1, 2, 3, 4].map((y) => ({
                value: String(y),
                label: 'Year ' + y,
              })),
            )}
            {field(
              'verification',
              'Coding account verification',
              [
                'UNLINKED',
                'PENDING_VERIFICATION',
                'VERIFIED',
                'VERIFICATION_UNAVAILABLE',
                'REVOKED',
              ].map((v) => ({ value: v, label: reason(v) })),
            )}
          </>
        )}
        <form
          key={params.toString()}
          className="analytics-date-form"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget),
              from = String(fd.get('from') ?? ''),
              to = String(fd.get('to') ?? '');
            set({
              from: from ? new Date(from + 'T00:00:00Z').toISOString() : '',
              to: to ? new Date(to + 'T23:59:59.999Z').toISOString() : '',
              ...(!personal ? { search: String(fd.get('search') ?? '') } : {}),
            });
          }}
        >
          {!personal && (
            <label>
              Student search
              <input
                name="search"
                aria-label="Student search"
                defaultValue={params.get('search') ?? ''}
                maxLength={100}
              />
            </label>
          )}
          <label>
            From date UTC
            <input
              type="date"
              name="from"
              aria-label="From date UTC"
              defaultValue={params.get('from')?.slice(0, 10) ?? ''}
            />
          </label>
          <label>
            To date UTC
            <input
              type="date"
              name="to"
              aria-label="To date UTC"
              defaultValue={params.get('to')?.slice(0, 10) ?? ''}
            />
          </label>
          <Button type="submit">Apply search and dates</Button>
        </form>
      </div>
      <p className="analytics-note">
        Supply both dates, within 366 days. Coding dates filter accepted or
        first verified attempt timestamps; attendance dates filter session
        creation dates. Platform and account verification filters apply to
        coding only. Registration totals describe the selected College
        population.
      </p>
    </section>
  );
}
function FollowTable({ items, base }: { items: Follow[]; base: string }) {
  return (
    <DataTable
      items={items}
      empty="No matching follow-up evidence"
      columns={[
        {
          key: 'student',
          label: 'Student',
          render: (r) => (
            <Link
              href={base + '/students?search=' + encodeURIComponent(r.roll)}
            >
              {r.name} · {r.roll}
            </Link>
          ),
        },
        {
          key: 'batch',
          label: 'Batch',
          render: (r) =>
            r.batchId ? (
              <Link href={base + '/batches/' + r.batchId + '/analytics'}>
                {r.batch}
              </Link>
            ) : (
              r.batch
            ),
        },
        { key: 'reason', label: 'Reason', render: (r) => reason(r.reason) },
        {
          key: 'evidence',
          label: 'Evidence',
          render: (r) =>
            r.reason === 'REPEATED_ABSENCE'
              ? `${r.absent} finalized absences`
              : r.reason === 'LOW_COMPLETION'
                ? `${percent(r.completion)} completion · ${percent(r.coverage)} coverage · ${r.assigned} opportunities`
                : r.reason === 'SYNC_STALE'
                  ? 'Last successful sync ' + date(r.lastSuccess)
                  : reason(r.reason),
        },
        {
          key: 'updated',
          label: 'Last updated',
          render: (r) => date(r.updatedAt),
        },
      ]}
    />
  );
}
function FollowControls() {
  const { params, set } = useFilters();
  return (
    <div className="analytics-filters">
      <label>
        Follow-up reason
        <select
          aria-label="Follow-up reason"
          value={params.get('reason') ?? ''}
          onChange={(e) => set({ reason: e.target.value })}
        >
          <option value="">All reasons</option>
          {[
            'REPEATED_ABSENCE',
            'LOW_COMPLETION',
            'ACCOUNT_VERIFICATION',
            'SYNC_FAILED',
            'SYNC_STALE',
            'PENDING_REGISTRATION',
            'MISSING_YEAR',
          ].map((r) => (
            <option key={r} value={r}>
              {reason(r)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sort follow-up
        <select
          aria-label="Sort follow-up"
          value={params.get('sort') ?? 'roll'}
          onChange={(e) => set({ sort: e.target.value })}
        >
          <option value="roll">Roll number</option>
          <option value="name">Name</option>
          <option value="reason">Reason</option>
        </select>
      </label>
    </div>
  );
}
export function OperationalDashboard({
  superAdmin = false,
  followUp = false,
}: {
  superAdmin?: boolean;
  followUp?: boolean;
}) {
  const { query, set } = useFilters(),
    q = useAdministration(
      '/analytics/' +
        (superAdmin ? 'platform' : followUp ? 'follow-up' : 'overview') +
        '?' +
        query,
      overviewSchema,
    ),
    base = superAdmin ? '/super-admin' : '/admin',
    data = q.data;
  return (
    <>
      <Filters staff superAdmin={superAdmin} batches={data?.batches} />
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {data && (
          <>
            <p className="analytics-note">
              Calculated {date(data.generatedAt)} on demand. Coding progress
              depends on provider synchronization. Full analytics requires
              college.view, student.view, attendance.manage and progress.view.
            </p>
            {followUp ? (
              <>
                <h2>Students requiring follow-up</h2>
                <p>
                  Rules: at least 2 finalized absences; low completion below 40%
                  only with at least 5 opportunities and 80% verification
                  coverage; stale synchronization after 24 hours since the last
                  success. These are operational review signals.
                </p>
                <FollowControls />
                <FollowTable items={data.followUp.items} base={base} />
                <Pagination
                  {...data.followUp}
                  onChange={(page) => set({ page: String(page) })}
                />
              </>
            ) : (
              <>
                <MetricCards
                  items={[
                    ...(superAdmin
                      ? [
                          {
                            label: 'Total Colleges',
                            value: data.summary.colleges,
                            href: base + '/colleges',
                          },
                          {
                            label: 'Active Colleges',
                            value: data.summary.activeColleges,
                            href: base + '/colleges',
                          },
                          {
                            label: 'Registered Students',
                            value: data.summary.registeredStudents,
                            href: base + '/students',
                          },
                          {
                            label: 'Verified Students',
                            value: data.summary.verifiedStudents,
                            href: base + '/students',
                          },
                          {
                            label: 'Courses',
                            value: data.summary.courses,
                            href: base + '/courses',
                          },
                        ]
                      : []),
                    {
                      label: 'Active Batches',
                      value: data.summary.activeBatches,
                      href: base + '/batches',
                    },
                    {
                      label: 'Enrolled Students',
                      value: data.summary.enrolledStudents,
                      href: base + '/batches',
                    },
                    {
                      label: 'Total enrollments',
                      value: data.summary.enrollments,
                      href: base + '/batches',
                    },
                    {
                      label: 'Released Learning Days',
                      value: data.summary.learningDays,
                      href: base + '/batches',
                    },
                    {
                      label: 'Assigned coding problems',
                      value: data.summary.assignedProblems,
                      href: base + '/progress',
                    },
                    {
                      label: 'Finalized attendance sessions',
                      value: data.summary.attendanceSessions,
                      href: base + '/attendance',
                    },
                    {
                      label: 'Finalized attendance',
                      value: percent(data.summary.attendance.percentage),
                      href: base + '/attendance',
                    },
                    {
                      label: 'Verified coding completion',
                      value: percent(data.summary.coding.completion),
                      href: base + '/progress',
                    },
                    {
                      label: 'Verification coverage',
                      value: percent(data.summary.coding.coverage),
                      href: base + '/progress',
                    },
                    {
                      label: 'Students requiring follow-up',
                      value: data.summary.followUpStudents,
                      href: base + '/follow-up',
                    },
                  ]}
                />
                <h2>Batch operations</h2>
                <DataTable
                  items={data.batches}
                  empty="No authorized Batches match"
                  columns={[
                    {
                      key: 'name',
                      label: 'Batch',
                      render: (b) => (
                        <Link href={base + '/batches/' + b.id + '/analytics'}>
                          {b.name}
                        </Link>
                      ),
                    },
                    { key: 'course', label: 'Course', render: (b) => b.course },
                    { key: 'status', label: 'Status', render: (b) => b.status },
                    {
                      key: 'coding',
                      label: 'Verified completion',
                      render: (b) => percent(b.coding.completion),
                    },
                    {
                      key: 'coverage',
                      label: 'Verification coverage',
                      render: (b) => percent(b.coding.coverage),
                    },
                    {
                      key: 'sync',
                      label: 'Last successful sync',
                      render: (b) => date(b.lastSuccess),
                    },
                  ]}
                />
                <AnalyticsChart
                  title="Batch verified completion comparison"
                  points={data.batches.map((b) => ({
                    label: b.name,
                    value: b.coding.completion,
                  }))}
                />
                {superAdmin && (
                  <>
                    <h2>College performance</h2>
                    <DataTable
                      items={data.colleges.items}
                      empty="No Colleges match"
                      columns={[
                        {
                          key: 'name',
                          label: 'College',
                          render: (c) => c.name + ' · ' + c.code,
                        },
                        {
                          key: 'registered',
                          label: 'Registered Students',
                          render: (c) => c.registeredStudents,
                        },
                        {
                          key: 'batches',
                          label: 'Active Batches',
                          render: (c) => c.activeBatches,
                        },
                        {
                          key: 'enrolled',
                          label: 'Enrolled Students',
                          render: (c) => c.enrolledStudents,
                        },
                        {
                          key: 'attendance',
                          label: 'Finalized attendance',
                          render: (c) => percent(c.attendance.percentage),
                        },
                        {
                          key: 'completion',
                          label: 'Verified completion',
                          render: (c) => percent(c.coding.completion),
                        },
                        {
                          key: 'coverage',
                          label: 'Coverage',
                          render: (c) => percent(c.coding.coverage),
                        },
                        {
                          key: 'last',
                          label: 'Last relevant activity',
                          render: (c) => date(c.lastActivity),
                        },
                      ]}
                    />
                    <Pagination
                      {...data.colleges}
                      onChange={(page) => set({ page: String(page) })}
                    />
                  </>
                )}
                <h2>Instructor actions</h2>
                <ul className="analytics-actions">
                  {data.alerts.items.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={
                          a.batchId
                            ? base + '/batches/' + a.batchId + '/' + a.target
                            : base +
                              '/' +
                              (a.target === 'admins' && !superAdmin
                                ? 'students'
                                : a.target)
                        }
                      >
                        {a.message}
                      </Link>
                    </li>
                  ))}
                </ul>
                {!data.alerts.total && (
                  <p>No actionable conditions were found in this selection.</p>
                )}
                <Pagination
                  {...data.alerts}
                  onChange={(page) => set({ page: String(page) })}
                />
                <Link href={base + '/follow-up' + (query ? '?' + query : '')}>
                  Review Student follow-up evidence →
                </Link>
              </>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
export function BatchAnalytics({
  batchId,
  superAdmin = false,
  day,
}: {
  batchId: string;
  superAdmin?: boolean;
  day?: number;
}) {
  const { params, query, set } = useFilters(),
    api = new URLSearchParams(query);
  if (day) api.set('day', String(day));
  const q = useAdministration(
      '/analytics/batches/' + batchId + (day ? '/days/' + day : '') + '?' + api,
      batchSchema,
    ),
    data = q.data,
    base = superAdmin ? '/super-admin' : '/admin',
    tab = params.get('tab') ?? (day ? 'Learning Days' : 'Overview');
  const tabs = [
    'Overview',
    'Attendance',
    'Coding Progress',
    'Learning Days',
    'Students',
    'Reports',
  ];
  const filters = Object.fromEntries(api.entries());
  for (const k of [
    'sort',
    'direction',
    'reason',
    'batchId',
    'page',
    'pageSize',
  ])
    delete filters[k];
  return (
    <>
      <nav aria-label="Breadcrumb">
        <Link href={base}>Dashboard</Link> /{' '}
        <Link href={base + '/batches/' + batchId}>Batch</Link> /{' '}
        <Link href={base + '/batches/' + batchId + '/analytics'}>
          Analytics
        </Link>
        {day ? ' / Day ' + day : ''}
      </nav>
      <Filters
        staff
        superAdmin={superAdmin}
        batch
        days={data?.days}
        fixedDay={day}
      />
      <nav className="analytics-tabs" aria-label="Batch analytics views">
        {tabs.map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'outline'}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => set({ tab: t, page: '' })}
          >
            {t}
          </Button>
        ))}
      </nav>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {data && (
          <>
            <h2>
              {data.batch.name} {day ? ' · Day ' + day : ''}
            </h2>
            <p>
              {data.batch.college} / {data.batch.course} · {data.batch.status} ·
              Pinned revision{' '}
              {data.batch.curriculumRevisionId ?? 'Not assigned'}
            </p>
            <p className="analytics-note">
              Last successful coding synchronization:{' '}
              {date(data.freshness.lastSuccess)} · Pending accounts:{' '}
              {data.freshness.pending} · Failed accounts:{' '}
              {data.freshness.failed} · Unavailable opportunities:{' '}
              {data.freshness.unavailable}. Attendance is finalized only;
              corrections are reflected.
            </p>
            {tab === 'Overview' && (
              <>
                <MetricCards
                  items={[
                    {
                      label: 'Eligible Students',
                      value: data.summary.eligibleStudents,
                    },
                    {
                      label: 'Released Learning Days',
                      value: data.summary.releasedDays,
                    },
                    {
                      label: 'Assigned problems',
                      value: data.summary.assignedProblems,
                    },
                    {
                      label: 'Finalized attendance',
                      value: percent(data.summary.attendance.percentage),
                    },
                    {
                      label: 'Pending finalization',
                      value: data.summary.pendingSessions,
                      href: base + '/batches/' + batchId + '/attendance',
                    },
                  ]}
                />
                <CodingCards value={data.summary.coding} />
                <h3>Daily bootcamp attendance</h3>
                <SessionTable
                  data={data.sessions}
                  base={base}
                  batchId={batchId}
                />
                <h3>Instructor follow-up evidence</h3>
                <FollowTable items={data.followUp.items} base={base} />
                <Pagination
                  {...data.followUp}
                  onChange={(page) => set({ page: String(page) })}
                />
              </>
            )}
            {tab === 'Attendance' && (
              <>
                <p>
                  Morning and Afternoon are separate Student-session
                  opportunities. Unfinalized sessions never establish confirmed
                  absence. EXCUSED marks remain eligible finalized opportunities
                  in this Phase 9 rate.
                </p>
                <SessionTable
                  data={data.sessions}
                  base={base}
                  batchId={batchId}
                />
                <AnalyticsChart
                  title="Finalized attendance trend"
                  line
                  points={data.sessions.map((s) => ({
                    label: 'D' + s.day + ' ' + s.type,
                    value: s.percentage,
                  }))}
                />
                <h3>Student attendance matrix</h3>
                <DataTable
                  items={data.attendanceMatrix.items}
                  columns={[
                    {
                      key: 'name',
                      label: 'Student',
                      render: (s) => s.roll + ' · ' + s.name,
                    },
                    {
                      key: 'marks',
                      label: 'Day and session marks',
                      render: (s) => (
                        <ul>
                          {s.marks.map((m) => (
                            <li key={m.sessionId}>
                              Day {m.day} {m.type}: {m.status}{' '}
                              {m.official ? 'Finalized' : 'Provisional'}{' '}
                              {m.corrected ? 'Corrected' : ''}
                            </li>
                          ))}
                        </ul>
                      ),
                    },
                  ]}
                  empty="No attendance snapshots"
                />
                <Pagination
                  {...data.attendanceMatrix}
                  onChange={(page) => set({ page: String(page) })}
                />
              </>
            )}
            {tab === 'Coding Progress' && (
              <>
                <CodingCards value={data.summary.coding} />
                <AnalyticsChart
                  title="Day wise verified coding completion"
                  points={data.days.map((d) => ({
                    label: 'Day ' + d.day,
                    value: d.coding.completion,
                  }))}
                />
                <AnalyticsChart
                  title="Platform verification coverage"
                  points={data.platforms.map((p) => ({
                    label: p.platform,
                    value: p.coding.coverage,
                  }))}
                />
                <AnalyticsChart
                  title="Problem verified solve rates"
                  points={data.problems.map((p) => ({
                    label: 'D' + p.day + ' ' + p.problemKey,
                    value: p.coding.completion,
                  }))}
                />
                <ProblemTable
                  items={data.problems}
                  base={base}
                  batchId={batchId}
                />
                <p>
                  Low solve rate review: below 40% completion with at least 5
                  opportunities and 80% coverage.
                </p>
                <ul>
                  {data.problems
                    .filter(
                      (p) =>
                        p.coding.assigned >= 5 &&
                        (p.coding.coverage ?? 0) >= 0.8 &&
                        (p.coding.completion ?? 1) < 0.4,
                    )
                    .map((p) => (
                      <li key={p.id}>
                        <Link
                          href={
                            base +
                            '/batches/' +
                            batchId +
                            '/analytics/days/' +
                            p.day
                          }
                        >
                          {p.title}: review sufficient-coverage low solve rate
                        </Link>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {tab === 'Learning Days' && (
              <>
                <DataTable
                  items={data.days}
                  empty="No released Learning Days"
                  columns={[
                    {
                      key: 'day',
                      label: 'Day',
                      render: (d) => (
                        <Link
                          href={
                            base +
                            '/batches/' +
                            batchId +
                            '/analytics/days/' +
                            d.day
                          }
                        >
                          {d.day} · {d.title}
                        </Link>
                      ),
                    },
                    {
                      key: 'assign',
                      label: 'Published problems',
                      render: (d) => d.publishedAssignments,
                    },
                    {
                      key: 'eligible',
                      label: 'Eligible Students',
                      render: (d) => d.eligibleStudents,
                    },
                    {
                      key: 'morning',
                      label: 'Morning attendance',
                      render: (d) => percent(d.morning.percentage),
                    },
                    {
                      key: 'afternoon',
                      label: 'Afternoon attendance',
                      render: (d) => percent(d.afternoon.percentage),
                    },
                    {
                      key: 'coding',
                      label: 'Verified completion',
                      render: (d) => percent(d.coding.completion),
                    },
                    {
                      key: 'coverage',
                      label: 'Verification coverage',
                      render: (d) => percent(d.coding.coverage),
                    },
                  ]}
                />
                {day && (
                  <>
                    <CodingCards value={data.summary.coding} />
                    <SessionTable
                      data={data.sessions}
                      base={base}
                      batchId={batchId}
                    />
                    <ProblemTable
                      items={data.problems}
                      base={base}
                      batchId={batchId}
                    />
                  </>
                )}
              </>
            )}
            {tab === 'Students' && (
              <>
                <div className="analytics-filters">
                  <label>
                    Sort students
                    <select
                      aria-label="Sort students"
                      value={params.get('sort') ?? 'roll'}
                      onChange={(e) => set({ sort: e.target.value })}
                    >
                      {[
                        ['roll', 'Roll number'],
                        ['name', 'Name'],
                        ['completion', 'Completion'],
                        ['attendance', 'Attendance'],
                        ['lastSuccess', 'Last successful sync'],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Sort direction
                    <select
                      aria-label="Sort direction"
                      value={params.get('direction') ?? 'asc'}
                      onChange={(e) => set({ direction: e.target.value })}
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </label>
                </div>
                <DataTable
                  items={data.students.items}
                  empty="No eligible Students match"
                  columns={[
                    {
                      key: 'roll',
                      label: 'Roll number',
                      render: (s) => (
                        <Link
                          href={
                            base +
                            '/students?search=' +
                            encodeURIComponent(s.roll)
                          }
                        >
                          {s.roll}
                        </Link>
                      ),
                    },
                    {
                      key: 'name',
                      label: 'Student name',
                      render: (s) => s.name,
                    },
                    {
                      key: 'year',
                      label: 'Year',
                      render: (s) => s.year ?? 'Not provided',
                    },
                    {
                      key: 'attendance',
                      label: 'Attendance',
                      render: (s) => percent(s.attendance.percentage),
                    },
                    {
                      key: 'assigned',
                      label: 'Assigned',
                      render: (s) => s.coding.assigned,
                    },
                    {
                      key: 'solved',
                      label: 'Verified solved',
                      render: (s) => s.coding.solved,
                    },
                    {
                      key: 'attempted',
                      label: 'Verified attempted',
                      render: (s) => s.coding.attempted,
                    },
                    {
                      key: 'unavailable',
                      label: 'Verification unavailable',
                      render: (s) => s.coding.unavailable,
                    },
                    {
                      key: 'completion',
                      label: 'Verified completion',
                      render: (s) => percent(s.coding.completion),
                    },
                    {
                      key: 'last',
                      label: 'Last sync',
                      render: (s) => date(s.lastSync),
                    },
                  ]}
                />
                <Pagination
                  {...data.students}
                  onChange={(page) => set({ page: String(page) })}
                />
              </>
            )}
            {tab === 'Reports' && (
              <>
                <h3>Coding progress downloads</h3>
                <p>
                  Uses the same authorized matching assignment data as these
                  coding metrics. Select Batch-wise, Day-wise, Problem-wise,
                  Student-wise or Complete Batch.
                </p>
                <ReportDownloads batchId={batchId} filters={filters} />
                <h3>Attendance analytics downloads</h3>
                <AttendanceDownloads
                  batchId={batchId}
                  filters={Object.fromEntries(api.entries())}
                />
                <Link
                  href={base + '/batches/' + batchId + '/attendance/reports'}
                >
                  Open existing attendance Excel and CSV reports
                </Link>
                <p>
                  The analytics download uses this dashboard selection and its
                  all eligible finalized opportunities denominator. The older
                  attendance report screen retains its Phase 7 policy excluding
                  EXCUSED.
                </p>
              </>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
function AttendanceDownloads({
  batchId,
  filters,
}: {
  batchId: string;
  filters: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function download(format: 'CSV' | 'XLSX') {
    setBusy(true);
    setMessage('');
    try {
      const file = await apiMutate(
        '/analytics/batches/' + batchId + '/attendance/export',
        'POST',
        z.object({
          filename: z
            .string()
            .regex(/^algora-attendance-analytics\.(?:csv|xlsx)$/),
          mime: z.string(),
          base64: z.string().max(14 * 1024 * 1024),
        }),
        { format, confirmed: true, filters },
      );
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)),
        url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage('Attendance analytics downloaded.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Download unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <Button disabled={busy} onClick={() => void download('XLSX')}>
        Attendance analytics Excel
      </Button>{' '}
      <Button
        disabled={busy}
        variant="outline"
        onClick={() => void download('CSV')}
      >
        Attendance analytics CSV
      </Button>
      <p role="status">{busy ? 'Preparing private report…' : message}</p>
    </div>
  );
}
function SessionTable({
  data,
  base,
  batchId,
}: {
  data: import('zod').z.infer<typeof batchSchema>['sessions'];
  base: string;
  batchId: string;
}) {
  return (
    <DataTable
      items={data}
      empty="No attendance sessions in this selection"
      columns={[
        { key: 'day', label: 'Day', render: (s) => s.day + ' · ' + s.title },
        {
          key: 'type',
          label: 'Session',
          render: (s) => (
            <Link href={base + '/batches/' + batchId + '/attendance/' + s.id}>
              {s.type}
            </Link>
          ),
        },
        { key: 'status', label: 'Status', render: (s) => s.status },
        {
          key: 'eligible',
          label: 'Eligible Students',
          render: (s) => s.eligible,
        },
        { key: 'present', label: 'Present marks', render: (s) => s.present },
        {
          key: 'absent',
          label: 'Confirmed absent',
          render: (s) => s.absent ?? 'Not finalized',
        },
        {
          key: 'rate',
          label: 'Finalized attendance',
          render: (s) => percent(s.percentage),
        },
      ]}
    />
  );
}
function ProblemTable({
  items,
  base,
  batchId,
}: {
  items: import('zod').z.infer<typeof batchSchema>['problems'];
  base: string;
  batchId: string;
}) {
  return (
    <DataTable
      items={items}
      empty="No released problem assignments"
      columns={[
        {
          key: 'title',
          label: 'Problem assignment',
          render: (p) => (
            <Link href={base + '/batches/' + batchId + '/curriculum'}>
              Day {p.day} · {p.title}
            </Link>
          ),
        },
        { key: 'platform', label: 'Platform', render: (p) => p.platform },
        {
          key: 'assigned',
          label: 'Opportunities',
          render: (p) => p.coding.assigned,
        },
        {
          key: 'solved',
          label: 'Verified solved',
          render: (p) => p.coding.solved,
        },
        {
          key: 'attempted',
          label: 'Verified attempted',
          render: (p) => p.coding.attempted,
        },
        {
          key: 'unavailable',
          label: 'Unavailable',
          render: (p) => p.coding.unavailable,
        },
        {
          key: 'completion',
          label: 'Completion',
          render: (p) => percent(p.coding.completion),
        },
        {
          key: 'coverage',
          label: 'Coverage',
          render: (p) => percent(p.coding.coverage),
        },
      ]}
    />
  );
}
export function PersonalAnalytics() {
  const { query } = useFilters(),
    q = useAdministration('/analytics/me?' + query, personalSchema),
    data = q.data;
  return (
    <StudentShell
      title="My learning overview"
      description="Your released assignments, verified coding progress and finalized attendance."
    >
      <Filters
        personal
        batches={data?.batches}
        days={data?.batches
          .flatMap((b) =>
            b.assignments.map((a) => ({ day: a.day, title: b.name })),
          )
          .filter((v, i, all) => all.findIndex((a) => a.day === v.day) === i)}
      />
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {data && (
          <>
            <MetricCards
              items={[
                {
                  label: 'Enrolled Courses',
                  value: data.summary.enrolledCourses,
                  href: '/student/courses',
                },
                {
                  label: 'Active Batches',
                  value: data.summary.activeBatches,
                  href: '/student/batches',
                },
                {
                  label: 'Finalized attendance',
                  value: percent(data.summary.attendance.percentage),
                  href: '/student/attendance',
                },
              ]}
            />
            <CodingCards value={data.summary.coding} />
            {!data.batches.length && <p>No eligible learning records yet.</p>}
            {data.batches.map((b) => (
              <section key={b.id} className="student-card">
                <h2>
                  <Link href={'/student/batches/' + b.id}>
                    {b.course} · {b.name}
                  </Link>
                </h2>
                <p>
                  Current released Learning Day: {b.currentDay ?? 'N/A'} ·
                  Verified completion {percent(b.coding.completion)} ·
                  Verification coverage {percent(b.coding.coverage)}
                </p>
                <p>
                  Last successful coding sync: {date(b.lastSuccess)}.
                  Unsupported platforms cannot provide trusted automated
                  verification.
                </p>
                <MetricCards
                  items={[
                    { label: 'Assigned problems', value: b.coding.assigned },
                    { label: 'Verified solves', value: b.coding.solved },
                    { label: 'Verified attempts', value: b.coding.attempted },
                    {
                      label: 'Verification unavailable',
                      value: b.coding.unavailable,
                    },
                    {
                      label: 'Morning finalized attendance',
                      value: percent(b.morning.percentage),
                    },
                    {
                      label: 'Afternoon finalized attendance',
                      value: percent(b.afternoon.percentage),
                    },
                  ]}
                />
                <h3>Learning Day progress</h3>
                <DataTable
                  items={b.days}
                  empty="No released Learning Days"
                  columns={[
                    {
                      key: 'day',
                      label: 'Learning Day',
                      render: (d) => (
                        <Link
                          href={'/student/batches/' + b.id + '/days/' + d.day}
                        >
                          {d.day + ' · ' + d.title}
                        </Link>
                      ),
                    },
                    {
                      key: 'assigned',
                      label: 'Assigned problems',
                      render: (d) => d.coding.assigned,
                    },
                    {
                      key: 'solved',
                      label: 'Verified solved',
                      render: (d) => d.coding.solved,
                    },
                    {
                      key: 'attempted',
                      label: 'Verified attempted',
                      render: (d) => d.coding.attempted,
                    },
                    {
                      key: 'unavailable',
                      label: 'Verification unavailable',
                      render: (d) => d.coding.unavailable,
                    },
                    {
                      key: 'completion',
                      label: 'Verified completion',
                      render: (d) => percent(d.coding.completion),
                    },
                  ]}
                />
                <h3>Released assignments and editorials</h3>
                <DataTable
                  items={b.assignments}
                  columns={[
                    {
                      key: 'title',
                      label: 'Assignment',
                      render: (a) => (
                        <Link
                          href={'/student/batches/' + b.id + '/days/' + a.day}
                        >
                          {a.title} · Day {a.day}
                        </Link>
                      ),
                    },
                    {
                      key: 'status',
                      label: 'Verified progress',
                      render: (a) => reason(a.status),
                    },
                  ]}
                />
                <h3>Coding verification</h3>
                <ul>
                  {b.accounts.map((a) => (
                    <li key={a.platform}>
                      {a.platform}: {reason(a.status)}
                      {a.proofExpired
                        ? ' · Ownership proof expired'
                        : ''} · {reason(a.syncStatus)} · Last success{' '}
                      {date(a.lastSuccess)}
                      {a.lastError ? ' · ' + a.lastError : ''}
                    </li>
                  ))}
                </ul>
                <Link href="/student/coding-accounts">
                  Manage coding account verification
                </Link>
                <h3>Finalized attendance and corrections</h3>
                <ul>
                  {b.history
                    .filter((m) => m.official)
                    .map((m) => (
                      <li key={m.sessionId}>
                        Day {m.day} {m.type}: {m.status}
                        {m.corrected ? ' · Corrected' : ''}
                      </li>
                    ))}
                </ul>
                <p>
                  Present {b.attendance.present} · Absent {b.attendance.absent}{' '}
                  · Corrected {b.attendance.corrected}. Unfinalized sessions do
                  not establish absence.
                </p>
                <Link href={'/student/batches/' + b.id + '/attendance'}>
                  View attendance sessions
                </Link>
              </section>
            ))}
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
