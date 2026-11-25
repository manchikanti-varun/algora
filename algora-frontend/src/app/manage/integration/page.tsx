'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, fmtDateTime, Grid, Input, Notice, PageHeader, PageSkeleton, Pagination, StatCard, StatusBadge, TableSkeleton, Tabs, timeAgo, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage, qs } from '@/lib/api';
import type { Paged } from '@/components/manage/types';

interface ProviderView {
  id: string; displayName: string; priority: number; envEnabled: boolean; adminEnabled: boolean; authorized: boolean; authorizationReason?: string; transportKind: string;
  status: string; breaker: string; nextEligibleAt: string | null; totalRequests: number; successes: number; failures: number; rateLimited: number; consecutiveFailures: number;
  successRate: number | null; avgLatencyMs: number | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; lastErrorKind: string | null;
  ratePerMin: number; tokensAvailable: number;
  capabilities: { acceptedOnly: boolean; windowSize: number; submissionIds: boolean; cacheTtlSec: number; upstream: string; reachesUpstreamDirectly: boolean };
}
interface Overview {
  overall: string; syncEnabled: boolean; paused: boolean; permissionConfigured: boolean; selectedProvider: string | null; priority: string[];
  upstream: { id: string; blocked: boolean; blockedUntil: string | null; reason: string | null; ratePerMin: number; tokensAvailable: number; utilizationPct: number };
  providers: ProviderView[]; queue: { eligibleStudents: number; due: number; syncing: number };
  students: { withFailures: number; possibleGaps: number; reducedCoverage: number }; conflicts7d: number; healthCheckConfigured: boolean;
  settings: { paused: boolean; priority?: string[]; disabled: string[]; ratePerMin?: number; providerRatePerMin: Record<string, number>; activeIntervalMin?: number; idleIntervalMin?: number; offHoursIntervalMin?: number; studentCooldownSec?: number;
    effective: { ratePerMin: number; activeIntervalMin: number; idleIntervalMin: number; offHoursIntervalMin: number; studentCooldownSec: number; providerRatePerMin: Record<string, number> };
    ceilings: { ratePerMin: number; provider: Record<string, number> } };
}
interface Ev { _id: string; type: string; provider?: string; toProvider?: string; kind?: string; message?: string; at: string; studentId?: { fullName: string; rollNumber: string } | null }

