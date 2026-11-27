'use client';
import { useState, type FormEvent } from 'react';
import { Button, Card, Checkbox, Field, Input, Notice, Select, controlCls, cx, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { defaultQuotaGroup, providerLabel, providerMeta } from './providerMeta';

const base = '/ai/management';
export const providerFields = ['requestsDay', 'requestsMinute', 'tokensDay', 'tokensMinute'] as const;
const providerFieldLabels: Record<(typeof providerFields)[number], string> = {
  requestsDay: 'Configuration requests per day',
  requestsMinute: 'Configuration requests per minute',
  tokensDay: 'Configuration tokens per day',
  tokensMinute: 'Configuration tokens per minute',
};

export type Workload = 'STUDENT_MENTOR' | 'STAFF_PREPARATION';
export interface ProviderBudgetView {
  configured: Record<string, number>;
  day: { requests: number; tokens: number; estimatedUsd: number };
  minute: { requests: number; tokens: number };
  quotaCooldownUntil?: string;
}
export interface ProviderConfig {
  _id: string; workload: Workload; name: string; model: string; organization?: string; project?: string; quotaGroup: string;
  masked: string; plan: string; version: number; active: boolean; limits?: Record<string, number>;
  lastTest?: { status: string; latency: number; at?: string; version?: number; quota?: Record<string, string> };
  provider: string; endpoint?: string; eligible: boolean; enabled: boolean; backup: boolean; independent: boolean;
  priority: number; quotaScope: string; paidApproved: boolean; outputMode?: string; timeoutMs: number;
  inputLimit?: number; outputLimit?: number; spending?: { dailyUsd: number; inputPerMillion: number; outputPerMillion: number };
  circuitUntil?: string; budget?: ProviderBudgetView;
}
interface DiscoveredModel { id: string; inputLimit?: number; outputLimit?: number }

/** Password-style input with an explicit show/hide control. The value is only ever kept in component state. */
function SecretInput({ label, value, onChange, required, hint }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return <Field label={label} hint={hint}>
    {(id, describedBy) => <div className="relative">
      <input id={id} name="apiKey" type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)}
        required={required} minLength={8} maxLength={512} autoComplete="new-password" spellCheck={false} autoCapitalize="off" autoCorrect="off"
        aria-describedby={describedBy} placeholder="Paste the provider API key"
        className={cx(controlCls, 'pr-16 font-mono text-[13px]')} />
      <button type="button" onClick={() => setShow((current) => !current)} aria-label={show ? 'Hide API key' : 'Show API key'}
        className="absolute inset-y-0 right-1 my-auto h-7 rounded px-2 text-xs font-medium text-fg-muted hover:bg-hover hover:text-fg">
        {show ? 'Hide' : 'Show'}
      </button>
    </div>}
  </Field>;
}

/**
 * Shared simplified configuration form for STUDENT_MENTOR and STAFF_PREPARATION.
 * Basic fields are visible; every technical field stays mounted inside Advanced settings so
 * collapsing the section never resets or drops an existing value.
 */
