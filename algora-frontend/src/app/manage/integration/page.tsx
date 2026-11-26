'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, fmtDateTime, Grid, Input, Notice, PageHeader, PageSkeleton, Pagination, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';

interface ProviderView {
  id: string; displayName: string; priority: number; requested?: boolean; configurationReason?: string | null; envEnabled: boolean; adminEnabled: boolean; authorized: boolean; authorizationReason?: string; transportKind: string;
  status: string; breaker: string; nextEligibleAt: string | null; totalRequests: number; successes: number; failures: number; rateLimited: number; consecutiveFailures: number;
  acceptedRetrievals: number; lastAcceptedRetrievalAt: string | null;
  successRate: number | null; avgLatencyMs: number | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; lastErrorKind: string | null;
  ratePerMin: number; tokensAvailable: number;
  authorizationStatus: 'AUTHORIZED' | 'AUTHORIZATION_PENDING' | 'NOT_AUTHORIZED'; accessBasis: string | null; activation: 'ACTIVE' | 'INACTIVE'; activationReason: string | null;
  technicalHealth: 'UNTESTED' | 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'CIRCUIT_OPEN';
  capabilities: { acceptedOnly: boolean; windowSize: number; submissionIds: boolean; cacheTtlSec: number; upstream: string; reachesUpstreamDirectly: boolean };
}
interface Overview {
  overall: string; syncEnabled: boolean; paused: boolean; access: { basis: string; reason?: string | null; establishedExternally: boolean; internalRiskAcceptance: boolean };
  configurationIssues?: Record<string, string>;
  authorization: { status: 'AUTHORIZED' | 'AUTHORIZATION_PENDING' | 'NOT_AUTHORIZED'; requestedAt: string | null }; selectedProvider: string | null; priority: string[];
  upstream: { id: string; blocked: boolean; blockedUntil: string | null; reason: string | null; ratePerMin: number; tokensAvailable: number; utilizationPct: number;
    requests: { lastMinute: number; lastHour: number; today: number; ok: number; rateLimited: number; accessDenied: number; failed: number; avgLatencyMs: number | null } };
  providers: ProviderView[];
  queue: { eligibleStudents: number; queueDepth: number; activeJobs: number; succeeded24h: number; failed24h: number; cancelled24h: number; retryBacklog: number; oldestQueuedAgeSec: number; overdueStudents: number; possibleGaps: number;
    latencyMs: { jobRunP50: number | null; jobRunP95: number | null; waitP50: number | null; waitP95: number | null; waitP99: number | null; manualWaitP95: number | null; scheduledWaitP95: number | null } };
  schedule: { bootcampHours: string; bootcampDays: string; tzOffsetMin: number; termStart: string | null; termEnd: string | null };
  students: { withFailures: number; possibleGaps: number; reducedCoverage: number }; conflicts7d: number; healthCheckConfigured: boolean;
  settings: { paused: boolean; priority?: string[]; disabled: string[]; ratePerMin?: number; providerRatePerMin: Record<string, number>; autoIntervalMin?: number; offHoursIntervalMin?: number; studentCooldownSec?: number; concurrency?: number;
    sources: Record<string, string>;
    effective: { ratePerMin: number; autoIntervalMin: number; offHoursIntervalMin: number; studentCooldownSec: number; concurrency: number; providerRatePerMin: Record<string, number> };
    ceilings: { ratePerMin: number; provider: Record<string, number> } };
}
interface Job { _id: string; trigger: string; status: string; attempts: number; enqueuedAt: string; finishedAt?: string; cancelReason?: string; result?: { error?: string; status?: string }; studentId?: { fullName: string; rollNumber: string } | null }
interface Gap { _id: string; fullName: string; rollNumber: string; sync?: { lastGapAt?: string; lastSuccessAt?: string } }
interface Ev { _id: string; type: string; provider?: string; toProvider?: string; kind?: string; message?: string; at: string; studentId?: { fullName: string; rollNumber: string } | null }

