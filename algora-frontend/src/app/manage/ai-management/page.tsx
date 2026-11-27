'use client';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, DescriptionList, ErrorState, Grid, InlineSelect, Input, Menu, Notice, PageHeader, SearchInput, Select, StatCard, StatusBadge, Tabs, useConfirm, useToast } from '@/components/ui';
import { ProviderConfigForm, type ProviderConfig as Config } from '@/components/ai/ProviderConfigForm';
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
    <Tabs active={tab} onChange={setTab} tabs={[
      { key: 'overview', label: 'Overview' },
      { key: 'student', label: 'Student AI' },
      { key: 'staff', label: 'Staff AI' },
      { key: 'usage', label: 'Usage analytics' },
      { key: 'student-limits', label: 'Student settings' },
      { key: 'staff-limits', label: 'Staff settings' },
      { key: 'batches', label: 'Batch controls' },
      { key: 'education', label: 'Educational settings' },
      { key: 'failover', label: 'Failover history' },
    ]} />
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
      <Card title="Usage filters" flush>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(draft); }}>
          <div className="grid gap-3 border-b border-line px-4 py-3 md:grid-cols-2 lg:grid-cols-4">{filterKeys.map((key) => key === 'workload' || key === 'role' || key === 'provider' ? (
            <Select key={key} label={filters[key]} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              options={[{ value: '', label: 'All' }, ...(key === 'workload' ? workloads : key === 'provider' ? Object.keys(names) : ['STUDENT', 'TRAINER', 'SUPER_ADMIN']).map((value) => ({ value, label: value }))]} />
          ) : <Input key={key} label={filters[key]} type={key === 'from' || key === 'to' ? 'date' : 'text'}
            value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />)}</div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button type="submit">Apply filters</Button>
            {['csv', 'xlsx'].map((format) => <Button key={format} variant="secondary"
              onClick={() => void download(`${base}/usage/export${qs({ ...query, format })}`).catch((e) => toast.error(errorMessage(e)))}>Export {format.toUpperCase()}</Button>)}
          </div>
        </form>
      </Card>
      <Card title="Daily usage" description="Algora-observed activity. Token totals include reported usage only and can differ from organization-wide usage." flush>
        <DataTable caption="Daily AI usage" rows={(usage.data?.daily ?? []).slice(-14)} rowKey={(row) => `${row._id.day}:${row._id.workload}`} columns={[
          { key: 'day', header: 'Day', cell: (row) => row._id.day },
          { key: 'workload', header: 'Workload', cell: (row) => label(row._id.workload) },
          { key: 'outbound', header: 'Provider attempts', align: 'right', cell: (row) => num(row.outbound) },
          { key: 'success', header: 'Successful', align: 'right', cell: (row) => num(row.success) },
          { key: 'failed', header: 'Failed', align: 'right', cell: (row) => num(row.failed) },
          { key: 'tokens', header: 'Reported tokens', align: 'right', cell: (row) => row.unknownTokens === row.outbound && row.outbound ? 'Unavailable' : num(row.total) },
        ]} />
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