export function ProviderConfigForm({ workload, current, providerOptions, endpoints, close, refresh }: {
  workload: Workload; current?: ProviderConfig; providerOptions: string[]; endpoints: string[]; close: () => void; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(current?.name ?? '');
  const [provider, setProvider] = useState(current?.provider ?? 'GROQ');
  const [model, setModel] = useState(current?.model ?? '');
  const [inputLimit, setInputLimit] = useState(current?.inputLimit?.toString() ?? '');
  const [outputLimit, setOutputLimit] = useState(current?.outputLimit?.toString() ?? '');
  const [plan, setPlan] = useState(current?.plan ?? 'FREE');
  const [endpoint, setEndpoint] = useState(current?.endpoint ?? endpoints[0] ?? '');
  const initialGroup = defaultQuotaGroup(workload, current?.provider ?? 'GROQ', current?.endpoint ?? endpoints[0]);
  const [quotaGroup, setQuotaGroup] = useState(current?.quotaGroup ?? initialGroup);
  // Keep following the provider default until an administrator explicitly edits the group.
  const [quotaTouched, setQuotaTouched] = useState(!!current && current.quotaGroup !== initialGroup);
  const [apiKey, setApiKey] = useState('');
  const [replaceKey, setReplaceKey] = useState(!current);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryNote, setDiscoveryNote] = useState<string>();
  const toast = useToast();
  const meta = providerMeta[provider];
  const identityChanged = !!current && (current.provider !== provider || (provider === 'CUSTOM' && (current.endpoint ?? '') !== endpoint));
  const showKey = !current || replaceKey || identityChanged;
  const canDiscover = !!apiKey.trim() || (!!current && !identityChanged);

  function changeProvider(next: string) {
    setProvider(next);
    setModel('');
    setModels([]);
    setDiscoveryNote(undefined);
    const nextEndpoint = next === 'CUSTOM' ? (endpoints.includes(endpoint) ? endpoint : endpoints[0] ?? '') : undefined;
    if (nextEndpoint !== undefined) setEndpoint(nextEndpoint);
    if (!quotaTouched) setQuotaGroup(defaultQuotaGroup(workload, next, nextEndpoint));
  }

  function changeEndpoint(next: string) {
    setEndpoint(next);
    if (!quotaTouched) setQuotaGroup(defaultQuotaGroup(workload, 'CUSTOM', next));
  }

  function pickModel(entry: DiscoveredModel) {
    setModel(entry.id);
    setInputLimit(entry.inputLimit ? String(entry.inputLimit) : '');
    setOutputLimit(entry.outputLimit ? String(entry.outputLimit) : '');
  }

  function modelNote(entry: DiscoveredModel) {
    const limits = [entry.inputLimit ? `input ${entry.inputLimit.toLocaleString()}` : '', entry.outputLimit ? `output ${entry.outputLimit.toLocaleString()}` : '']
      .filter(Boolean).join(' · ');
    const pricing = provider === 'OPENROUTER' && plan === 'FREE'
      ? (entry.id.endsWith(':free') ? 'Free suffix (:free)' : 'Paid or unknown — not eligible while Plan is Free')
      : 'Pricing and entitlement unverified';
    return [limits, pricing].filter(Boolean).join(' · ');
  }

  async function discover() {
    const key = apiKey.trim();
    if (!key && (!current || identityChanged)) {
      toast.info('Enter an API key before discovering models.');
      return;
    }
    setDiscovering(true);
    setDiscoveryNote(undefined);
    try {
      const result = await api<{ items: DiscoveredModel[] }>(`${base}/providers/discover`, { method: 'POST', body: {
        provider,
        ...(provider === 'CUSTOM' ? { endpoint } : {}),
        ...(key ? { apiKey: key } : {}),
        ...(current && !key && !identityChanged ? { configId: current._id } : {}),
      } });
      setModels(result.items);
      setDiscoveryNote(result.items.length
        ? `Found ${result.items.length} models. Algora does not verify pricing or entitlement.`
        : 'The provider returned no models. Enter the model ID manually.');
      if (!result.items.length) toast.info('No models were returned. Enter the model ID manually.');
    } catch (error) {
      setModels([]);
      toast.error(errorMessage(error));
    } finally { setDiscovering(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const test = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'test';
    const form = new FormData(event.currentTarget);
    const text = (field: string) => String(form.get(field) ?? '').trim();
    const number = (field: string) => text(field) ? Number(text(field)) : null;
    const limits = Object.fromEntries(providerFields.filter((field) => text(field)).map((field) => [field, Number(text(field))]));
    const dailyUsd = number('dailyUsd');
    const inputPerMillion = number('inputPerMillion') ?? 0;
    const outputPerMillion = number('outputPerMillion') ?? 0;
    if (dailyUsd !== null && inputPerMillion === 0 && outputPerMillion === 0) {
      toast.error('Add at least one per-million rate when you set a daily spending cap.');
      return;
    }
    const spending = dailyUsd === null ? null : { dailyUsd, inputPerMillion, outputPerMillion };
    const cleanKey = apiKey.trim();
    setBusy(true);
    try {
      const saved = await api<{ _id: string }>(`${base}/providers${current ? `/${current._id}` : ''}`, { method: current ? 'PATCH' : 'POST',
        body: {
          name: name.trim(), provider, model: model.trim(), plan, quotaGroup,
          ...(cleanKey ? { apiKey: cleanKey } : {}),
          organization: text('organization'), project: text('project'), quotaScope: text('quotaScope') || 'UNKNOWN',
          enabled: form.has('enabled'), backup: form.has('backup'), independent: form.has('independent'), paidApproved: form.has('paidApproved'),
          priority: number('priority') ?? 100, timeoutMs: number('timeoutMs') ?? 12000,
          inputLimit: number('inputLimit'), outputLimit: number('outputLimit'), limits, spending,
          endpoint: provider === 'CUSTOM' ? endpoint : null,
          outputMode: ['CUSTOM', 'ANTHROPIC'].includes(provider) ? (text('outputMode') || 'JSON_OBJECT') : null,
          ...(current ? {} : { workload }),
        } });
      close();
      if (test) await api(`${base}/providers/${saved._id}/test`, { method: 'POST' });
      toast.success(test ? 'Configuration saved and connection tested' : 'Configuration saved');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { await refresh(); setBusy(false); }
  }

  return <Card title={current ? `Edit ${providerLabel(current.provider)} configuration` : 'Add provider configuration'}
    description={`${workload === 'STUDENT_MENTOR' ? 'Student AI' : 'Staff AI'} · credentials are encrypted and never returned to the browser.`}>
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" label="Display name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80}
          hint="A short name, for example Groq Key 1." />
        <Select label="Provider" value={provider} onChange={(event) => changeProvider(event.target.value)}
          options={providerOptions.map((key) => ({ value: key, label: providerLabel(key) }))}
          hint={meta?.note} />
        {showKey ? <SecretInput label={current ? 'Replacement API key' : 'API key'} value={apiKey} onChange={setApiKey}
          required={!current || identityChanged} hint={identityChanged
            ? 'Changing the provider or endpoint requires a new API key. The stored credential is never shown.'
            : 'Stored encrypted. Existing keys are kept unless you replace them.'} />
          : <div className="space-y-1.5 text-sm">
            <p className="font-medium text-fg">API key</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-subtle px-2 py-1 font-mono text-xs text-fg">{current?.masked}</code>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReplaceKey(true)}>Replace API key</Button>
            </div>
            <p className="text-xs text-fg-subtle">The existing encrypted credential is preserved unless replaced.</p>
          </div>}
        <div className="space-y-1.5">
          <Input name="model" label="Model ID" value={model} onChange={(event) => setModel(event.target.value)}
            list={models.length ? 'provider-models' : undefined} required maxLength={160} placeholder={meta?.modelPlaceholder}
            hint="Use a discovered model or paste the provider model identifier." />
          {models.length > 0 && <datalist id="provider-models">{models.map((entry) => <option key={entry.id} value={entry.id} />)}</datalist>}
          {models.find((entry) => entry.id === model) && <p className="text-xs text-fg-subtle">{modelNote(models.find((entry) => entry.id === model)!)}</p>}
        </div>
        {provider === 'CUSTOM' && <Select label="Approved API base URL" value={endpoint} required
          onChange={(event) => changeEndpoint(event.target.value)}
          options={endpoints.map((value) => ({ value, label: value }))}
          hint="Only pre-approved OpenAI-compatible endpoints are allowed." />}
        <Select name="plan" label="Plan" value={plan} onChange={(event) => setPlan(event.target.value)}
          options={[{ value: 'FREE', label: 'Free' }, { value: 'PAID', label: 'Paid' }]}
          hint="Free is the default. Algora cannot verify provider billing." />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" loading={discovering} disabled={busy || !canDiscover} onClick={() => void discover()}>Discover models</Button>
        {meta?.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent-fg underline">
          Open {providerLabel(provider)} key console
        </a>}
        {!canDiscover && <span className="text-xs text-fg-subtle">Enter an API key, or save this configuration first, to discover models.</span>}
      </div>
      {discoveryNote && <p className="text-xs text-fg-muted">{discoveryNote}</p>}
      {models.length > 0 && <details className="rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">Discovered models ({models.length})</summary>
        <ul className="max-h-64 divide-y divide-line overflow-auto border-t border-line">
          {models.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <code className="break-all text-xs text-fg">{entry.id}</code>
              <p className="text-[11px] text-fg-subtle">{modelNote(entry)}</p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => pickModel(entry)}>Use</Button>
          </li>)}
        </ul>
      </details>}

      <Checkbox name="enabled" label="Enable configuration" defaultChecked={current?.enabled ?? true}
        description="Disabled configurations are kept but never used for requests." />
      {!current && <Notice tone="info">The configuration is saved as a draft. Test it, then activate it explicitly.</Notice>}
      {plan === 'PAID' && <Notice tone="warn">Paid usage requires approval on this configuration and a workload policy that allows paid providers.</Notice>}

      <details className="rounded-xl border border-line bg-subtle">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg">
          Advanced settings <span className="ml-2 text-xs font-normal text-fg-subtle">Quota, routing, limits and spending</span>
        </summary>
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-xs text-fg-muted">Safe defaults are already applied. Change these only when you understand the provider quota and routing rules.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="quotaGroup" label="Shared quota group" value={quotaGroup} maxLength={50} required
              onChange={(event) => { setQuotaGroup(event.target.value); setQuotaTouched(true); }}
              hint="Configurations with the same label share one provider-level allowance. The default is scoped to this workload; reuse a label across workloads only for one shared account." />
            <Select name="quotaScope" label="Confirmed quota scope" defaultValue={current?.quotaScope ?? 'UNKNOWN'}
              options={['UNKNOWN', 'ORGANIZATION', 'PROJECT', 'MODEL', 'ACCOUNT'].map((value) => ({ value, label: value.toLowerCase() }))}
              hint="Unknown keeps a conservative shared ceiling until you verify the scope." />
            <Input name="organization" label="Organization label (optional)" defaultValue={current?.organization} maxLength={80}
              hint="Administrator-only label; never sent to the provider." />
            <Input name="project" label="Project label (optional)" defaultValue={current?.project} maxLength={80} />
            <Input name="priority" label="Backup priority" type="number" min={1} max={100} required defaultValue={current?.priority ?? 100}
              hint="Determines which eligible backup configuration is considered first. Lower numbers run first." />
            <Input name="timeoutMs" label="Request timeout (milliseconds)" type="number" min={1000} max={25000} required
              defaultValue={current?.timeoutMs ?? 12000} hint="Maximum waiting time for a provider response." />
            <Input name="inputLimit" label="Model input limit (optional)" type="number" min={100} max={10000000}
              value={inputLimit} onChange={(event) => setInputLimit(event.target.value)}
              hint="Provider-published context limit. Selecting a discovered model fills this when the provider reports it." />
            <Input name="outputLimit" label="Model output limit (optional)" type="number" min={64} max={1000000}
              value={outputLimit} onChange={(event) => setOutputLimit(event.target.value)}
              hint="Provider-published output limit. Selecting a discovered model fills this when the provider reports it." />
          </div>
          <div>
            <p className="text-sm font-medium text-fg">Configuration budgets</p>
            <p className="text-xs text-fg-subtle">Optional caps for this configuration only. Missing values inherit the workload budget and are never treated as unlimited.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {providerFields.map((field) => <Input key={field} name={field} label={providerFieldLabels[field]} type="number" min={1}
                defaultValue={current?.limits?.[field]} />)}
            </div>
          </div>
          <div className="grid gap-2">
            <Checkbox name="backup" label="Allow as a backup for this workload" defaultChecked={current?.backup}
              description="Automatic failover also requires independent quota verification plus a different provider family and quota group." />
            <Checkbox name="independent" label="I verified independent quota and authorization for automatic switching"
              defaultChecked={current?.independent} />
            {plan === 'PAID' && <Checkbox name="paidApproved" label="Approve this configuration for paid use"
              defaultChecked={current?.paidApproved} description="The workload paid policy must also allow paid providers." />}
          </div>
          {['CUSTOM', 'ANTHROPIC'].includes(provider) && <Select name="outputMode" label="Output capability"
            defaultValue={current?.outputMode ?? 'JSON_OBJECT'}
            options={[{ value: 'JSON_OBJECT', label: provider === 'ANTHROPIC' ? 'Native JSON schema' : 'Native JSON object mode' },
              { value: 'PROMPT_JSON', label: 'Prompted JSON with validation' }]}
            hint="The backend still validates every response with its own schema." />}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-fg">Optional spending estimate</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Input name="dailyUsd" label="Estimated daily USD cap" type="number" min={0.01} step="any" defaultValue={current?.spending?.dailyUsd} />
              <Input name="inputPerMillion" label="USD per million input tokens" type="number" min={0} step="any" defaultValue={current?.spending?.inputPerMillion} />
              <Input name="outputPerMillion" label="USD per million output tokens" type="number" min={0} step="any" defaultValue={current?.spending?.outputPerMillion} />
            </div>
            <p className="mt-1 text-xs text-fg-subtle">Provide a daily cap and at least one per-million rate. Algora uses this only to estimate spend; it does not purchase credits.</p>
          </details>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>Save configuration</Button>
        <Button type="submit" value="test" variant="secondary" disabled={busy}>Save and test connection</Button>
        <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
      </div>
    </form>
  </Card>;
}