const OVERALL: Record<string, { tone: 'good' | 'warn' | 'bad' | 'default'; text: string }> = {
  HEALTHY: { tone: 'good', text: 'Healthy' }, DEGRADED: { tone: 'warn', text: 'Degraded' }, UNAVAILABLE: { tone: 'bad', text: 'Unavailable' },
  UPSTREAM_BLOCKED: { tone: 'bad', text: 'LeetCode restricted' }, PAUSED: { tone: 'warn', text: 'Paused' }, DISABLED: { tone: 'default', text: 'Disabled' }, NO_AUTHORIZED_PROVIDER: { tone: 'warn', text: 'No authorised provider' },
};
const AUTH_BADGE: Record<string, { tone: 'green' | 'amber' | 'gray'; text: string }> = {
  AUTHORIZED: { tone: 'green', text: 'Authorized' }, AUTHORIZATION_PENDING: { tone: 'amber', text: 'Authorization pending' }, NOT_AUTHORIZED: { tone: 'gray', text: 'Not authorized' },
};
const HEALTH_BADGE: Record<string, { tone: 'green' | 'amber' | 'red' | 'gray'; text: string }> = {
  UNTESTED: { tone: 'gray', text: 'Untested' }, HEALTHY: { tone: 'green', text: 'Healthy' }, DEGRADED: { tone: 'amber', text: 'Degraded' },
  UNAVAILABLE: { tone: 'red', text: 'Unavailable' }, RATE_LIMITED: { tone: 'amber', text: 'Rate limited' }, CIRCUIT_OPEN: { tone: 'red', text: 'Circuit open' },
};

