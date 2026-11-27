'use client';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Card, Checkbox, Field, Input, Notice, Select, controlCls, cx, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { defaultQuotaGroup } from './providerMeta';

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
  void providerOptions;
  void endpoints;
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [savedId, setSavedId] = useState(current?._id);
  const groqModel = workload === 'STUDENT_MENTOR' ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b';
  const [name, setName] = useState(current?.name ?? '');
  const [inputLimit, setInputLimit] = useState(current?.inputLimit?.toString() ?? '');
  const [outputLimit, setOutputLimit] = useState(current?.outputLimit?.toString() ?? '');
  const [plan, setPlan] = useState(current?.plan ?? 'FREE');
  const initialGroup = defaultQuotaGroup(workload, 'GROQ');
  const [quotaGroup, setQuotaGroup] = useState(current?.quotaGroup ?? initialGroup);
  // Keep following the provider default until an administrator explicitly edits the group.
  const [apiKey, setApiKey] = useState('');
  const [replaceKey, setReplaceKey] = useState(!current);
  const toast = useToast();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
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
      const editId = savedId;
      const saved = await api<{ _id: string; id?: string }>(`${base}/providers${editId ? `/${editId}` : ''}`, { method: editId ? 'PATCH' : 'POST',
        body: editId ? {
          name: name.trim(), provider: 'GROQ', model: groqModel, plan, quotaGroup,
          ...(cleanKey ? { apiKey: cleanKey } : {}),
          organization: text('organization'), project: text('project'), quotaScope: text('quotaScope') || 'UNKNOWN',
          enabled: form.has('enabled'), backup: form.has('backup'), independent: form.has('independent'), paidApproved: form.has('paidApproved'),
          priority: number('priority') ?? 100, timeoutMs: number('timeoutMs') ?? 12000,
          inputLimit: number('inputLimit'), outputLimit: number('outputLimit'), limits, spending,
          endpoint: null,
          outputMode: null,
          ...(editId ? {} : { workload }),
        } : { workload, apiKey: cleanKey } });
      const persistedId = saved.id ?? saved._id;
      setSavedId(persistedId);
      await refresh();
      if (test) {
        try {
          await api(`${base}/providers/${persistedId}/test`, { method: 'POST', body: { autoActivate: true } });
          await refresh();
          toast.success('Configuration saved and connection tested');
          close();
        } catch (error) {
          await refresh();
          toast.error(`Saved successfully, but connection test failed: ${errorMessage(error)}`);
          return;
        }
      } else {
        toast.success('Configuration saved');
        close();
      }
    } catch (error) {
      toast.error(`Configuration save failed: ${errorMessage(error)}`);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  if (!current) return <Card title="Add Groq API key"
    description={`${workload === 'STUDENT_MENTOR' ? 'Student AI' : 'Staff AI'} · Algora automatically assigns the provider, model and safe defaults.`}>
    <form onSubmit={save} className="space-y-4">
      <SecretInput label="Groq API key" value={apiKey} onChange={setApiKey} required
        hint="Encrypted at rest. The key is trimmed before saving." />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" value="test" variant="primary" loading={busy} disabled={busy}>Save and test</Button>
        <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
      </div>
    </form>
  </Card>;

  return <Card title={current ? 'Edit Groq configuration' : 'Add Groq configuration'}
    description={`${workload === 'STUDENT_MENTOR' ? 'Student AI' : 'Staff AI'} · credentials are encrypted and never returned to the browser.`}>
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" label="Display name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80}
          hint="A short name, for example Groq Key 1." />
        <div className="space-y-1.5 rounded-lg border border-line bg-subtle px-3 py-2 text-sm">
          <p className="font-medium text-fg">Provider</p>
          <p className="text-fg-muted">Groq · fixed official endpoint</p>
        </div>
        {(!current || replaceKey) ? <SecretInput label={current ? 'Replacement API key' : 'Groq API key'} value={apiKey} onChange={setApiKey}
          required={!current} hint="Stored encrypted. Existing keys are kept unless you replace them." />
          : <div className="space-y-1.5 text-sm">
            <p className="font-medium text-fg">API key</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-subtle px-2 py-1 font-mono text-xs text-fg">{current?.masked}</code>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReplaceKey(true)}>Replace API key</Button>
            </div>
            <p className="text-xs text-fg-subtle">The existing encrypted credential is preserved unless replaced.</p>
          </div>}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-fg">Assigned model</p>
          <code className="block rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-fg">{groqModel}</code>
        </div>
        <Select name="plan" label="Plan" value={plan} onChange={(event) => setPlan(event.target.value)}
          options={[{ value: 'FREE', label: 'Free' }, { value: 'PAID', label: 'Paid' }]}
          hint="Free is the default. Algora cannot verify provider billing." />
      </div>

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
              onChange={(event) => setQuotaGroup(event.target.value)}
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
              hint="Optional Groq model context limit override." />
            <Input name="outputLimit" label="Model output limit (optional)" type="number" min={64} max={1000000}
              value={outputLimit} onChange={(event) => setOutputLimit(event.target.value)}
              hint="Optional Groq model output limit override." />
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
