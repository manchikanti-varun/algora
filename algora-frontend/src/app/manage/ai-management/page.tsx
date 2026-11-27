'use client';
import { useState, type FormEvent } from 'react';
import { BarList, Button, Card, Checkbox, ErrorState, Grid, Input, Notice, PageHeader, Select, StatCard, useConfirm, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, download, errorMessage, qs } from '@/lib/api';

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
const providerFields = ['requestsDay', 'requestsMinute', 'tokensDay', 'tokensMinute'];
interface Settings {
  workload: Workload; enabled: boolean; activeId?: string; servingId?: string; limits: Record<string, number>;
  mode: 'MANUAL' | 'AUTO'; recovery: 'COOLDOWN' | 'STICKY'; maxBackups: number; paidAllowed: boolean; budget?: { requests: number; tokens: number };
}
interface Config {
  _id: string; workload: Workload; name: string; model: string; organization?: string; project?: string; quotaGroup: string;
  masked: string; plan: string; version: number; active: boolean; limits?: Record<string, number>; lastTest?: { status: string; latency: number };
  provider: string; endpoint?: string; eligible: boolean; enabled: boolean; backup: boolean; independent: boolean; priority: number;
  quotaScope: string; paidApproved: boolean; outputMode?: string; timeoutMs: number; inputLimit?: number; outputLimit?: number;
  spending?: { dailyUsd: number; inputPerMillion: number; outputPerMillion: number }; circuitUntil?: string;
}
interface Budget { configured: Record<string, number>; day: { requests: number; tokens: number; estimatedUsd: number };
  minute: { requests: number; tokens: number }; quotaCooldownUntil?: string }
interface Metric { requests: number; outbound: number; local: number; success: number; failed: number; rateLimited: number; input: number; output: number; total: number; unknownTokens: number; averageLatency?: number; uniqueUsers?: number; backupAttempts?: number; costUsd?: number; knownCost?: number }
interface ProviderMetric extends Metric { _id: string; quota?: Record<string, string>; lastObserved?: string; lastSuccess?: string; lastFailureAt?: string; lastStatus?: string; lastFailure?: string }
interface Usage {
  workloads: (Metric & { _id: Workload })[]; daily: (Metric & { _id: { day: string; workload: Workload } })[];
  actions: (Metric & { _id: string })[]; problems: (Metric & { _id: string })[]; history: ProviderMetric[]; providers: ProviderMetric[];
}
interface Batch { _id: string; name: string; controls?: { enabled: boolean; daily?: number; courseIds: string[]; startsAt?: string; endsAt?: string; startMinute?: number; endMinute?: number } }
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
      {Object.entries({ overview: 'Overview', student: 'Student AI configurations', staff: 'Staff AI configuration', usage: 'Usage analytics',
        'student-limits': 'Student limits', 'staff-limits': 'Staff limits', failover: 'Failover history', batches: 'Batch controls', education: 'Educational settings' }).map(([key, name]) =>
        <Button key={key} size="sm" variant={tab === key ? 'primary' : 'secondary'} aria-pressed={tab === key} onClick={() => setTab(key)}>{name}</Button>)}
    </div>
    {settings.data && !settings.data.encryptionReady && <Notice tone="warn">Railway credential encryption is missing or invalid. Provider requests are unavailable.</Notice>}
    {(settings.error || providers.error || usage.error) && <ErrorState message={settings.error ?? providers.error ?? usage.error!} retry={refresh} />}
    {tab === 'overview' && workloads.map((workload) => {
      const control = settings.data?.workloads.find((w) => w.workload === workload);
      const active = providers.data?.items.find((config) => config._id === control?.activeId);
      const serving = providers.data?.items.find((item) => item._id === control?.servingId && item.eligible) ?? active;
      const backups = (providers.data?.items ?? []).filter((item) => item.workload === workload && item.backup && item.eligible && !item.active)
        .sort((a, b) => a.priority - b.priority);
      const current = usage.data?.providers.find((row) => row._id === serving?._id);
      const metric = usage.data?.workloads.find((row) => row._id === workload);
      return <Card key={workload} title={label(workload)}
        description={control?.enabled ? active && settings.data?.encryptionReady ? `${active.name} · ${active.model}` : 'Configuration missing or unavailable' : 'Disabled'}>
        <p className="mb-3 text-sm text-fg-muted">{control?.mode === 'AUTO' ? 'Automatic failover' : 'Manual selection'} · Primary {active?.name ?? 'Unavailable'} ·
          Last serving {serving ? `${names[serving.provider]} · ${serving.model}` : 'Unavailable'}</p>
        <p className="mb-3 text-sm text-fg-muted">Backup priority: {backups.length
          ? backups.map((item) => `${item.name} (${names[item.provider]} · ${item.model})`).join(' → ') : 'None available'}.</p>
        {control?.budget && <p className="mb-3 text-sm text-fg-muted">Remaining workload budget today {num(Math.max(0, control.limits.requestsDay - control.budget.requests))} requests and {num(Math.max(0, control.limits.tokensDay - control.budget.tokens))} tokens.</p>}
        {current?.lastStatus === 'RATE_LIMITED' && <Notice tone="warn">The provider rate-limited the most recent request.</Notice>}
        {current?.lastStatus === 'FAILED' && <Notice tone="warn">The last provider request failed{current.lastFailure ? ` (${current.lastFailure})` : ''}. Check the configuration and observed quotas.</Notice>}
        {metric ? <Metrics row={metric} /> : <p className="text-sm text-fg-muted">No usage recorded today.</p>}
        {current && <Quota item={current} />}
      </Card>;
    })}
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

