'use client';
import { useState, type FormEvent } from 'react';
import { Badge, BarList, Button, Card, Checkbox, DescriptionList, ErrorState, Grid, Input, Notice, PageHeader, Select, StatCard, useConfirm, useToast } from '@/components/ui';
import { ProviderConfigForm, type ProviderBudgetView as Budget, type ProviderConfig as Config } from '@/components/ai/ProviderConfigForm';
import { useApi } from '@/hooks/useApi';
import { api, download, errorMessage, qs } from '@/lib/api';
import { BrainCircuit, GraduationCap, Settings2 } from 'lucide-react';

const base = '/ai/management';
const workloads = ['STUDENT_MENTOR', 'STAFF_PREPARATION'] as const;
type Workload = typeof workloads[number];
const label = (id: Workload) => id === 'STUDENT_MENTOR' ? 'Student AI' : 'Staff AI';
const names: Record<string, string> = {
  GROQ: 'Groq', GEMINI: 'Google Gemini', OPENROUTER: 'OpenRouter', OPENAI: 'OpenAI', ANTHROPIC: 'Anthropic',
  DEEPSEEK: 'DeepSeek', MISTRAL: 'Mistral AI', CUSTOM: 'Approved OpenAI-compatible endpoint',
};
const filterKeys = ['from', 'to', 'workload', 'provider', 'role', 'userId', 'collegeId', 'batchId', 'courseId', 'chapterId', 'problemId', 'action', 'configId', 'model', 'status'] as const;
const filters: Record<typeof filterKeys[number], string> = {
  from: 'From', to: 'To', workload: 'Workload', provider: 'Provider', role: 'User role', userId: 'Student or trainer ID', collegeId: 'College ID', batchId: 'Batch ID',
  courseId: 'Course ID', chapterId: 'Chapter ID', problemId: 'Problem ID', action: 'Assistance or preparation action',
  configId: 'Configuration ID', model: 'Model', status: 'Request status',
};
const limitLabels: Record<string, string> = {
  daily: 'Personal daily allowance', minute: 'Personal requests per minute', requestsDay: 'Workload requests per day',
  requestsMinute: 'Workload requests per minute', tokensDay: 'Workload tokens per day', tokensMinute: 'Workload tokens per minute',
  concurrency: 'Concurrent requests', output: 'Maximum output tokens', context: 'Maximum input budget', code: 'Maximum code characters',
  generationDay: 'Staff generation requests per person per day', conversationDay: 'Staff follow-ups per person per day',
  history: 'Conversation turns sent', retention: 'Conversation retention days', chapterSize: 'Maximum problems per job',
};
interface Settings {
  workload: Workload; enabled: boolean; activeId?: string; servingId?: string; limits: Record<string, number>;
  mode: 'MANUAL' | 'AUTO'; recovery: 'COOLDOWN' | 'STICKY'; maxBackups: number; paidAllowed: boolean; budget?: { requests: number; tokens: number };
}
interface Metric { requests: number; outbound: number; local: number; success: number; failed: number; rateLimited: number; input: number; output: number; total: number; unknownTokens: number; averageLatency?: number; uniqueUsers?: number; backupAttempts?: number; costUsd?: number; knownCost?: number }
interface ProviderMetric extends Metric { _id: string; quota?: Record<string, string>; lastObserved?: string; lastSuccess?: string; lastFailureAt?: string; lastStatus?: string; lastFailure?: string }
interface Usage {
  workloads: (Metric & { _id: Workload })[]; daily: (Metric & { _id: { day: string; workload: Workload } })[];
  actions: (Metric & { _id: string })[]; problems: (Metric & { _id: string })[]; history: ProviderMetric[]; providers: ProviderMetric[];
}
interface Batch { _id: string; name: string; controls?: { enabled?: boolean; daily?: number; courseIds: string[]; startsAt?: string; endsAt?: string; startMinute?: number; endMinute?: number } }
const date = (value?: string) => value ? new Date(value).toLocaleString() : 'Unavailable';
const num = (value?: number) => value?.toLocaleString() ?? '0';

