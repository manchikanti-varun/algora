'use client';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, DescriptionList, Disclosure, EmptyState, ErrorState, fmtDateTime, Grid, IconButton, InlineSelect, Input, Notice, PageHeader, PageSkeleton, Pagination, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { useUrlState } from '@/hooks/useUrlState';
import { api, errorMessage, qs } from '@/lib/api';
import { statusLabel } from '@/lib/status';
import type { Paged } from '@/components/manage/types';
interface ProviderView {
  id: string; displayName: string; priority: number; requested?: boolean; configurationReason?: string | null; envEnabled: boolean; adminEnabled: boolean; authorized: boolean; authorizationReason?: string; transportKind: string;
  status: string; breaker: string; nextEligibleAt: string | null; totalRequests: number; successes: number; failures: number; rateLimited: number; consecutiveFailures: number;
  acceptedRetrievals: number; lastAcceptedRetrievalAt: string | null;
  successRate: number | null; avgLatencyMs: number | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; lastErrorKind: string | null;
  ratePerMin: number; tokensAvailable: number;
  state: ProviderState; stateReason: string | null; activation: 'ACTIVE' | 'INACTIVE'; activationReason: string | null;
  technicalHealth: 'UNTESTED' | 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'RATE_LIMITED' | 'CIRCUIT_OPEN';
  capabilities: { acceptedOnly: boolean; windowSize: number; submissionIds: boolean; cacheTtlSec: number; upstream: string; reachesUpstreamDirectly: boolean };
}
interface Overview {
  overall: ProviderState | 'DISABLED'; overallReason: string | null; syncEnabled: boolean; paused: boolean; activation: { basis: string; activated: boolean; reason: string | null; statement?: string | null }; lastSuccessfulSyncAt: string | null;
  configurationIssues?: Record<string, string>;
  selectedProvider: string | null; priority: string[];
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

type ProviderState = 'DISABLED' | 'AWAITING_ACTIVATION' | 'PAUSED' | 'UPSTREAM_RESTRICTED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNTESTED' | 'DEGRADED' | 'HEALTHY';
/** One state per provider and overall. An untested provider is never shown as healthy. */
const STATE: Record<string, { tone: 'green' | 'amber' | 'red' | 'gray' | 'indigo'; stat: 'good' | 'warn' | 'bad' | 'default'; text: string }> = {
  DISABLED: { tone: 'gray', stat: 'default', text: 'Disabled' }, AWAITING_ACTIVATION: { tone: 'amber', stat: 'warn', text: 'Enabled, awaiting activation' },
  PAUSED: { tone: 'amber', stat: 'warn', text: 'Paused' }, UPSTREAM_RESTRICTED: { tone: 'red', stat: 'bad', text: 'LeetCode access restricted' },
  RATE_LIMITED: { tone: 'amber', stat: 'warn', text: 'Rate limited' }, UNAVAILABLE: { tone: 'red', stat: 'bad', text: 'Temporarily unavailable' },
  UNTESTED: { tone: 'indigo', stat: 'default', text: 'Active, connectivity untested' }, DEGRADED: { tone: 'amber', stat: 'warn', text: 'Degraded' }, HEALTHY: { tone: 'green', stat: 'good', text: 'Healthy' },
};
const STATE_TEXT_CLS = { good: 'text-success-fg', warn: 'text-warning-fg', bad: 'text-danger-fg', default: 'text-fg' } as const;
/** The next step for the operator, derived from the overall state. */
function whatToDo(d: Overview): string {
  switch (d.overall) {
    case 'DISABLED': case 'AWAITING_ACTIVATION': return 'Activation is configured on the server. See Technical details.';
    case 'PAUSED': return 'Resume synchronization when ready.';
    case 'RATE_LIMITED': case 'UPSTREAM_RESTRICTED': return `Updates resume automatically after ${d.upstream.blockedUntil ? fmtDateTime(d.upstream.blockedUntil) : 'the restriction ends'}. Do not retry repeatedly.`;
    case 'UNTESTED': return 'Run a health check.';
    case 'UNAVAILABLE': case 'DEGRADED': return 'Check Errors for details.';
    default: return 'No action needed.';
  }
}
export default function Page() {
  const o = useApi<Overview>('/leetcode/integration');
  const [u, setU] = useUrlState({ tab: 'providers' });
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
  const ov = STATE[d.overall] ?? STATE.UNAVAILABLE;
  const issues = Object.entries(d.configurationIssues ?? {});
  const affected = d.students.withFailures + d.students.possibleGaps;
  const serving = d.providers.find((p) => p.id === d.selectedProvider);
  const move = (id: string, dir: -1 | 1) => { const p = [...d.priority]; const i = p.indexOf(id); const j = i + dir; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; void save({ priority: p }, 'Priority updated'); };
  const toggle = (p: ProviderView) => save({ disabled: p.adminEnabled ? [...d.settings.disabled, p.id] : d.settings.disabled.filter((x) => x !== p.id) }, p.adminEnabled ? `${p.displayName} disabled` : `${p.displayName} enabled`);
  const healthCheck = async () => {
    setBusy('hc');
    try {
      const r = await api<{ ran: boolean; reason?: string; results?: { provider: string; result: string; latencyMs?: number }[] }>('/leetcode/integration/health-check', { method: 'POST' });
      toast.info(r.ran ? r.results!.map((x) => `${x.provider}: ${x.result}${x.latencyMs ? ` (${x.latencyMs} ms)` : ''}`).join(' · ') : r.reason!); await o.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" subtitle="LeetCode progress updates"
        actions={<>
          <Button variant="secondary" loading={busy === 'hc'} disabled={!d.healthCheckConfigured || !d.syncEnabled} title={!d.healthCheckConfigured ? 'Set LEETCODE_HEALTHCHECK_USERNAME to a consenting account' : undefined} onClick={healthCheck}>Run health check</Button>
          {d.paused
            ? <Button loading={busy === 'save'} onClick={() => void save({ paused: false }, 'Synchronization resumed')}>Resume synchronization</Button>
            : <Button variant="danger" loading={busy === 'save'} disabled={!d.syncEnabled} onClick={async () => { if (await confirm({ title: 'Pause synchronization for everyone?', body: 'No provider is contacted until you resume. Verified progress stays visible to students.', confirmLabel: 'Pause', danger: true })) void save({ paused: true }, 'Synchronization paused'); }}>Pause synchronization</Button>}
        </>} />
      {!d.syncEnabled && <Notice tone="warn" title="Automatic verification is disabled by configuration">Progress updates stay off until LeetCode access is authorised on the server (LEETCODE_SYNC_ENABLED is false). Controls on this page cannot enable or authorise a provider.</Notice>}
      {issues.length > 0 && <Notice tone="warn" title="Configuration problems found">
        <ul className="list-inside list-disc">{issues.map(([key, reason]) => <li key={key}><span className="font-mono text-xs">{key}</span>: {reason}</li>)}</ul>
      </Notice>}
      {d.queue.queueDepth > 0 && d.queue.activeJobs === 0 && d.queue.oldestQueuedAgeSec > 120 && <Notice tone="warn" title="Queued jobs are not being processed">
        {d.queue.queueDepth} job(s) have been waiting for {Math.round(d.queue.oldestQueuedAgeSec / 60)} minutes with nothing running. The worker process may be down, or this instance has LEETCODE_SCHEDULER_ENABLED=false and no worker service is running. Start a worker or set the scheduler back on; queued jobs are picked up automatically and are not lost.
      </Notice>}
      {d.upstream.blocked && <Notice tone="error" title="LeetCode is restricting or unavailable">Reason: {d.upstream.reason?.replace(/_/g, ' ').toLowerCase()}. Every provider that depends on LeetCode is paused until {fmtDateTime(d.upstream.blockedUntil)}. Algora does not switch providers to get around a LeetCode restriction.</Notice>}
      {d.providers.some((p) => p.transportKind === 'mock' && p.envEnabled) && <Notice tone="info">A development mock provider is active in this environment. Its data never counts in production.</Notice>}
      <section aria-label="Status summary" className="rounded-lg border border-line bg-surface p-4">
        <p className="text-[13px] text-fg-muted">Are progress updates working?</p>
        <p className={`mt-1 text-2xl font-semibold tracking-tight ${STATE_TEXT_CLS[ov.stat]}`}>{ov.text}</p>
        <p className="mt-1 text-sm text-fg-muted">{d.overallReason ?? (serving ? `Serving through ${serving.displayName}` : 'No provider serving')}</p>
        <DescriptionList cols={3} items={[
          { label: 'Last successful update', value: timeAgo(d.lastSuccessfulSyncAt) },
          { label: 'Students affected', value: <span className="tabular-nums">{affected}</span> },
          { label: 'What to do', value: <span className="whitespace-normal">{whatToDo(d)}</span> },
        ]} />
      </section>
      <Grid cols={3}>
        <StatCard label="Requests today" value={d.upstream.requests.today} hint={`${d.upstream.requests.lastHour} last hour · ${d.upstream.requests.rateLimited} HTTP 429 · ${d.upstream.requests.accessDenied} access denied`} />
        <StatCard label="Update queue" value={d.queue.queueDepth} tone={d.queue.oldestQueuedAgeSec > 600 ? 'warn' : 'default'} hint={`${d.queue.activeJobs} running`} />
        <StatCard label="Students needing attention" value={affected} tone={affected ? 'warn' : 'default'} hint={`${d.students.withFailures} failing · ${d.students.possibleGaps} incomplete history`} />
      </Grid>
      <Tabs active={u.tab} onChange={(tab) => setU({ tab })} tabs={[
        { key: 'providers', label: 'Providers' }, { key: 'jobs', label: 'Jobs' }, { key: 'gaps', label: 'Incomplete history' },
        { key: 'errors', label: 'Errors' }, { key: 'conflicts', label: 'Conflicts' }, { key: 'limits', label: 'Limits & schedule' }]}>
        {u.tab === 'providers' && <ProvidersTab d={d} busy={busy === 'save'} onMove={move} onToggle={toggle} />}
        {u.tab === 'jobs' && <JobsTab d={d} />}
        {u.tab === 'gaps' && <Gaps />}
        {u.tab === 'errors' && <Events />}
        {u.tab === 'conflicts' && <Conflicts />}
        {u.tab === 'limits' && <SettingsForm d={d} onSave={save} busy={busy === 'save'} />}
      </Tabs>
    </div>
  );
}
function ProvidersTab({ d, busy, onMove, onToggle }: { d: Overview; busy: boolean; onMove: (id: string, dir: -1 | 1) => void; onToggle: (p: ProviderView) => void }) {
  const issues = Object.entries(d.configurationIssues ?? {});
  return (
    <div className="space-y-4">
      <Disclosure summary="Activation and configuration">
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={d.activation.activated ? 'success' : 'warning'}>{d.activation.activated ? 'Activated' : 'Not activated'}</Badge>
            <span className="text-fg-muted">{d.activation.activated
              ? <>Access basis recorded on the server: <strong className="text-fg">{d.activation.basis.replace(/_/g, ' ').toLowerCase()}</strong>. {d.activation.statement}</>
              : d.activation.reason}</span>
          </div>
          {!d.activation.activated && <p className="text-xs text-fg-subtle">Set <code className="font-mono">LEETCODE_ACCESS_BASIS</code> in Railway to the basis that actually applies. Students each consent when they link their account, so <code className="font-mono">STUDENT_CONSENT</code> is available when no upstream agreement exists; it makes no claim that LeetCode authorised the access.</p>}
          {issues.length > 0 && <ul className="list-inside list-disc text-danger-fg">{issues.map(([key, reason]) => <li key={key}><code className="font-mono text-xs">{key}</code> · {reason}</li>)}</ul>}
          <p className="text-xs text-fg-subtle">Set by LEETCODE_ACCESS_BASIS on the server (the only activation switch). It records the basis for reading a student&apos;s public submissions; it is not a LeetCode credential. NONE keeps real providers inactive. A provider runs only when it is listed in LEETCODE_PROVIDER_PRIORITY, the basis is set, and it is enabled here.</p>
        </div>
      </Disclosure>
      <Card title="Providers in priority order" description="One provider serves each request. The next is tried only for provider-specific failures.">
        <div className="space-y-3">
          {d.priority.map((id, i) => {
            const p = d.providers.find((x) => x.id === id); if (!p) return null;
            const st = STATE[p.state] ?? STATE.UNAVAILABLE;
            return (
              <div key={p.id} className={`rounded-lg border p-4 ${d.selectedProvider === p.id ? 'border-accent-line bg-accent-soft/40' : 'border-line'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-subtle text-xs font-semibold text-fg-muted">{i + 1}</span>
                  <span className="font-semibold text-fg">{p.displayName}</span>
                  <Badge tone={st.tone}>{st.text}</Badge>
                  {d.selectedProvider === p.id && <Badge tone="accent">Serving</Badge>}
                  {!p.capabilities.acceptedOnly && <Badge tone="warning">Reduced coverage (all statuses)</Badge>}
                  {p.transportKind === 'mock' && <Badge>mock</Badge>}
                  <span className="ml-auto flex items-center gap-1">
                    <IconButton label={`Move ${p.displayName} up`} icon={<ArrowUp size={16} aria-hidden />} disabled={i === 0 || busy} onClick={() => onMove(p.id, -1)} />
                    <IconButton label={`Move ${p.displayName} down`} icon={<ArrowDown size={16} aria-hidden />} disabled={i === d.priority.length - 1 || busy} onClick={() => onMove(p.id, 1)} />
                    <Button size="sm" variant={p.adminEnabled ? 'secondary' : 'primary'} disabled={busy || (!p.adminEnabled && (!p.envEnabled || !p.authorized))}
                      title={!p.envEnabled ? 'Not enabled in the server environment' : !p.authorized ? p.authorizationReason : undefined} onClick={() => onToggle(p)}>{p.adminEnabled ? 'Disable' : 'Enable'}</Button>
                  </span>
                </div>
                {p.stateReason && <p className="mt-2 text-sm text-fg-muted">{p.stateReason}</p>}
                <div className="mt-3">
                  <DescriptionList cols={4} items={[
                    { label: 'Valid response rate', value: <>{p.successRate === null ? '—' : `${p.successRate}%`} <span className="text-xs text-fg-subtle">({p.successes}/{p.totalRequests})</span></> },
                    { label: 'Average latency', value: p.avgLatencyMs === null ? '—' : `${p.avgLatencyMs} ms` },
                    { label: 'Failures · rate limited', value: <>{p.failures} · {p.rateLimited} <span className="text-xs text-fg-subtle">({p.consecutiveFailures} in a row)</span></> },
                    { label: 'Last valid response · failure', value: `${timeAgo(p.lastSuccessAt)} · ${timeAgo(p.lastFailureAt)}` },
                  ]} />
                </div>
                {p.lastError && <p className="mt-2 truncate text-xs text-fg-muted" title={p.lastError}>Last error ({p.lastErrorKind}): {p.lastError}</p>}
                <Disclosure className="mt-3" summary={<span className="text-[13px]">Technical details</span>}>
                  <div className="space-y-3">
                    <DescriptionList cols={3} items={[
                      { label: 'Circuit', value: <>{p.breaker.toLowerCase().replace('_', '-')}{p.nextEligibleAt && <span className="text-xs text-fg-subtle"> · retry {fmtDateTime(p.nextEligibleAt)}</span>}</> },
                      { label: 'Own budget', value: `${p.tokensAvailable} left · ${p.ratePerMin}/min` },
                      { label: 'Accepted-submission retrievals', value: `${p.acceptedRetrievals} · ${timeAgo(p.lastAcceptedRetrievalAt)}` },
                      { label: 'Shared LeetCode budget', value: `${d.upstream.tokensAvailable} tokens left · ${d.upstream.ratePerMin}/min · burst ${Math.max(2, Math.ceil(d.upstream.ratePerMin / 5))} (${d.upstream.utilizationPct}% used)` },
                    ]} />
                    <p className="text-xs text-fg-subtle">Window {p.capabilities.windowSize} · {p.capabilities.acceptedOnly ? 'accepted only' : 'all statuses, filtered'} · submission ids {p.capabilities.submissionIds ? 'yes' : 'no'} · cache {p.capabilities.cacheTtlSec}s · upstream {p.capabilities.upstream}{p.capabilities.reachesUpstreamDirectly ? '' : ' (via relay)'}</p>
                  </div>
                </Disclosure>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
const sec = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 60_000 * 10) / 10} min`);
const who = (s?: { fullName: string; rollNumber: string } | null) => (s ? `${s.fullName} (${s.rollNumber})` : '—');
function JobsTab({ d }: { d: Overview }) {
  const [u, setU] = useUrlState({ jstatus: 'FAILED', jpage: '1' });
  const page = Number(u.jpage) || 1;
  const j = useApi<Paged<Job>>(`/leetcode/integration/jobs${qs({ status: u.jstatus, page, pageSize: 15 })}`);
  const l = d.queue.latencyMs; const q = d.queue;
  return (
    <div className="space-y-4">
      <Card title="Queue and last 24 hours">
        <DescriptionList cols={4} items={[
          { label: 'Waiting in queue', value: q.queueDepth }, { label: 'Running', value: q.activeJobs }, { label: 'Retrying', value: q.retryBacklog },
          { label: 'Oldest waiting', value: `${Math.round(q.oldestQueuedAgeSec / 60)} min` },
          { label: 'Succeeded (24 h)', value: q.succeeded24h }, { label: 'Failed (24 h)', value: q.failed24h }, { label: 'Cancelled (24 h)', value: q.cancelled24h },
          { label: 'Eligible · overdue students', value: `${q.eligibleStudents} · ${q.overdueStudents}` },
        ]} />
      </Card>
      <Card title="Delays in the last hour" description="Time from due to start.">
        <DescriptionList cols={4} items={[
          { label: 'All jobs p50 / p95 / p99', value: `${sec(l.waitP50)} / ${sec(l.waitP95)} / ${sec(l.waitP99)}` },
          { label: 'Manual p95', value: sec(l.manualWaitP95) }, { label: 'Automatic p95', value: sec(l.scheduledWaitP95) },
          { label: 'Job run p50 / p95', value: `${l.jobRunP50 === null ? '—' : `${l.jobRunP50} ms`} / ${l.jobRunP95 === null ? '—' : `${l.jobRunP95} ms`}` },
        ]} />
        <p className="mt-3 text-xs text-fg-subtle">Schedule: {d.schedule.bootcampHours} on days {d.schedule.bootcampDays} (UTC{d.schedule.tzOffsetMin >= 0 ? '+' : ''}{d.schedule.tzOffsetMin / 60}){d.schedule.termStart ? ` · term ${fmtDateTime(d.schedule.termStart)} to ${fmtDateTime(d.schedule.termEnd)}` : ' · no term dates set'}. If demand exceeds the shared budget, jobs wait here and students see a delay. The budget is never raised automatically.</p>
      </Card>
      <Card flush title="Jobs" actions={<InlineSelect label="Job status" value={u.jstatus} onChange={(v) => setU({ jstatus: v, jpage: '1' })}
        options={['FAILED', 'CANCELLED', 'QUEUED', 'RUNNING', 'SUCCEEDED'].map((t) => ({ value: t, label: statusLabel(t) }))} />}>
        {j.error ? <ErrorState message={j.error} retry={j.reload} /> : !j.data ? <TableSkeleton /> : (
          <>
            <DataTable rows={j.data.items} rowKey={(x) => x._id} caption="Update jobs" empty={<EmptyState compact title={`No ${statusLabel(u.jstatus).toLowerCase()} jobs`} />} columns={[
              { key: 'w', header: 'Queued', cell: (x) => fmtDateTime(x.enqueuedAt) },
              { key: 's', header: 'Student', cell: (x) => who(x.studentId) },
              { key: 't', header: 'Trigger', cell: (x) => <span className="font-mono text-xs text-fg-muted">{x.trigger}</span> },
              { key: 'a', header: 'Attempts', cell: (x) => x.attempts },
              { key: 'r', header: 'Result', cell: (x) => <span className="text-xs text-fg-muted">{x.cancelReason ?? x.result?.error ?? x.result?.status ?? ''}</span> },
            ]} />
            <Pagination page={page} pageSize={j.data.pageSize} total={j.data.total} onPage={(p) => setU({ jpage: String(p) })} />
          </>
        )}
      </Card>
    </div>
  );
}
function Gaps() {
  const [u, setU] = useUrlState({ gpage: '1' });
  const page = Number(u.gpage) || 1;
  const g = useApi<Paged<Gap> & { note?: string }>(`/leetcode/integration/gaps${qs({ page })}`);
  return (
    <Card flush title="Incomplete submission history" description="Not an accusation. Older accepted submissions may not be recoverable.">
      {g.error ? <ErrorState message={g.error} retry={g.reload} /> : !g.data ? <TableSkeleton /> : (
        <>
          {g.data.note && <p className="border-b border-line px-4 py-2.5 text-xs text-fg-muted">{g.data.note}</p>}
          <DataTable rows={g.data.items} rowKey={(x) => x._id} caption="Students with incomplete history" empty={<EmptyState compact title="No incomplete histories" />} columns={[
            { key: 's', header: 'Student', cell: (x) => `${x.fullName} (${x.rollNumber})` },
            { key: 'g', header: 'Gap observed', cell: (x) => fmtDateTime(x.sync?.lastGapAt) },
            { key: 'l', header: 'Last successful update', cell: (x) => timeAgo(x.sync?.lastSuccessAt) },
          ]} />
          <Pagination page={page} pageSize={g.data.pageSize} total={g.data.total} onPage={(p) => setU({ gpage: String(p) })} />
        </>
      )}
    </Card>
  );
}
const EVENT_TYPES = ['FAILOVER', 'PROVIDER_ERROR', 'UPSTREAM_BLOCK', 'CIRCUIT_OPEN', 'CIRCUIT_CLOSED', 'ALL_FAILED', 'HEALTH_CHECK'];
function Events() {
  const [u, setU] = useUrlState({ epage: '1', etype: '' });
  const page = Number(u.epage) || 1;
  const e = useApi<Paged<Ev>>(`/leetcode/integration/events${qs({ page, type: u.etype, pageSize: 25 })}`);
  return (
    <Card flush title="Failover history and recent errors" actions={<InlineSelect label="Event type" value={u.etype} onChange={(v) => setU({ etype: v, epage: '1' })}
      options={[{ value: '', label: 'All events' }, ...EVENT_TYPES.map((t) => ({ value: t, label: statusLabel(t) }))]} />}>
      {e.error ? <ErrorState message={e.error} retry={e.reload} /> : !e.data ? <TableSkeleton /> : (
        <>
          <DataTable rows={e.data.items} rowKey={(x) => x._id} caption="Integration events" empty={<EmptyState compact title="No events" body="Failovers, provider errors, circuit changes and LeetCode blocks appear here (kept 30 days)." />} columns={[
            { key: 't', header: 'When', cell: (x) => fmtDateTime(x.at) },
            { key: 'y', header: 'Event', cell: (x) => <div className="space-y-0.5">
              <StatusBadge status={x.type === 'FAILOVER' || x.type === 'CIRCUIT_CLOSED' || x.type === 'HEALTH_CHECK' ? 'PARTIAL' : x.type === 'PROVIDER_ERROR' ? 'RATE_LIMITED' : 'FAILED'} label={statusLabel(x.type)} />
              <p className="font-mono text-xs text-fg-subtle">{x.type}</p></div> },
            { key: 'p', header: 'Provider', cell: (x) => x.toProvider ? `${x.provider} → ${x.toProvider}` : x.provider ?? '—' },
            { key: 'k', header: 'Reason', cell: (x) => x.kind ? <div><p className="text-[13px]">{statusLabel(x.kind)}</p><p className="font-mono text-xs text-fg-subtle">{x.kind}</p></div> : '' },
            { key: 's', header: 'Student', cell: (x) => who(x.studentId) },
            { key: 'm', header: 'Detail', cell: (x) => <span className="block max-w-xs truncate text-xs text-fg-muted" title={x.message}>{x.message}</span> },
          ]} />
          <Pagination page={page} pageSize={e.data.pageSize} total={e.data.total} onPage={(p) => setU({ epage: String(p) })} />
        </>
      )}
    </Card>
  );
}
function Conflicts() {
  const [u, setU] = useUrlState({ cpage: '1' });
  const page = Number(u.cpage) || 1;
  const c = useApi<Paged<{ _id: string; type: string; submissionId?: string; slug?: string; expected?: unknown; received?: unknown; provider?: string; at: string; studentId?: { fullName: string; rollNumber: string } }>>(`/leetcode/integration/conflicts${qs({ page })}`);
  return (
    <Card flush title="Conflicting data" description="Conflicting data is never used to award verification.">
      {c.error ? <ErrorState message={c.error} retry={c.reload} /> : !c.data ? <TableSkeleton /> : (
        <>
          <DataTable rows={c.data.items} rowKey={(x) => x._id} caption="Evidence conflicts" empty={<EmptyState compact title="No conflicts" />} columns={[
            { key: 't', header: 'When', cell: (x) => fmtDateTime(x.at) },
            { key: 'y', header: 'Type', cell: (x) => <div><p className="text-[13px]">{statusLabel(x.type)}</p><p className="font-mono text-xs text-fg-subtle">{x.type}</p></div> },
            { key: 's', header: 'Student', cell: (x) => who(x.studentId) },
            { key: 'p', header: 'Provider', cell: (x) => x.provider ?? '—' },
            { key: 'id', header: 'Submission', cell: (x) => <span className="font-mono text-xs text-fg-muted">{x.submissionId ?? '—'}</span> },
            { key: 'd', header: 'Expected → received', cell: (x) => { const t = `${JSON.stringify(x.expected ?? {})} → ${JSON.stringify(x.received ?? {})}`; return <span className="block max-w-xs truncate font-mono text-xs text-fg-muted" title={t}>{t}</span>; } },
          ]} />
          <Pagination page={page} pageSize={c.data.pageSize} total={c.data.total} onPage={(p) => setU({ cpage: String(p) })} />
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
        <Input label="Automatic update every (min)" type="number" min={5} max={240} value={v.autoIntervalMin} onChange={n('autoIntervalMin')} hint={`After each successful update · ${from('autoIntervalMin')}`} />
        <Input label="Outside bootcamp hours: every (min, 0 = off)" type="number" min={0} max={1440} value={v.offHoursIntervalMin} onChange={n('offHoursIntervalMin')} hint={`0 disables automatic updates outside hours · ${from('offHoursIntervalMin')}`} />
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