const OVERALL: Record<string, { tone: 'good' | 'warn' | 'bad' | 'default'; text: string }> = {
  HEALTHY: { tone: 'good', text: 'Healthy' }, DEGRADED: { tone: 'warn', text: 'Degraded' }, UNAVAILABLE: { tone: 'bad', text: 'Unavailable' },
  UPSTREAM_BLOCKED: { tone: 'bad', text: 'LeetCode restricted' }, PAUSED: { tone: 'warn', text: 'Paused' }, DISABLED: { tone: 'default', text: 'Disabled' }, NO_AUTHORIZED_PROVIDER: { tone: 'warn', text: 'No authorised provider' },
};
const PROVIDER_TONE: Record<string, string> = { HEALTHY: 'ACTIVE', DEGRADED: 'PARTIAL', UNAVAILABLE: 'PROVIDER_UNAVAILABLE', RATE_LIMITED: 'RATE_LIMITED', CIRCUIT_OPEN: 'FAILED', DISABLED: 'INACTIVE', ACCESS_NOT_AUTHORIZED: 'REVOKED' };

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
      {d.syncEnabled && !d.permissionConfigured && <Notice tone="warn" title="No LeetCode permission reference">Providers that reach LeetCode are not authorised until LEETCODE_PERMISSION_REF is configured.</Notice>}
      {d.upstream.blocked && <Notice tone="error" title="LeetCode is restricting or unavailable">Reason: {d.upstream.reason?.replace(/_/g, ' ').toLowerCase()}. Every provider that depends on LeetCode is paused until {fmtDateTime(d.upstream.blockedUntil)}. Algora does not switch providers to get around a LeetCode restriction.</Notice>}
      {d.providers.some((p) => p.transportKind === 'mock' && p.envEnabled) && <Notice tone="info">A development mock provider is active in this environment. Its data never counts in production.</Notice>}

      <Grid>
        <StatCard label="Overall" value={ov.text} tone={ov.tone} hint={d.selectedProvider ? `Serving through: ${d.providers.find((p) => p.id === d.selectedProvider)?.displayName}` : 'No provider serving'} />
        <StatCard label="LeetCode budget (shared)" value={`${d.upstream.utilizationPct}% used`} hint={`${d.upstream.tokensAvailable} of ${Math.max(5, d.upstream.ratePerMin)} tokens left · ${d.upstream.ratePerMin}/min across all providers and instances`} />
        <StatCard label="Sync queue" value={d.queue.due} hint={`${d.queue.syncing} syncing now · ${d.queue.eligibleStudents} eligible students`} />
        <StatCard label="Students needing attention" value={d.students.withFailures + d.students.possibleGaps} tone={d.students.withFailures + d.students.possibleGaps ? 'warn' : 'default'}
          hint={`${d.students.withFailures} failing · ${d.students.possibleGaps} possible gaps · ${d.students.reducedCoverage} reduced coverage · ${d.conflicts7d} conflicts (7 d)`} />
      </Grid>

      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'providers', label: 'Providers' }, { key: 'events', label: 'Failover & errors' }, { key: 'conflicts', label: 'Evidence conflicts' }, { key: 'settings', label: 'Schedule & limits' }]} />

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
                    <StatusBadge status={PROVIDER_TONE[p.status] ?? p.status} /><span className="text-xs text-slate-500">{p.status.replace(/_/g, ' ').toLowerCase()}</span>
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
                  {!p.authorized && <p className="mt-2 text-sm text-rose-700">Not authorised: {p.authorizationReason}</p>}
                  {p.authorized && !p.envEnabled && <p className="mt-2 text-sm text-slate-500">Not enabled in the server environment.</p>}
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                    <div><dt className="text-xs text-slate-500">Success rate</dt><dd>{p.successRate === null ? '—' : `${p.successRate}%`} <span className="text-xs text-slate-400">({p.successes}/{p.totalRequests})</span></dd></div>
                    <div><dt className="text-xs text-slate-500">Avg latency</dt><dd>{p.avgLatencyMs === null ? '—' : `${p.avgLatencyMs} ms`}</dd></div>
                    <div><dt className="text-xs text-slate-500">Failures · rate limited</dt><dd>{p.failures} · {p.rateLimited} <span className="text-xs text-slate-400">({p.consecutiveFailures} in a row)</span></dd></div>
                    <div><dt className="text-xs text-slate-500">Circuit</dt><dd>{p.breaker.toLowerCase().replace('_', '-')}{p.nextEligibleAt && <span className="text-xs text-slate-400"> · retry {fmtDateTime(p.nextEligibleAt)}</span>}</dd></div>
                    <div><dt className="text-xs text-slate-500">Own budget</dt><dd>{p.tokensAvailable}/{Math.max(5, p.ratePerMin)} · {p.ratePerMin}/min</dd></div>
                    <div><dt className="text-xs text-slate-500">Last success · failure</dt><dd>{timeAgo(p.lastSuccessAt)} · {timeAgo(p.lastFailureAt)}</dd></div>
                  </dl>
                  {p.lastError && <p className="mt-2 truncate text-xs text-slate-500" title={p.lastError}>Last error ({p.lastErrorKind}): {p.lastError}</p>}
                  <p className="mt-2 text-xs text-slate-400">Window {p.capabilities.windowSize} · {p.capabilities.acceptedOnly ? 'accepted only' : 'all statuses, filtered'} · submission ids {p.capabilities.submissionIds ? 'yes' : 'no'} · cache {p.capabilities.cacheTtlSec}s · upstream {p.capabilities.upstream}{p.capabilities.reachesUpstreamDirectly ? '' : ' (via relay)'}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {tab === 'events' && <Events />}
      {tab === 'conflicts' && <Conflicts />}
      {tab === 'settings' && <SettingsForm d={d} onSave={save} busy={busy === 'save'} />}
    </div>
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
  const e = d.settings.effective; const c = d.settings.ceilings;
  const [v, setV] = useState({ ratePerMin: e.ratePerMin, activeIntervalMin: e.activeIntervalMin, idleIntervalMin: e.idleIntervalMin, offHoursIntervalMin: e.offHoursIntervalMin, studentCooldownSec: e.studentCooldownSec, providerRatePerMin: { ...e.providerRatePerMin } });
  const n = (k: keyof typeof v) => (x: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(x.target.value) });
  return (
    <Card title="Schedule and request limits">
      <Notice tone="info">Limits can be lowered below the server ceilings, never raised above them. Set ceilings from the limits LeetCode authorises and from measurements, not guesses.</Notice>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="Shared LeetCode budget (requests/min)" type="number" min={1} max={c.ratePerMin} value={v.ratePerMin} onChange={n('ratePerMin')} hint={`Ceiling ${c.ratePerMin}/min. Shared by every provider and instance.`} />
        <Input label="Active students: every (min)" type="number" min={5} max={240} value={v.activeIntervalMin} onChange={n('activeIntervalMin')} hint="During bootcamp hours, students seen in the last hour" />
        <Input label="Other students: every (min)" type="number" min={5} max={1440} value={v.idleIntervalMin} onChange={n('idleIntervalMin')} hint="During bootcamp hours" />
        <Input label="Outside bootcamp hours: every (min)" type="number" min={15} max={1440} value={v.offHoursIntervalMin} onChange={n('offHoursIntervalMin')} hint="Only students active in the last 24 h" />
        <Input label="Student sync cooldown (s)" type="number" min={10} max={3600} value={v.studentCooldownSec} onChange={n('studentCooldownSec')} hint="Minimum time between manual or tab-return syncs" />
        {d.providers.map((p) => (
          <Input key={p.id} label={`${p.displayName} budget (requests/min)`} type="number" min={1} max={c.provider[p.id]} value={v.providerRatePerMin[p.id] ?? c.provider[p.id]} hint={`Ceiling ${c.provider[p.id]}/min`}
            onChange={(x) => setV({ ...v, providerRatePerMin: { ...v.providerRatePerMin, [p.id]: Number(x.target.value) } })} />
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button loading={busy} onClick={() => onSave(v, 'Schedule and limits saved')}>Save</Button>
        <Button variant="ghost" onClick={() => onSave({ ratePerMin: undefined, activeIntervalMin: undefined, idleIntervalMin: undefined, offHoursIntervalMin: undefined, studentCooldownSec: undefined, providerRatePerMin: {} }, 'Reset to server defaults')}>Reset to defaults</Button>
      </div>
    </Card>
  );
}