export default function Page() {
  const o = useApi<Overview>('/leetcode/integration');
  const [tab, setTab] = useState('providers');
  const toast = useToast(); const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  // Live view: refresh every 15 s while the page is open.
  useEffect(() => { const t = setInterval(() => void o.reload(), 15_000); return () => clearInterval(t); }, [o.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Record<string, unknown>, okMsg: string) => {
    setBusy('save');
    try { const r = await api<{ note?: string }>('/leetcode/integration/settings', { method: 'PUT', body: patch }); toast.success(r.note ?? okMsg); await o.reload(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  if (o.error) return <ErrorState message={o.error} retry={o.reload} />;
  if (!o.data) return <PageSkeleton />;
  const d = o.data;
  const ov = OVERALL[d.overall] ?? OVERALL.UNAVAILABLE;
  const move = (id: string, dir: -1 | 1) => { const p = [...d.priority]; const i = p.indexOf(id); const j = i + dir; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; save({ priority: p }, 'Priority updated'); };
  const toggle = (p: ProviderView) => save({ disabled: p.adminEnabled ? [...d.settings.disabled, p.id] : d.settings.disabled.filter((x) => x !== p.id) }, p.adminEnabled ? `${p.displayName} disabled` : `${p.displayName} enabled`);

  return (
    <div className="space-y-6">
      <PageHeader title="LeetCode integration" subtitle="Verification providers, automatic failover and synchronization health."
        actions={<>
          <Button variant="secondary" loading={busy === 'hc'} disabled={!d.healthCheckConfigured || !d.syncEnabled} title={!d.healthCheckConfigured ? 'Set LEETCODE_HEALTHCHECK_USERNAME to a consenting account' : undefined}
            onClick={async () => { setBusy('hc'); try { const r = await api<{ ran: boolean; reason?: string; results?: { provider: string; result: string; latencyMs?: number }[] }>('/leetcode/integration/health-check', { method: 'POST' }); toast.info(r.ran ? r.results!.map((x) => `${x.provider}: ${x.result}${x.latencyMs ? ` (${x.latencyMs} ms)` : ''}`).join(' · ') : r.reason!); await o.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } }}>Run health check</Button>
          {d.paused
            ? <Button loading={busy === 'save'} onClick={() => save({ paused: false }, 'Synchronization resumed')}>Resume synchronization</Button>
            : <Button variant="danger" loading={busy === 'save'} disabled={!d.syncEnabled} onClick={async () => { if (await confirm({ title: 'Pause synchronization for everyone?', body: 'No provider is contacted until you resume. Verified progress stays visible to students.', confirmLabel: 'Pause', danger: true })) save({ paused: true }, 'Synchronization paused'); }}>Pause synchronization</Button>}
        </>} />

      {!d.syncEnabled && <Notice tone="warn" title="Automatic verification is disabled by configuration">LEETCODE_SYNC_ENABLED is false. Providers stay off until LeetCode access is authorised and the live proof of concept passes (docs/LIVE_POC_RUNBOOK.md). Admin controls here cannot enable or authorise a provider.</Notice>}
      <Card title="Data access basis">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={AUTH_BADGE[d.authorization.status].tone}>{AUTH_BADGE[d.authorization.status].text}</Badge>
          <span className="text-slate-600">
            {d.access.basis === 'NONE' ? 'No access basis is configured on the server, so no real provider may be used.'
              : d.access.internalRiskAcceptance ? 'Internal risk acceptance is recorded. External synchronization requires an applicable access basis.'
              : <>Access basis: <strong>{d.access.basis.replace(/_/g, ' ').toLowerCase()}</strong>{d.access.establishedExternally ? ' (external basis recorded)' : ''}</>}
          </span>
          {d.access.reason && <p className="text-sm text-slate-600">{d.access.reason}</p>}
          {Object.entries(d.configurationIssues ?? {}).length > 0 && <ul className="list-inside list-disc text-sm text-slate-600">
            {Object.entries(d.configurationIssues ?? {}).map(([key, reason]) => <li key={key}><code>{key}</code> · {reason}</li>)}
          </ul>}
          {d.authorization.status !== 'AUTHORIZED' && (
            <Button size="sm" variant="secondary" loading={busy === 'save'} onClick={() => save({ permissionRequestedAt: d.authorization.requestedAt ? null : new Date().toISOString() }, d.authorization.requestedAt ? 'Request date cleared' : 'Permission request recorded')}>
              {d.authorization.requestedAt ? 'Clear request date' : 'Record that the request was sent today'}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">LEETCODE_ACCESS_BASIS records the access arrangement. LEETCODE_ACCESS_REF identifies the supporting document. Recording a request date tracks the request while access is pending.</p>
      </Card>
      {d.upstream.blocked && <Notice tone="error" title="LeetCode is restricting or unavailable">Reason: {d.upstream.reason?.replace(/_/g, ' ').toLowerCase()}. Every provider that depends on LeetCode is paused until {fmtDateTime(d.upstream.blockedUntil)}. Algora does not switch providers to get around a LeetCode restriction.</Notice>}
      {d.providers.some((p) => p.transportKind === 'mock' && p.envEnabled) && <Notice tone="info">A development mock provider is active in this environment. Its data never counts in production.</Notice>}

      <Grid>
        <StatCard label="Overall" value={ov.text} tone={ov.tone} hint={d.selectedProvider ? `Serving through: ${d.providers.find((p) => p.id === d.selectedProvider)?.displayName}` : 'No provider serving'} />
        <StatCard label="LeetCode budget (shared)" value={`${d.upstream.utilizationPct}% used`} hint={`${d.upstream.tokensAvailable} tokens left · ${d.upstream.ratePerMin}/min across all providers and instances · burst ${Math.max(2, Math.ceil(d.upstream.ratePerMin / 5))}`} />
        <StatCard label="Requests" value={`${d.upstream.requests.lastMinute} /min`} hint={`${d.upstream.requests.lastHour} last hour · ${d.upstream.requests.today} today · ${d.upstream.requests.rateLimited} HTTP 429 · ${d.upstream.requests.accessDenied} access denied · avg ${d.upstream.requests.avgLatencyMs ?? '—'} ms`} />
        <StatCard label="Sync queue" value={d.queue.queueDepth} tone={d.queue.oldestQueuedAgeSec > 600 ? 'warn' : 'default'} hint={`${d.queue.activeJobs} running · ${d.queue.retryBacklog} retrying · oldest waiting ${Math.round(d.queue.oldestQueuedAgeSec / 60)} min · ${d.queue.eligibleStudents} eligible students`} />
        <StatCard label="Jobs (24 h)" value={`${d.queue.succeeded24h} ok`} tone={d.queue.failed24h ? 'warn' : 'default'} hint={`${d.queue.failed24h} failed · ${d.queue.cancelled24h} cancelled · ${d.queue.overdueStudents} overdue students`} />
        <StatCard label="Students needing attention" value={d.students.withFailures + d.students.possibleGaps} tone={d.students.withFailures + d.students.possibleGaps ? 'warn' : 'default'}
          hint={`${d.students.withFailures} failing · ${d.students.possibleGaps} possible gaps · ${d.students.reducedCoverage} reduced coverage · ${d.conflicts7d} conflicts (7 d)`} />
      </Grid>

      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'providers', label: 'Providers' }, { key: 'queue', label: 'Queue & jobs' }, { key: 'gaps', label: 'Evidence gaps' }, { key: 'events', label: 'Failover & errors' }, { key: 'conflicts', label: 'Evidence conflicts' }, { key: 'settings', label: 'Schedule & limits' }]} />

      {tab === 'providers' && (
        <Card title="Providers in priority order" actions={<span className="text-xs text-slate-500">One provider serves each request; the next is tried only for provider-specific failures.</span>}>
          <div className="space-y-3">
            {d.priority.map((id, i) => {
              const p = d.providers.find((x) => x.id === id); if (!p) return null;
              return (
                <div key={p.id} className={`rounded-lg border p-4 ${d.selectedProvider === p.id ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                    <span className="font-semibold">{p.displayName}</span>
                    <span className="text-xs text-slate-500">Authorization</span><Badge tone={AUTH_BADGE[p.authorizationStatus].tone}>{AUTH_BADGE[p.authorizationStatus].text}</Badge>
                    {p.accessBasis && <Badge tone={p.accessBasis === 'OWN_RISK' ? 'amber' : 'indigo'}>{p.accessBasis === 'OWN_RISK' ? 'Internal risk acceptance' : p.accessBasis.replace(/_/g, ' ').toLowerCase()}</Badge>}
                    <span className="text-xs text-slate-500">Activation</span><Badge tone={p.activation === 'ACTIVE' ? 'green' : 'gray'}>{p.activation === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>
                    <span className="text-xs text-slate-500">Health</span><Badge tone={HEALTH_BADGE[p.technicalHealth].tone}>{HEALTH_BADGE[p.technicalHealth].text}</Badge>
                    {d.selectedProvider === p.id && <Badge tone="indigo">Serving</Badge>}
                    {!p.capabilities.acceptedOnly && <Badge tone="amber">Reduced coverage (all statuses)</Badge>}
                    {p.transportKind === 'mock' && <Badge>mock</Badge>}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Move ${p.displayName} up`} disabled={i === 0 || busy === 'save'} onClick={() => move(p.id, -1)}>↑</Button>
                      <Button size="sm" variant="ghost" aria-label={`Move ${p.displayName} down`} disabled={i === d.priority.length - 1 || busy === 'save'} onClick={() => move(p.id, 1)}>↓</Button>
                      <Button size="sm" variant={p.adminEnabled ? 'secondary' : 'primary'} disabled={busy === 'save' || (!p.adminEnabled && (!p.envEnabled || !p.authorized))}
                        title={!p.envEnabled ? 'Not enabled in the server environment' : !p.authorized ? p.authorizationReason : undefined} onClick={() => toggle(p)}>{p.adminEnabled ? 'Disable' : 'Enable'}</Button>
                    </span>
                  </div>
                  {p.requested !== undefined && <p className="mt-2 text-sm text-slate-600">{p.requested ? 'Requested in server configuration' : 'Off in server configuration'}</p>}
                  {!p.authorized && <p className="mt-2 text-sm text-slate-600">{p.authorizationStatus === 'AUTHORIZATION_PENDING' ? 'Waiting for LeetCode\'s written permission' : 'No permission from LeetCode recorded'}: {p.authorizationReason}</p>}
                  {p.activationReason && <p className="mt-1 text-sm text-slate-500">Inactive because: {p.activationReason}.</p>}
                  {p.technicalHealth === 'UNTESTED' && <p className="mt-1 text-sm text-slate-500">Untested: this provider has never made a live request, so its technical health is unknown.</p>}
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <div><dt className="text-xs text-slate-500">Valid response rate</dt><dd>{p.successRate === null ? '—' : `${p.successRate}%`} <span className="text-xs text-slate-400">({p.successes}/{p.totalRequests})</span></dd></div>
                    <div><dt className="text-xs text-slate-500">Avg latency</dt><dd>{p.avgLatencyMs === null ? '—' : `${p.avgLatencyMs} ms`}</dd></div>
                    <div><dt className="text-xs text-slate-500">Failures · rate limited</dt><dd>{p.failures} · {p.rateLimited} <span className="text-xs text-slate-400">({p.consecutiveFailures} in a row)</span></dd></div>
                    <div><dt className="text-xs text-slate-500">Circuit</dt><dd>{p.breaker.toLowerCase().replace('_', '-')}{p.nextEligibleAt && <span className="text-xs text-slate-400"> · retry {fmtDateTime(p.nextEligibleAt)}</span>}</dd></div>
                    <div><dt className="text-xs text-slate-500">Own budget</dt><dd>{p.tokensAvailable} left · {p.ratePerMin}/min</dd></div>
                    <div><dt className="text-xs text-slate-500">Accepted-submission retrievals</dt><dd>{p.acceptedRetrievals} · {timeAgo(p.lastAcceptedRetrievalAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Last valid response · failure</dt><dd>{timeAgo(p.lastSuccessAt)} · {timeAgo(p.lastFailureAt)}</dd></div>
                  </dl>
                  {p.lastError && <p className="mt-2 truncate text-xs text-slate-500" title={p.lastError}>Last error ({p.lastErrorKind}): {p.lastError}</p>}
                  <p className="mt-2 text-xs text-slate-400">Window {p.capabilities.windowSize} · {p.capabilities.acceptedOnly ? 'accepted only' : 'all statuses, filtered'} · submission ids {p.capabilities.submissionIds ? 'yes' : 'no'} · cache {p.capabilities.cacheTtlSec}s · upstream {p.capabilities.upstream}{p.capabilities.reachesUpstreamDirectly ? '' : ' (via relay)'}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {tab === 'queue' && <QueueTab d={d} />}
      {tab === 'gaps' && <Gaps />}
      {tab === 'events' && <Events />}
      {tab === 'conflicts' && <Conflicts />}
      {tab === 'settings' && <SettingsForm d={d} onSave={save} busy={busy === 'save'} />}
    </div>
  );
}

const sec = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 60_000 * 10) / 10} min`);
function QueueTab({ d }: { d: Overview }) {
  const [status, setStatus] = useState('FAILED'); const [page, setPage] = useState(1);
  const j = useApi<Paged<Job>>(`/leetcode/integration/jobs${qs({ status, page, pageSize: 15 })}`);
  const l = d.queue.latencyMs;
  return (
    <div className="space-y-4">
      <Card title="Delays in the last hour (time from due to start)">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">All jobs p50 / p95 / p99</dt><dd>{sec(l.waitP50)} / {sec(l.waitP95)} / {sec(l.waitP99)}</dd></div>
          <div><dt className="text-xs text-slate-500">Manual p95</dt><dd>{sec(l.manualWaitP95)}</dd></div>
          <div><dt className="text-xs text-slate-500">Automatic p95</dt><dd>{sec(l.scheduledWaitP95)}</dd></div>
          <div><dt className="text-xs text-slate-500">Job run p50 / p95</dt><dd>{l.jobRunP50 === null ? '—' : `${l.jobRunP50} ms`} / {l.jobRunP95 === null ? '—' : `${l.jobRunP95} ms`}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Schedule: {d.schedule.bootcampHours} on days {d.schedule.bootcampDays} (UTC{d.schedule.tzOffsetMin >= 0 ? '+' : ''}{d.schedule.tzOffsetMin / 60}){d.schedule.termStart ? ` · term ${fmtDateTime(d.schedule.termStart)} to ${fmtDateTime(d.schedule.termEnd)}` : ' · no term dates set'}. If demand exceeds the shared budget, jobs wait here and students see a delay. The budget is never raised automatically.</p>
      </Card>
      <Card title="Jobs" actions={<select aria-label="Job status" value={status} onChange={(x) => { setStatus(x.target.value); setPage(1); }} className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-300">
        {['FAILED', 'CANCELLED', 'QUEUED', 'RUNNING', 'SUCCEEDED'].map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</select>}>
        {j.error ? <ErrorState message={j.error} retry={j.reload} /> : !j.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={j.data.items} rowKey={(x) => x._id} empty={<EmptyState title={`No ${status.toLowerCase()} jobs`} />} columns={[
              { key: 'w', header: 'Queued', cell: (x) => fmtDateTime(x.enqueuedAt) },
              { key: 's', header: 'Student', cell: (x) => x.studentId ? `${x.studentId.fullName} (${x.studentId.rollNumber})` : '—' },
              { key: 't', header: 'Trigger', cell: (x) => <code className="text-xs">{x.trigger}</code> },
              { key: 'a', header: 'Attempts', cell: (x) => x.attempts },
              { key: 'r', header: 'Result', cell: (x) => <span className="text-xs text-slate-500">{x.cancelReason ?? x.result?.error ?? x.result?.status ?? ''}</span> },
            ]} />
            <Pagination page={page} pageSize={j.data.pageSize} total={j.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
function Gaps() {
  const [page, setPage] = useState(1);
  const g = useApi<Paged<Gap> & { note?: string }>(`/leetcode/integration/gaps${qs({ page })}`);
  return (
    <Card title="Possible evidence gaps" actions={<span className="text-xs text-slate-500">Not an accusation. Older accepted submissions may not be recoverable.</span>}>
      {g.error ? <ErrorState message={g.error} retry={g.reload} /> : !g.data ? <TableSkeleton /> : (
        <>
          <p className="mb-3 text-xs text-slate-500">{g.data.note}</p>
          <DataTable rows={g.data.items} rowKey={(x) => x._id} empty={<EmptyState title="No possible gaps" />} columns={[
            { key: 's', header: 'Student', cell: (x) => `${x.fullName} (${x.rollNumber})` },
            { key: 'g', header: 'Gap observed', cell: (x) => fmtDateTime(x.sync?.lastGapAt) },
            { key: 'l', header: 'Last successful sync', cell: (x) => timeAgo(x.sync?.lastSuccessAt) },
          ]} />
          <Pagination page={page} pageSize={g.data.pageSize} total={g.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
function Events() {
  const [page, setPage] = useState(1); const [type, setType] = useState('');
  const e = useApi<Paged<Ev>>(`/leetcode/integration/events${qs({ page, type, pageSize: 25 })}`);
  return (
    <Card title="Failover history and recent integration errors" actions={<select aria-label="Event type" value={type} onChange={(x) => { setType(x.target.value); setPage(1); }} className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-300">
      <option value="">All events</option>{['FAILOVER', 'PROVIDER_ERROR', 'UPSTREAM_BLOCK', 'CIRCUIT_OPEN', 'CIRCUIT_CLOSED', 'ALL_FAILED', 'HEALTH_CHECK'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</select>}>
      {e.error ? <ErrorState message={e.error} retry={e.reload} /> : !e.data ? <TableSkeleton /> : (
        <>
          <DataTable rows={e.data.items} rowKey={(x) => x._id} empty={<EmptyState title="No events" body="Failovers, provider errors, circuit changes and LeetCode blocks appear here (kept 30 days)." />} columns={[
            { key: 't', header: 'When', cell: (x) => fmtDateTime(x.at) },
            { key: 'y', header: 'Event', cell: (x) => <StatusBadge status={x.type === 'FAILOVER' || x.type === 'CIRCUIT_CLOSED' || x.type === 'HEALTH_CHECK' ? 'PARTIAL' : x.type === 'PROVIDER_ERROR' ? 'RATE_LIMITED' : 'FAILED'} /> },
            { key: 'n', header: 'Type', cell: (x) => <code className="text-xs">{x.type}</code> },
            { key: 'p', header: 'Provider', cell: (x) => x.toProvider ? `${x.provider} → ${x.toProvider}` : x.provider ?? '—' },
            { key: 'k', header: 'Reason', cell: (x) => <span className="text-xs">{x.kind ?? ''}</span> },
            { key: 's', header: 'Student', cell: (x) => x.studentId ? `${x.studentId.fullName} (${x.studentId.rollNumber})` : '—' },
            { key: 'm', header: 'Detail', cell: (x) => <span className="block max-w-xs truncate text-xs text-slate-500" title={x.message}>{x.message}</span> },
          ]} />
          <Pagination page={page} pageSize={e.data.pageSize} total={e.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function Conflicts() {
  const [page, setPage] = useState(1);
  const c = useApi<Paged<{ _id: string; type: string; submissionId?: string; slug?: string; expected?: unknown; received?: unknown; provider?: string; at: string; studentId?: { fullName: string; rollNumber: string } }>>(`/leetcode/integration/conflicts${qs({ page })}`);
  return (
    <Card title="Evidence conflicts" actions={<span className="text-xs text-slate-500">Conflicting data is never used to award verification.</span>}>
      {c.error ? <ErrorState message={c.error} retry={c.reload} /> : !c.data ? <TableSkeleton /> : (
        <>
          <DataTable rows={c.data.items} rowKey={(x) => x._id} empty={<EmptyState title="No conflicts" />} columns={[
            { key: 't', header: 'When', cell: (x) => fmtDateTime(x.at) }, { key: 'y', header: 'Type', cell: (x) => <code className="text-xs">{x.type}</code> },
            { key: 's', header: 'Student', cell: (x) => x.studentId ? `${x.studentId.fullName} (${x.studentId.rollNumber})` : '—' },
            { key: 'p', header: 'Provider', cell: (x) => x.provider ?? '—' }, { key: 'id', header: 'Submission', cell: (x) => <code className="text-xs">{x.submissionId ?? '—'}</code> },
            { key: 'd', header: 'Expected → received', cell: (x) => <span className="text-xs text-slate-500">{JSON.stringify(x.expected ?? {})} → {JSON.stringify(x.received ?? {})}</span> },
          ]} />
          <Pagination page={page} pageSize={c.data.pageSize} total={c.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function SettingsForm({ d, onSave, busy }: { d: Overview; onSave: (p: Record<string, unknown>, ok: string) => void; busy: boolean }) {
  const e = d.settings.effective; const c = d.settings.ceilings; const src = d.settings.sources;
  const [v, setV] = useState({ ratePerMin: e.ratePerMin, autoIntervalMin: e.autoIntervalMin, offHoursIntervalMin: e.offHoursIntervalMin, studentCooldownSec: e.studentCooldownSec, concurrency: e.concurrency, providerRatePerMin: { ...e.providerRatePerMin } });
  const n = (k: keyof typeof v) => (x: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(x.target.value) });
  const from = (k: string) => (src[k] === 'runtime' ? 'set by an administrator' : src[k] === 'default' ? 'built-in default' : 'from server environment');
  return (
    <Card title="Schedule and request limits">
      <Notice tone="info">Values shown are the effective ones. Precedence: administrator settings here, limited by server ceilings (limits can only be lowered, never raised), then server environment defaults. Reset removes the overrides.</Notice>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="Shared LeetCode budget (requests/min)" type="number" min={1} max={c.ratePerMin} value={v.ratePerMin} onChange={n('ratePerMin')} hint={`Ceiling ${c.ratePerMin}/min · ${from('ratePerMin')}. Shared by every provider and instance.`} />
        <Input label="Maximum concurrency" type="number" min={1} max={10} value={v.concurrency} onChange={n('concurrency')} hint={`${from('concurrency')}. Cannot exceed the server value.`} />
        <Input label="Automatic update every (min)" type="number" min={5} max={240} value={v.autoIntervalMin} onChange={n('autoIntervalMin')} hint={`After each successful sync · ${from('autoIntervalMin')}`} />
        <Input label="Outside bootcamp hours: every (min, 0 = off)" type="number" min={0} max={1440} value={v.offHoursIntervalMin} onChange={n('offHoursIntervalMin')} hint={`0 disables automatic sync outside hours · ${from('offHoursIntervalMin')}`} />
        <Input label="Manual update cooldown (s)" type="number" min={10} max={3600} value={v.studentCooldownSec} onChange={n('studentCooldownSec')} hint={`Per student, from the last manual request · ${from('studentCooldownSec')}`} />
        {d.providers.map((p) => (
          <Input key={p.id} label={`${p.displayName} budget (requests/min)`} type="number" min={1} max={c.provider[p.id]} value={v.providerRatePerMin[p.id] ?? c.provider[p.id]} hint={`Ceiling ${c.provider[p.id]}/min. Counts inside the shared budget, not on top of it.`}
            onChange={(x) => setV({ ...v, providerRatePerMin: { ...v.providerRatePerMin, [p.id]: Number(x.target.value) } })} />
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button loading={busy} onClick={() => onSave(v, 'Schedule and limits saved')}>Save</Button>
        <Button variant="ghost" onClick={() => onSave({ ratePerMin: null, autoIntervalMin: null, offHoursIntervalMin: null, studentCooldownSec: null, concurrency: null, providerRatePerMin: {} }, 'Reset to server defaults')}>Reset to defaults</Button>
      </div>
    </Card>
  );
}