function Providers({ workload, items, usage, refresh, encryption, controls, providerOptions, endpoints }: {
  workload: Workload; items: Config[]; usage?: Usage | null; refresh: () => Promise<void>; encryption: boolean;
  controls?: Settings; providerOptions: string[]; endpoints: string[];
}) {
  const [edit, setEdit] = useState<Config | 'new' | null>(null);
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
    <Card title="Saved API keys" description="Connection tests and usage are shown separately from actual teaching or mentoring activity." flush>
      <DataTable caption={`${label(workload)} API key configurations`} rows={saved} rowKey={(item) => item._id}
        empty={<div className="p-5"><Notice tone="info">No API key is configured for this workload.</Notice></div>}
        columns={[
          { key: 'name', header: 'Configuration', cell: (item) => <div className="max-w-56 whitespace-normal"><p className="font-medium text-fg">{item.name}</p><p className="text-xs text-fg-muted">{item.masked}</p></div> },
          { key: 'model', header: 'Model', cell: (item) => <code className="text-xs">{item.model}</code> },
          { key: 'role', header: 'Role', cell: (item) => <StatusBadge status={item.active ? 'ACTIVE' : item.backup ? 'BACKUP' : 'INACTIVE'} label={item.active ? 'Primary' : item.backup ? 'Backup' : 'Inactive'} /> },
          { key: 'connection', header: 'Connection', cell: (item) => item.lastTest ? <StatusBadge status={item.lastTest.status} label={`${item.lastTest.status} · ${item.lastTest.latency} ms`} /> : <Badge>Untested</Badge> },
          { key: 'enabled', header: 'Enabled', cell: (item) => <StatusBadge status={item.enabled ? 'ACTIVE' : 'INACTIVE'} /> },
          { key: 'usage', header: 'Usage', cell: (item) => <span className="text-xs text-fg-muted">{num(usage?.providers.find((row) => row._id === item._id)?.outbound)} requests · {num(item.budget?.day.tokens)} tokens</span> },
          { key: 'actions', header: 'Actions', align: 'right', cell: (item) => <div className="flex justify-end">
            <Menu label={`Actions for ${item.name}`} button={<span>Actions</span>} items={[
              { label: 'Edit configuration', onSelect: () => setEdit(item) },
              { label: 'Test connection', disabled: busy || !encryption, onSelect: () => void action(`/${item._id}/test`, 'POST', undefined, 'Connection tested') },
              ...(!item.active || controls?.servingId !== item._id ? [{ label: item.active ? 'Restore primary' : 'Activate', disabled: busy || !encryption || !item.eligible, onSelect: () => void action(`/${item._id}/activate`, 'POST', undefined, 'Primary configuration activated') }] : []),
              { label: item.enabled ? 'Disable' : 'Enable', disabled: busy, onSelect: () => void action(`/${item._id}`, 'PATCH', { enabled: !item.enabled }, item.enabled ? 'Configuration disabled' : 'Configuration enabled') },
              { label: 'Replace API key', onSelect: () => setEdit(item) },
              'separator',
              { label: 'Archive', danger: true, disabled: busy, onSelect: () => void confirm({ title: 'Archive this configuration?', body: 'The stored credential is removed. Usage history remains available.', confirmLabel: 'Archive', danger: true }).then((ok) => { if (ok) void action(`/${item._id}`, 'DELETE', undefined, 'Configuration archived'); }) },
            ]} />
          </div> },
        ]} />
    </Card>
    {edit && <ProviderConfigForm key={edit === 'new' ? 'new' : edit._id} workload={workload} current={edit === 'new' ? undefined : edit}
      providerOptions={providerOptions} endpoints={endpoints} close={() => setEdit(null)} refresh={refresh} />}
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
  const [query, setQuery] = useState('');
  const [policy, setPolicy] = useState('');
  const batch = data.data?.items.find((item) => item._id === id);
  const filtered = (data.data?.items ?? []).filter((item) => {
    const matchesName = item.name.toLowerCase().includes(query.trim().toLowerCase());
    const matchesPolicy = !policy || (policy === 'inherit' ? item.controls?.enabled === undefined : policy === 'enable' ? item.controls?.enabled === true : item.controls?.enabled === false);
    return matchesName && matchesPolicy;
  });
  return <div className="space-y-4">
    <Card title="Batch AI controls" description="Most batches should inherit global Student AI. Use an override only for an explicit exception." flush>
      {data.error ? <ErrorState message={data.error} retry={data.reload} /> : <>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search batches" label="Search batches" />
          <InlineSelect label="AI policy" value={policy} onChange={setPolicy} options={[
            { value: '', label: 'All policies' }, { value: 'inherit', label: 'Inherit global' }, { value: 'enable', label: 'Explicitly enabled' }, { value: 'disable', label: 'Explicitly disabled' },
          ]} />
        </div>
        <DataTable caption="Batch AI policies" rows={filtered} rowKey={(item) => item._id}
          columns={[
            { key: 'batch', header: 'Batch', cell: (item) => <button type="button" onClick={() => setId(item._id)} className="text-left font-medium text-accent-fg hover:underline">{item.name}</button> },
            { key: 'policy', header: 'AI policy', cell: (item) => <StatusBadge status={item.controls?.enabled === true ? 'ACTIVE' : item.controls?.enabled === false ? 'INACTIVE' : 'INHERITED'} label={item.controls?.enabled === true ? 'Explicitly enabled' : item.controls?.enabled === false ? 'Explicitly disabled' : 'Inherits global'} /> },
            { key: 'schedule', header: 'Schedule', cell: (item) => item.controls?.startMinute == null && item.controls?.endMinute == null ? 'No AI-specific schedule' : 'Configured' },
            { key: 'action', header: 'Action', align: 'right', cell: (item) => <Button size="xs" variant="secondary" onClick={() => setId(item._id)}>Manage</Button> },
          ]} />
      </>}
    </Card>
    {batch && <Card title={batch.name} description="Optional batch-level exception and AI-specific schedule."><BatchForm key={batch._id} batch={batch} refresh={data.reload} /></Card>}
  </div>;
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