export default function Page() {
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const settings = useApi<{ encryptionReady: boolean; workloads: Settings[]; providers: string[]; customEndpoints: string[] }>(`${base}/settings`);
  const providers = useApi<{ items: Config[] }>(`${base}/providers`);
  const usage = useApi<Usage>(['overview', 'student', 'staff', 'usage'].includes(tab) ? `${base}/usage${qs(tab === 'usage' ? query : {})}` : null);
  const toast = useToast();
  async function refresh() { await Promise.all([settings.reload(), providers.reload(), usage.reload()]); }
  return <div className="space-y-5">
    <PageHeader title="AI Management" subtitle="Configure AI providers, workload budgets and practice access." />
    <div role="group" aria-label="AI Management views" className="flex flex-wrap gap-2">
      {Object.entries({ overview: 'Overview', student: 'Student AI', staff: 'Staff AI', usage: 'Usage analytics',
        'student-limits': 'Student limits', 'staff-limits': 'Staff limits', failover: 'Failover history', batches: 'Batch controls', education: 'Educational settings' }).map(([key, name]) =>
        <Button key={key} size="sm" variant={tab === key ? 'primary' : 'secondary'} aria-pressed={tab === key} onClick={() => setTab(key)}>{name}</Button>)}
    </div>
    {settings.data && !settings.data.encryptionReady && <Notice tone="warn">Railway credential encryption is missing or invalid. Provider requests are unavailable.</Notice>}
    {(settings.error || providers.error || usage.error) && <ErrorState message={settings.error ?? providers.error ?? usage.error!} retry={refresh} />}
    {tab === 'overview' && <div className="grid gap-4 lg:grid-cols-2">
      {workloads.map((workload) => <WorkloadOverview key={workload} workload={workload} control={settings.data?.workloads.find((w) => w.workload === workload)}
        items={providers.data?.items ?? []} usage={usage.data} encryption={!!settings.data?.encryptionReady}
        setTab={setTab} refresh={refresh} />)}
    </div>}
    {(tab === 'student' || tab === 'staff') && <Providers key={tab} workload={tab === 'student' ? workloads[0] : workloads[1]}
      items={providers.data?.items ?? []} usage={usage.data} refresh={refresh} encryption={!!settings.data?.encryptionReady}
      controls={settings.data?.workloads.find((item) => item.workload === (tab === 'student' ? workloads[0] : workloads[1]))}
      providerOptions={settings.data?.providers ?? ['GROQ']} endpoints={settings.data?.customEndpoints ?? []} />}
    {(tab === 'student-limits' || tab === 'staff-limits' || tab === 'education') && settings.data?.workloads
      .filter((item) => tab === 'education' || item.workload === (tab === 'student-limits' ? workloads[0] : workloads[1]))
      .map((item) => <Limits key={`${tab}:${item.workload}:${JSON.stringify(item.limits)}:${item.enabled}`} item={item} education={tab === 'education'} refresh={settings.reload} />)}
    {tab === 'failover' && <FailoverHistory items={providers.data?.items ?? []} />}
    {tab === 'batches' && <Batches />}
    {tab === 'usage' && <>
      <Card title="Usage filters">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setQuery(draft); }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{filterKeys.map((key) => key === 'workload' || key === 'role' || key === 'provider' ? (
            <Select key={key} label={filters[key]} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              options={[{ value: '', label: 'All' }, ...(key === 'workload' ? workloads : key === 'provider' ? Object.keys(names) : ['STUDENT', 'TRAINER', 'SUPER_ADMIN']).map((value) => ({ value, label: value }))]} />
          ) : <Input key={key} label={filters[key]} type={key === 'from' || key === 'to' ? 'date' : 'text'}
            value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />)}</div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Apply filters</Button>
            {['csv', 'xlsx'].map((format) => <Button key={format} variant="secondary"
              onClick={() => void download(`${base}/usage/export${qs({ ...query, format })}`).catch((e) => toast.error(errorMessage(e)))}>Export {format.toUpperCase()}</Button>)}
          </div>
        </form>
      </Card>
      <Card title="Daily usage" description="Algora-observed activity. Token totals include reported usage only and can differ from organization-wide usage.">
        <BarList items={(usage.data?.daily ?? []).slice(-14).map((row) => ({
          key: `${row._id.day}:${row._id.workload}`, label: `${row._id.day} · ${label(row._id.workload)}`, value: row.outbound,
          sub: row.unknownTokens === row.outbound && row.outbound ? 'Token usage unavailable' : `${num(row.total)} reported tokens`,
        }))} />
        <List rows={(usage.data?.daily ?? []).map((row) => ({ name: `${row._id.day} · ${label(row._id.workload)}`, ...row }))} />
      </Card>
      <Card title="Assistance and preparation actions"><List rows={(usage.data?.actions ?? []).map((row) => ({ name: row._id, ...row }))} /></Card>
      <Card title="Most assisted problems"><List rows={(usage.data?.problems ?? []).map((row) => ({ name: row._id, ...row }))} /></Card>
    </>}
  </div>;
}