function Metrics({ row }: { row: Metric }) {
  const tokens = (value: number) => row.outbound > 0 && row.unknownTokens >= row.outbound ? 'Unavailable' : num(value);
  return <Grid>
    <StatCard label="Logical requests" value={num(row.requests)} />
    <StatCard label="Provider attempts" value={num(row.outbound)} />
    <StatCard label="Failover attempts" value={num(row.backupAttempts)} />
    <StatCard label="Known or estimated spend" value={row.knownCost ? `$${row.costUsd?.toFixed(4)}` : 'Unavailable'} />
    <StatCard label="Local responses" value={num(row.local)} />
    <StatCard label="Successful" value={num(row.success)} />
    <StatCard label="Failed" value={num(row.failed)} />
    <StatCard label="Rate-limited" value={num(row.rateLimited)} />
    <StatCard label="Reported input tokens" value={tokens(row.input)} />
    <StatCard label="Reported output tokens" value={tokens(row.output)} />
    <StatCard label="Reported total tokens" value={tokens(row.total)} hint={row.unknownTokens ? `${row.unknownTokens} attempts with unknown usage` : undefined} />
    <StatCard label="Average latency" value={row.averageLatency == null ? 'Unavailable' : `${Math.round(row.averageLatency)} ms`} />
    {row.uniqueUsers != null && <StatCard label="Unique users" value={num(row.uniqueUsers)} />}
    <StatCard label="Success rate" value={row.success + row.failed ? `${Math.round(row.success / (row.success + row.failed) * 100)}%` : 'Unavailable'} />
  </Grid>;
}
function Quota({ item }: { item: ProviderMetric }) {
  const values = Object.entries(item.quota ?? {});
  return <details className="mt-3 text-sm text-fg-muted">
    <summary className="cursor-pointer">Last observed provider quota · {values.length ? date(item.lastObserved) : 'Unavailable'}</summary>
    <dl className="mt-2 grid gap-1">
      {values.map(([header, value]) => <div key={header} className="flex flex-wrap gap-x-2"><dt>{header}</dt><dd>{value}</dd></div>)}
    </dl>
    <p>Provider-wide credits are unavailable unless reported. Application budgets are shown separately.</p>
  </details>;
}
function List({ rows }: { rows: (Metric & { name: string })[] }) {
  return rows.length ? <ul className="divide-y divide-line">{rows.map((row) => <li key={row.name} className="py-2 text-sm">
    <strong>{row.name}</strong> · {num(row.outbound)} sent · {num(row.local)} local · {num(row.success)} successful · {num(row.failed)} failed · {num(row.rateLimited)} rate-limited · {num(row.total)} reported tokens
  </li>)}</ul> : <p className="text-sm text-fg-muted">No matching activity.</p>;
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
  async function action(path: string, method = 'POST', body?: unknown) {
    setBusy(true);
    try { await api(`${base}/providers${path}`, { method, body }); toast.success('Configuration updated'); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { await refresh(); setBusy(false); }
  }
  return <div className="space-y-3">
    {controls && <Switching key={JSON.stringify([controls.mode, controls.recovery, controls.maxBackups, controls.paidAllowed])} settings={controls} refresh={refresh} />}
    <Card title={`${label(workload)} configurations`} description="Use authorized provider accounts. Give credentials sharing an underlying quota the same quota group."
      actions={<Button disabled={!encryption || busy || items.filter((entry) => entry.workload === workload).length >= 10} onClick={() => setEdit('new')}>Add configuration</Button>}>
      <Button variant="secondary" disabled={busy} onClick={() => void action(`/deactivate/${workload}`)}>Deactivate all</Button>
    </Card>
    {items.filter((item) => item.workload === workload).map((item) => {
      const history = usage?.history.find((row) => row._id === item._id);
      const today = usage?.providers.find((row) => row._id === item._id);
      return <Card title={item.name} key={item._id}
        description={`${item.active ? 'Primary' : item.backup ? 'Backup' : 'Inactive'} · ${names[item.provider]} · ${item.model} · ${item.masked} · ${item.plan}`}>
        <p className="text-sm text-fg-muted">{item.enabled ? item.eligible ? 'Enabled · Eligible' : 'Enabled · Ineligible' : 'Disabled'} · Priority {item.priority} · Quota group {item.quotaGroup} ({item.quotaScope.toLowerCase()}) ·
          Version {item.version} · Connection {item.lastTest ? `${item.lastTest.status} (${item.lastTest.latency} ms)` : 'Untested'}</p>
        {item.circuitUntil && <p className="text-sm text-fg-muted">Recovery probe eligible after {date(item.circuitUntil)}</p>}
        {history && <>
          <p className="my-2 text-sm">Lifetime {num(history.outbound)} sent · Today {num(today?.outbound)} sent · {num(history.success)} successful · {num(history.failed)} failed · {num(history.rateLimited)} rate-limited</p>
          <p className="text-sm">{num(history.input)} input · {num(history.output)} output · {num(history.total)} reported total · {num(history.unknownTokens)} with unknown usage</p>
          <p className="text-sm text-fg-muted">{history.averageLatency != null && `Average ${Math.round(history.averageLatency)} ms · `}Last success {date(history.lastSuccess)} · Last failure {date(history.lastFailureAt)} · Last observed {date(history.lastObserved)}</p>
          <p className="text-sm text-fg-muted">Known or estimated spend {history.knownCost ? `$${history.costUsd?.toFixed(4)}` : 'Unavailable'}</p>
          <Quota item={history} />
        </>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEdit(item)}>Edit configuration</Button>
          <Button size="sm" variant="secondary" disabled={busy || !encryption || (item.plan === 'PAID' && (!item.paidApproved || !controls?.paidAllowed))}
            onClick={() => void action(`/${item._id}/test`)}>Test connection</Button>
          {!item.active || controls?.servingId !== item._id ? <Button size="sm" disabled={busy || !encryption || !item.eligible}
            onClick={() => void action(`/${item._id}/activate`)}>{item.active ? 'Restore primary' : 'Activate'}</Button> : null}
          {item.active && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(`/deactivate/${workload}`)}>Deactivate</Button>}
          <Button size="sm" variant="secondary" onClick={() => setBudget(budget === item._id ? undefined : item._id)}>{budget === item._id ? 'Hide budget' : 'View application budget'}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void confirm({ title: 'Archive this configuration?', body: 'The stored credential is removed. Usage history remains available.', confirmLabel: 'Archive', danger: true })
            .then((ok) => { if (ok) void action(`/${item._id}`, 'DELETE'); })}>Archive</Button>
        </div>
        {budget === item._id && <ProviderBudget id={item._id} spending={item.spending?.dailyUsd} />}
      </Card>;
    })}
    {edit && <ProviderForm key={edit === 'new' ? 'new' : edit._id} workload={workload} current={edit === 'new' ? undefined : edit}
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

function ProviderForm({ workload, current, providerOptions, endpoints, close, refresh }: {
  workload: Workload; current?: Config; providerOptions: string[]; endpoints: string[]; close: () => void; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState(current?.provider ?? 'GROQ');
  const [plan, setPlan] = useState(current?.plan ?? 'FREE');
  const [model, setModel] = useState(current?.model ?? '');
  const [models, setModels] = useState<{ id: string; inputLimit?: number; outputLimit?: number }[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const toast = useToast();
  const discovered = models.find((entry) => entry.id === model);
  async function discover() {
    if (!current) return;
    setDiscovering(true);
    try {
      const result = await api<{ items: typeof models }>(`${base}/providers/${current._id}/models`, { method: 'POST' });
      setModels(result.items);
      if (!result.items.length) toast.info('No models were returned by this provider.');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setDiscovering(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const test = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'test';
    const form = new FormData(event.currentTarget);
    const { name, apiKey, organization, project, quotaGroup, quotaScope } = Object.fromEntries(form);
    const limits = Object.fromEntries(providerFields.filter((field) => form.get(field)).map((field) => [field, Number(form.get(field))]));
    const number = (field: string) => form.get(field) ? Number(form.get(field)) : null;
    const configuredSpend = number('dailyUsd');
    const spending = configuredSpend === null ? null : { dailyUsd: configuredSpend,
      inputPerMillion: number('inputPerMillion') ?? 0, outputPerMillion: number('outputPerMillion') ?? 0 };
    setBusy(true);
    try {
      const saved = await api<{ _id: string }>(`${base}/providers${current ? `/${current._id}` : ''}`, { method: current ? 'PATCH' : 'POST',
        body: { name, provider, model, ...(apiKey ? { apiKey } : {}), organization, project, quotaGroup, quotaScope, plan, limits,
          enabled: form.has('enabled'), backup: form.has('backup'), independent: form.has('independent'), paidApproved: form.has('paidApproved'),
          priority: number('priority'), timeoutMs: number('timeoutMs'), inputLimit: number('inputLimit'), outputLimit: number('outputLimit'), spending,
          endpoint: provider === 'CUSTOM' ? form.get('endpoint') : null, outputMode: ['CUSTOM', 'ANTHROPIC'].includes(provider) ? form.get('outputMode') : null, ...(current ? {} : { workload }) } });
      close();
      if (test) await api(`${base}/providers/${saved._id}/test`, { method: 'POST' });
      toast.success(test ? 'Configuration saved and tested' : 'Configuration saved');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { await refresh(); setBusy(false); }
  }
  return <Card title={current ? 'Edit provider configuration' : 'Add provider configuration'}>
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" label="Display name" defaultValue={current?.name} required maxLength={80} />
        <Select label="Provider" value={provider} onChange={(event) => { setProvider(event.target.value); setModel(''); setModels([]); }}
          options={providerOptions.map((key) => ({ value: key, label: names[key] ?? key }))} />
        <Input name="model" label="Model ID" value={model} onChange={(event) => setModel(event.target.value)} list={models.length ? 'provider-models' : undefined} required maxLength={160} />
        {models.length > 0 && <datalist id="provider-models">{models.map((entry) => <option key={entry.id} value={entry.id} />)}</datalist>}
        {current && current.provider === provider && <Button variant="secondary" loading={discovering} onClick={() => void discover()}>Discover saved provider models</Button>}
        {discovered && <p className="text-sm text-fg-muted">Published input limit {discovered.inputLimit ?? 'Unavailable'} · Output limit {discovered.outputLimit ?? 'Unavailable'}</p>}
        {provider === 'CUSTOM' && <>
          <Select name="endpoint" label="Approved API base URL" defaultValue={current?.endpoint ?? endpoints[0]} required
            options={endpoints.map((value) => ({ value, label: value }))} />
        </>}
        {['CUSTOM', 'ANTHROPIC'].includes(provider) && <Select name="outputMode" label="Output capability" defaultValue={current?.outputMode ?? 'JSON_OBJECT'}
          options={[{ value: 'JSON_OBJECT', label: provider === 'ANTHROPIC' ? 'Native JSON schema' : 'Native JSON object mode' },
            { value: 'PROMPT_JSON', label: 'Prompted JSON with validation' }]} />}
        <Input name="quotaGroup" label="Shared quota group" defaultValue={current?.quotaGroup} required maxLength={50} />
        <Select name="quotaScope" label="Confirmed quota scope" defaultValue={current?.quotaScope ?? 'UNKNOWN'}
          options={['UNKNOWN', 'ORGANIZATION', 'PROJECT', 'MODEL', 'ACCOUNT'].map((value) => ({ value, label: value.toLowerCase() }))} />
        <Select name="plan" label="Plan" value={plan} onChange={(event) => setPlan(event.target.value)}
          options={[{ value: 'FREE', label: 'Free' }, { value: 'PAID', label: 'Paid' }]} />
        <Input name="organization" label="Organization label" defaultValue={current?.organization} maxLength={80} />
        <Input name="project" label="Project label" defaultValue={current?.project} maxLength={80} />
        <Input name="apiKey" type="password" autoComplete="new-password" label={current ? 'Replacement API key (optional)' : 'API key'} required={!current || current.provider !== provider} />
        <Input name="priority" label="Backup priority" type="number" min={1} max={100} defaultValue={current?.priority ?? 100} required />
        <Input name="timeoutMs" label="Timeout (milliseconds)" type="number" min={1000} max={25000} defaultValue={current?.timeoutMs ?? 12000} required />
        <Input name="inputLimit" label="Model input limit (optional)" type="number" min={100} defaultValue={current?.inputLimit} />
        <Input name="outputLimit" label="Model output limit (optional)" type="number" min={64} defaultValue={current?.outputLimit} />
        {providerFields.map((field) => <Input key={field} name={field} label={limitLabels[field].replace('Workload', 'Configuration')} type="number" min={1} defaultValue={current?.limits?.[field]} />)}
      </div>
      <Checkbox name="enabled" label="Enable configuration" defaultChecked={current?.enabled ?? true} />
      <Checkbox name="backup" label="Allow as a backup for this workload" defaultChecked={current?.backup} />
      <Checkbox name="independent" label="I verified independent quota and authorization for automatic switching" defaultChecked={current?.independent} />
      {plan === 'PAID' && <Checkbox name="paidApproved" label="Approve this configuration for paid use" defaultChecked={current?.paidApproved} />}
      <details><summary className="cursor-pointer font-medium">Optional application spending estimate</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <Input name="dailyUsd" label="Estimated daily USD cap" type="number" min={0.01} step="any" defaultValue={current?.spending?.dailyUsd} />
          <Input name="inputPerMillion" label="USD per million input tokens" type="number" min={0} step="any" defaultValue={current?.spending?.inputPerMillion} />
          <Input name="outputPerMillion" label="USD per million output tokens" type="number" min={0} step="any" defaultValue={current?.spending?.outputPerMillion} />
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>Save configuration</Button>
        <Button type="submit" value="test" variant="secondary" disabled={busy}>Save and test connection</Button>
        <Button variant="ghost" onClick={close}>Cancel</Button>
      </div>
    </form>
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
        enabled: !!f.get('enabled'), daily: text('daily') ? Number(text('daily')) : null, courseIds: text('courseIds').split(/[\s,]+/).filter(Boolean),
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
    <Checkbox name="enabled" label="Enable student assistance for this batch" defaultChecked={c?.enabled} />
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