function WorkloadOverview({ workload, control, items, usage, encryption, setTab, refresh }: {
  workload: Workload; control?: Settings; items: Config[]; usage?: Usage | null; encryption: boolean;
  setTab: (tab: string) => void; refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const active = items.find((item) => item._id === control?.activeId);
  const eligible = active?.eligible === true;
  const metric = usage?.workloads.find((row) => row._id === workload);
  const model = workload === 'STUDENT_MENTOR' ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b';
  const status = !control?.enabled ? 'Connected but disabled'
    : !active ? 'Not configured'
    : !eligible ? 'Connection failed'
    : 'Enabled and ready';
  async function toggle() {
    if (!control || busy) return;
    setBusy(true);
    try {
      await api(`${base}/settings/${workload}`, { method: 'PATCH', body: { enabled: !control.enabled } });
      await refresh();
      toast.success(control.enabled ? `${label(workload)} disabled` : `${label(workload)} enabled`);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Card title={<span className="flex items-center gap-2">{workload === 'STUDENT_MENTOR' ? <GraduationCap size={18} aria-hidden /> : <BrainCircuit size={18} aria-hidden />}{label(workload)}</span>}
    actions={<Badge tone={control?.enabled ? 'success' : 'neutral'} dot>{control?.enabled ? 'Enabled' : 'Disabled'}</Badge>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{status}</p>
          <p className="mt-1 text-xs text-fg-muted">Groq · {model}</p>
        </div>
        <Button size="sm" loading={busy} disabled={!encryption || !control}
          variant={control?.enabled ? 'secondary' : 'primary'} onClick={() => void toggle()}>
          {control?.enabled ? 'Disable workload' : 'Enable workload'}
        </Button>
      </div>
      {!encryption && <Notice tone="warn">Credential encryption is unavailable. Configure the Railway encryption key before activating AI.</Notice>}
      {control && !active && <Notice tone="info">Add a Groq API key to configure this workload.</Notice>}
      <Grid cols={3}>
        <StatCard label="Active configuration" value={active?.name ?? 'None'} />
        <StatCard label="Today's requests" value={num(metric?.outbound)} />
        <StatCard label="Today's tokens" value={metric ? num(metric.total) : '0'} />
      </Grid>
      {control?.budget && <p className="text-xs text-fg-muted">Remaining application allowance: {num(Math.max(0, control.limits.requestsDay - control.budget.requests))} requests · {num(Math.max(0, control.limits.tokensDay - control.budget.tokens))} tokens.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Settings2 size={14} aria-hidden />} onClick={() => setTab(workload === 'STUDENT_MENTOR' ? 'student' : 'staff')}>Manage API keys</Button>
      </div>
    </div>
  </Card>;
}

function List({ rows }: { rows: (Metric & { name: string })[] }) {
  return rows.length ? <ul className="divide-y divide-line">{rows.map((row) => <li key={row.name} className="py-2 text-sm">
    <strong>{row.name}</strong> · {num(row.outbound)} sent · {num(row.local)} local · {num(row.success)} successful · {num(row.failed)} failed · {num(row.rateLimited)} rate-limited · {num(row.total)} reported tokens
  </li>)}</ul> : <p className="text-sm text-fg-muted">No matching activity.</p>;
}

function WorkloadSummary({ workload, controls, items, usage }: {
  workload: Workload; controls?: Settings; items: Config[]; usage?: Usage | null;
}) {
  const active = items.find((item) => item._id === controls?.activeId);
  const serving = items.find((item) => item._id === controls?.servingId && item.eligible) ?? active;
  const backups = items.filter((item) => item.backup && item.eligible && !item.active).sort((a, b) => a.priority - b.priority);
  const metric = usage?.workloads.find((row) => row._id === workload);
  const remaining = controls?.budget ? {
    requests: Math.max(0, controls.limits.requestsDay - controls.budget.requests),
    tokens: Math.max(0, controls.limits.tokensDay - controls.budget.tokens),
  } : undefined;
  return <Card title={`${label(workload)} status`} description="Provider configuration and application budgets are independent for each workload.">
    <DescriptionList cols={3} items={[
      { label: 'Workload', value: controls?.enabled ? 'Enabled' : 'Disabled' },
      { label: 'Active provider', value: active ? `${names[active.provider] ?? active.provider} · ${active.model}` : 'None' },
      { label: 'Routing', value: controls?.mode === 'AUTO' ? 'Automatic failover' : 'Manual selection' },
      { label: 'Serving', value: serving ? serving.name : 'Unavailable' },
      { label: 'Saved configurations', value: `${items.length} of 10` },
      { label: 'Eligible backups', value: backups.length ? `${backups.length} · ${backups.map((entry) => entry.name).join(' → ')}` : 'None' },
      { label: 'Today requests', value: num(metric?.outbound) },
      { label: 'Today tokens', value: metric ? (metric.outbound > 0 && metric.unknownTokens >= metric.outbound ? 'Unavailable' : num(metric.total)) : '0' },
      { label: 'Remaining app budget', value: remaining ? `${num(remaining.requests)} requests · ${num(remaining.tokens)} tokens` : 'Unavailable' },
    ]} />
  </Card>;
}

function ObservedQuota({ quota, observed }: { quota?: Record<string, string>; observed?: string }) {
  const values = Object.entries(quota ?? {});
  if (!values.length) return <p className="text-sm text-fg-muted">Provider-reported allowance: Unavailable. Run Test connection to capture headers when the provider reports them.</p>;
  return <details className="text-sm text-fg-muted">
    <summary className="cursor-pointer">Provider-reported allowance ({values.length} headers) · {date(observed)}</summary>
    <dl className="mt-2 grid gap-1">
      {values.map(([header, value]) => <div key={header} className="flex flex-wrap gap-x-2"><dt>{header}</dt><dd>{value}</dd></div>)}
    </dl>
    <p>Provider-defined limits and remaining allowance only. Application budgets are shown separately.</p>
  </details>;
}

function tokenValue(row: ProviderMetric | undefined, field: 'input' | 'output' | 'total') {
  if (!row) return 'Unavailable';
  return row.outbound > 0 && row.unknownTokens >= row.outbound ? 'Unavailable' : num(row[field]);
}

/** Mirrors the backend eligibility rules so the card can explain why activation is unavailable. */
function eligibility(item: Config, controls?: Settings) {
  if (!item.enabled) return 'Disabled';
  if (item.eligible) return 'Enabled · Eligible';
  if (item.plan === 'PAID' && (!item.paidApproved || !controls?.paidAllowed)) return 'Enabled · Paid use not approved';
  if (item.plan !== 'PAID' && item.provider === 'OPENROUTER' && !item.model.endsWith(':free')) return 'Enabled · Free plan needs a :free model';
  if (item.provider !== 'GROQ' && !(item.lastTest?.status === 'SUCCESS' && item.lastTest.version === item.version)) return 'Enabled · Test this version before activation';
  return 'Enabled · Needs attention';
}

function Providers({ workload, items, usage, refresh, encryption, controls, providerOptions, endpoints }: {
  workload: Workload; items: Config[]; usage?: Usage | null; refresh: () => Promise<void>; encryption: boolean;
  controls?: Settings; providerOptions: string[]; endpoints: string[];
}) {
  const [edit, setEdit] = useState<Config | 'new' | null>(null);
  const [budget, setBudget] = useState<string>();
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  async function action(path: string, method = 'POST', body?: unknown, success = 'Configuration updated') {
    setBusy(true);
    try { await api(`${base}/providers${path}`, { method, body }); toast.success(success); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { await refresh(); setBusy(false); }
  }
  const saved = items.filter((item) => item.workload === workload);
  return <div className="space-y-3">
    {controls && <Card title={`${label(workload)} availability`}
      actions={<Badge tone={controls.enabled ? 'success' : 'neutral'} dot>{controls.enabled ? 'Enabled' : 'Disabled'}</Badge>}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">{controls.enabled
          ? saved.some((item) => item.active && item.eligible) ? 'Enabled and ready for eligible requests.' : 'Enabled, but no eligible primary is configured.'
          : 'Disabled. Saved configurations remain available for testing and editing.'}</p>
        <Button size="sm" loading={busy} variant={controls.enabled ? 'secondary' : 'primary'}
          onClick={() => void api(`${base}/settings/${workload}`, { method: 'PATCH', body: { enabled: !controls.enabled } })
            .then(() => { toast.success(`${label(workload)} ${controls.enabled ? 'disabled' : 'enabled'}`); void refresh(); })
            .catch((err) => toast.error(errorMessage(err)))}>{controls.enabled ? 'Disable workload' : 'Enable workload'}</Button>
      </div>
    </Card>}
    <WorkloadSummary workload={workload} controls={controls} items={saved} usage={usage} />
    {controls && <Switching key={JSON.stringify([controls.mode, controls.recovery, controls.maxBackups, controls.paidAllowed])} settings={controls} refresh={refresh} />}
    <Card title={`${label(workload)} configurations`} description="Up to 10 independent encrypted configurations. Student AI and Staff AI are configured separately."
      actions={<Button disabled={!encryption || busy || saved.length >= 10} onClick={() => setEdit('new')}>Add configuration</Button>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-fg-muted">{saved.length} of 10 saved · {saved.filter((item) => item.enabled).length} enabled</span>
        <Button variant="secondary" disabled={busy} onClick={() => void action(`/deactivate/${workload}`, 'POST', undefined, 'Active configuration cleared')}>Deactivate all</Button>
      </div>
    </Card>
    {saved.map((item) => {
      const history = usage?.history.find((row) => row._id === item._id);
      const today = usage?.providers.find((row) => row._id === item._id);
      const quota = history?.quota ?? item.lastTest?.quota;
      const remainingRequests = item.budget ? Math.max(0, item.budget.configured.requestsDay - item.budget.day.requests) : undefined;
      const remainingTokens = item.budget ? Math.max(0, item.budget.configured.tokensDay - item.budget.day.tokens) : undefined;
      return <Card title={item.name} key={item._id}
        description={`${item.active ? 'Primary' : item.backup ? 'Backup' : 'Inactive'} · ${names[item.provider] ?? item.provider} · ${item.model} · ${item.masked} · ${item.plan === 'PAID' ? 'Paid' : 'Free'}`}>
        <DescriptionList cols={4} items={[
          { label: 'Status', value: eligibility(item, controls) },
          { label: 'Connection', value: item.lastTest ? `${item.lastTest.status} · ${item.lastTest.latency} ms` : 'Untested' },
          { label: 'Today', value: `${num(today?.outbound)} provider attempts` },
          { label: 'Last success', value: history?.lastSuccess ? date(history.lastSuccess) : 'Unavailable' },
          { label: 'Input tokens', value: tokenValue(history, 'input') },
          { label: 'Output tokens', value: tokenValue(history, 'output') },
          { label: 'Total tokens', value: tokenValue(history, 'total') },
          { label: 'Remaining configuration budget', value: remainingRequests == null ? 'Unavailable' : `${num(remainingRequests)} requests · ${num(remainingTokens)} tokens` },
        ]} />
        <div className="mt-3"><ObservedQuota quota={quota} observed={history?.lastObserved ?? item.lastTest?.at} /></div>
        {(item.circuitUntil || item.budget?.quotaCooldownUntil) && <p className="mt-2 text-sm text-warning-fg">
          Provider cooling down until {date(item.circuitUntil ?? item.budget?.quotaCooldownUntil)}
        </p>}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-fg-muted">Technical details and lifetime usage</summary>
          <div className="mt-2 space-y-1 text-fg-muted">
            <p>Priority {item.priority} · Quota group {item.quotaGroup} ({item.quotaScope.toLowerCase()}) · Version {item.version} · {item.timeoutMs} ms timeout</p>
            {item.circuitUntil && <p>Recovery probe eligible after {date(item.circuitUntil)}</p>}
            {history ? <>
              <p>Lifetime {num(history.outbound)} sent · {num(history.success)} successful · {num(history.failed)} failed · {num(history.rateLimited)} rate-limited</p>
              <p>{num(history.input)} input · {num(history.output)} output · {num(history.total)} reported total · {num(history.unknownTokens)} with unknown usage</p>
              <p>{history.averageLatency != null && `Average ${Math.round(history.averageLatency)} ms · `}Last failure {date(history.lastFailureAt)} · Last observed {date(history.lastObserved)}</p>
              <p>Known or estimated spend {history.knownCost ? `$${history.costUsd?.toFixed(4)}` : 'Unavailable'}</p>
            </> : <p>No provider usage recorded yet.</p>}
          </div>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEdit(item)}>Edit configuration</Button>
          <Button size="sm" variant="secondary" disabled={busy || !encryption || (item.plan === 'PAID' && (!item.paidApproved || !controls?.paidAllowed))}
            onClick={() => void action(`/${item._id}/test`, 'POST', undefined, 'Connection tested')}>Test connection</Button>
          {!item.active || controls?.servingId !== item._id ? <Button size="sm" disabled={busy || !encryption || !item.eligible}
            onClick={() => void action(`/${item._id}/activate`, 'POST', undefined, 'Primary configuration activated')}>{item.active ? 'Restore primary' : 'Activate'}</Button> : null}
          {item.active && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(`/deactivate/${workload}`, 'POST', undefined, 'Active configuration cleared')}>Deactivate</Button>}
          <Button size="sm" variant="secondary" disabled={busy}
            onClick={() => void action(`/${item._id}`, 'PATCH', { enabled: !item.enabled }, item.enabled ? 'Configuration disabled' : 'Configuration enabled')}>
            {item.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setBudget(budget === item._id ? undefined : item._id)}>{budget === item._id ? 'Hide budget' : 'View application budget'}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void confirm({ title: 'Archive this configuration?', body: 'The stored credential is removed. Usage history remains available.', confirmLabel: 'Archive', danger: true })
            .then((ok) => { if (ok) void action(`/${item._id}`, 'DELETE', undefined, 'Configuration archived'); })}>Archive</Button>
        </div>
        {budget === item._id && <ProviderBudget id={item._id} spending={item.spending?.dailyUsd} />}
      </Card>;
    })}
    {edit && <ProviderConfigForm key={edit === 'new' ? 'new' : edit._id} workload={workload} current={edit === 'new' ? undefined : edit}
      providerOptions={providerOptions} endpoints={endpoints} close={() => setEdit(null)} refresh={refresh} />}
  </div>;
}

function ProviderBudget({ id, spending }: { id: string; spending?: number }) {
  const budget = useApi<Budget>(`${base}/providers/${id}/budget`);
  if (budget.error) return <ErrorState message={budget.error} retry={budget.reload} />;
  if (!budget.data) return <p className="text-sm">Loading application budget…</p>;
  const { day, minute, configured, quotaCooldownUntil } = budget.data;
  const remaining = (limit: number, used: number) => num(Math.max(0, limit - used));
  return <div className="mt-3 space-y-1 text-sm">
    <p>Today {num(day.requests)} / {num(configured.requestsDay)} requests, {num(day.tokens)} / {num(configured.tokensDay)} reserved or reported tokens.</p>
    <p>Remaining application budget today {remaining(configured.requestsDay, day.requests)} requests and {remaining(configured.tokensDay, day.tokens)} tokens.</p>
    <p>This minute {remaining(configured.requestsMinute, minute.requests)} requests and {remaining(configured.tokensMinute, minute.tokens)} tokens remaining.</p>
    {spending && <p>Daily application spend estimate ${day.estimatedUsd.toFixed(4)} / ${spending.toFixed(2)} USD.</p>}
    {quotaCooldownUntil && <p>Shared quota cooling down until {date(quotaCooldownUntil)}.</p>}
  </div>;
}

function Switching({ settings, refresh }: { settings: Settings; refresh: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`${base}/settings/${settings.workload}`, { method: 'PATCH', body: {
        mode: form.get('mode'), recovery: form.get('recovery'), maxBackups: Number(form.get('maxBackups')), paidAllowed: form.has('paidAllowed'),
      } });
      await refresh();
      toast.success('Provider policy saved');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Card title={`${label(settings.workload)} routing`}>
    <form className="space-y-3" onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select name="mode" label="Switching mode" defaultValue={settings.mode} options={[{ value: 'MANUAL', label: 'Manual' }, { value: 'AUTO', label: 'Automatic failover' }]} />
        <Select name="recovery" label="Primary recovery" defaultValue={settings.recovery} options={[{ value: 'COOLDOWN', label: 'Return after cooldown' }, { value: 'STICKY', label: 'Keep backup until manual restore' }]} />
        <Input name="maxBackups" label="Maximum backup attempts" type="number" min={1} max={2} required defaultValue={settings.maxBackups} />
      </div>
      <Checkbox name="paidAllowed" label="Allow explicitly approved paid configurations for this workload" defaultChecked={settings.paidAllowed} />
      <Button type="submit" loading={busy}>Save routing policy</Button>
    </form>
  </Card>;
}

function FailoverHistory({ items }: { items: Config[] }) {
  const history = useApi<{ items: { _id: string; targetId: string; actorId?: string; createdAt: string;
    metadata?: { workload?: string; mode?: string; previousId?: string; replacementId?: string; reason?: string; recovered?: boolean } }[] }>(`${base}/failover-history`);
  const name = (id?: string) => id ? items.find((item) => item._id === id)?.name ?? id : 'None';
  return <Card title="Failover history" actions={<Button size="sm" variant="secondary" onClick={() => void history.reload()}>Refresh</Button>}>
    {history.error ? <ErrorState message={history.error} retry={history.reload} /> :
      <ul className="divide-y divide-line">{history.data?.items.map(({ _id, createdAt, metadata, targetId, actorId }) => <li key={_id} className="py-2 text-sm">
        <p>{metadata?.workload ?? targetId} · {metadata?.mode ?? 'Manual'} · {metadata?.recovered ? 'Primary recovered' : metadata?.reason ?? 'Configuration updated'}</p>
        <p className="text-fg-muted">{name(metadata?.previousId)} → {name(metadata?.replacementId)} · {date(createdAt)}{actorId && ` · Actor ${actorId}`}</p>
      </li>)}</ul>}
    {history.data?.items.length === 0 && <p className="text-sm text-fg-muted">No switching decisions recorded.</p>}
  </Card>;
}


function Limits({ item, education, refresh }: { item: Settings; education: boolean; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fields = Object.keys(item.limits).filter((key) => (['code', 'history', 'retention'].includes(key)) === education &&
    (item.workload === 'STAFF_PREPARATION' || !['chapterSize', 'generationDay', 'conversationDay'].includes(key)));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`${base}/settings/${item.workload}`, { method: 'PATCH', body: {
        ...(education ? {} : { enabled: form.get('enabled') === 'on' }),
        limits: Object.fromEntries(fields.map((field) => [field, Number(form.get(field))])),
      } });
      toast.success('AI settings saved');
      await refresh();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Card title={label(item.workload)} description={education ? 'Bound context, retained conversations and pasted code.' : 'Set workload budgets independently of provider limits.'}>
    <form onSubmit={save} className="space-y-3">
      {!education && <Checkbox name="enabled" defaultChecked={item.enabled} label="Enable workload" />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map((field) => <Input key={field} name={field}
        label={limitLabels[field] ?? field} type="number" required min={1} defaultValue={item.limits[field]} />)}</div>
      <Button type="submit" loading={busy}>Save settings</Button>
    </form>
  </Card>;
}

function Batches() {
  const data = useApi<{ items: Batch[] }>(`${base}/batches`);
  const [id, setId] = useState('');
  const batch = data.data?.items.find((item) => item._id === id);
  return <Card title="Batch controls" description="Student availability times use Asia/Kolkata.">
    {data.error && <ErrorState message={data.error} retry={data.reload} />}
    <Select label="Batch" value={id} onChange={(e) => setId(e.target.value)} options={[{ value: '', label: 'Select a batch' },
      ...(data.data?.items ?? []).map((item) => ({ value: item._id, label: item.name }))]} />
    {batch && <BatchForm key={batch._id} batch={batch} refresh={data.reload} />}
  </Card>;
}
const time = (value?: number) => value == null ? '' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
function BatchForm({ batch, refresh }: { batch: Batch; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const c = batch.controls;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (field: string) => String(f.get(field) ?? '').trim();
    const minutes = (field: string) => { const v = text(field).split(':'); return v.length === 2 ? Number(v[0]) * 60 + Number(v[1]) : null; };
    setBusy(true);
    try {
      await api(`${base}/batches/${batch._id}`, { method: 'PUT', body: {
        enabled: text('policy') === 'inherit' ? null : text('policy') === 'enable',
        daily: text('daily') ? Number(text('daily')) : null, courseIds: text('courseIds').split(/[\s,]+/).filter(Boolean),
        startsAt: text('startsAt') ? `${text('startsAt')}T00:00:00+05:30` : null,
        endsAt: text('endsAt') ? `${text('endsAt')}T00:00:00+05:30` : null, startMinute: minutes('start'), endMinute: minutes('end'),
      } });
      toast.success('Batch controls saved');
      await refresh();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const indiaDate = (value?: string) => value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '';
  return <form onSubmit={save} className="mt-4 space-y-3">
    <Select name="policy" label="Batch AI policy" defaultValue={c?.enabled === true ? 'enable' : c?.enabled === false ? 'disable' : 'inherit'}
      options={[
        { value: 'inherit', label: 'Inherit global Student AI setting' },
        { value: 'enable', label: 'Explicitly enable for this batch' },
        { value: 'disable', label: 'Explicitly disable for this batch' },
      ]} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Input name="daily" label="Daily allowance override" type="number" min={1} max={1000} defaultValue={c?.daily} />
      <Input name="courseIds" label="Allowed course IDs (optional)" defaultValue={c?.courseIds.join(', ')} />
      <Input name="startsAt" type="date" label="Available from (optional)" defaultValue={indiaDate(c?.startsAt)} />
      <Input name="endsAt" type="date" label="Disable from (optional)" defaultValue={indiaDate(c?.endsAt)} />
      <Input name="start" type="time" label="Practice window starts (optional)" defaultValue={time(c?.startMinute)} />
      <Input name="end" type="time" label="Practice window ends (optional)" defaultValue={time(c?.endMinute)} />
    </div>
    <Button type="submit" loading={busy}>Save batch controls</Button>
  </form>;
}
