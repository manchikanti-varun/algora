import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { AppError, conflict } from '../../lib/errors';
import { acquireLease, maybeTransaction, releaseLease, supportsTransactions } from '../../lib/lease';
import { AiCounter, AiProvider, AiSettings, AiUsage } from '../../models/ai';
import { audit } from '../audit/audit';
import { discoverModels, invokeProvider, normalize, providerFailure, providerIdentity, providerName, providerFamily, ProviderFailure, quotaHeaders, retryDelay, type ProviderOptions } from './providers';
import { defaults, limitsSchema, providerLimits, type Workload } from './policy';

export const unavailable = (message = 'AI is unavailable. You can continue without AI or ask your trainer.') => new AppError(503, 'AI_UNAVAILABLE', message);
export const limited = (message = 'The AI allowance for this window has been used. Try again later.') => new AppError(429, 'AI_LIMIT', message);
export const encryptionReady = () => /^[\da-f]{64}$/i.test(process.env.AI_CREDENTIAL_ENCRYPTION_KEY ?? '');
function key() {
  if (!encryptionReady()) throw unavailable('AI credential encryption is unavailable.');
  return Buffer.from(process.env.AI_CREDENTIAL_ENCRYPTION_KEY!, 'hex');
}
export function encrypt(secret: string, workload: Workload, options?: ProviderOptions) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(options ? `${workload}:${providerIdentity(options)}` : workload));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return (options ? 'v2.' : '') + [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}
function decrypt(value: string, workload: Workload, options: ProviderOptions) {
  try {
    const bound = value.startsWith('v2.');
    if (!bound && providerName(options) !== 'GROQ') throw new Error('Legacy Groq credential');
    const [iv, tag, ciphertext] = (bound ? value.slice(3) : value).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAAD(Buffer.from(bound ? `${workload}:${providerIdentity(options)}` : workload));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString();
  } catch { throw unavailable('AI credential encryption is unavailable.'); }
}
export async function settings(workload: Workload) {
  const doc = await AiSettings.findById(workload).lean();
  return { enabled: !!doc?.enabled, activeId: doc?.activeId, servingId: doc?.servingId,
    mode: doc?.mode === 'AUTO' ? 'AUTO' as const : 'MANUAL' as const,
    recovery: doc?.recovery === 'STICKY' ? 'STICKY' as const : 'COOLDOWN' as const,
    maxBackups: Math.max(1, Math.min(2, doc?.maxBackups ?? 1)), paidAllowed: !!doc?.paidAllowed,
    limits: limitsSchema.parse({ ...defaults(workload), ...doc?.limits }) };
}
const minuteMs = 60_000;
const dayMs = 86_400_000;
const indiaOffset = 330 * minuteMs;
const boundary = (window: number, now: number) => Math.floor((now + (window === dayMs ? indiaOffset : 0)) / window) * window - (window === dayMs ? indiaOffset : 0);
export const todayStart = () => new Date(boundary(dayMs, Date.now()));
const counterId = (prefix: string, window: number, now: number) => `${prefix}:${window}:${boundary(window, now)}`;
export const allowance = async (userId: string, daily: number) => Math.max(0, daily - ((await AiCounter.findById(counterId(`success:${userId}`, dayMs, Date.now())).lean())?.requests ?? 0));
export async function countSuccess(userId: string, session?: ClientSession, now = Date.now()) {
  await AiCounter.updateOne({ _id: counterId(`success:${userId}`, dayMs, now) }, { $inc: { requests: 1 }, $setOnInsert: { expiresAt: new Date(now + 2 * dayMs) } }, { upsert: true, session });
}
export interface Attribution {
  userId: string; role: string; action: string; batchId?: string; courseId?: string; chapterId?: string;
  problemId?: string; collegeId?: string; referenceId?: string; requestKey?: string;
}
interface Budget { prefix: string; window: number; requests: number; tokens?: number; providerScoped?: boolean; amount?: number }
async function reserve(budgets: Budget[], estimate: number) {
  if (!(await supportsTransactions())) throw unavailable('AI requires MongoDB transaction support.');
  const now = Date.now();
  const rows = budgets.map((budget) => ({ ...budget, id: counterId(budget.prefix, budget.window, now) }));
  // Seed missing windows before the transaction to avoid a concurrent transactional upsert race.
  await Promise.all(rows.map(async (row) => {
    try {
      await AiCounter.updateOne({ _id: row.id }, { $setOnInsert: { expiresAt: new Date(now + row.window * 2), requests: 0, tokens: 0 } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
    }
  }));
  await maybeTransaction(async (session) => {
    for (const row of rows) {
      const current = await AiCounter.findById(row.id).session(session!).lean();
      const amount = row.tokens === undefined ? 0 : row.amount ?? estimate;
      if ((current?.requests ?? 0) >= row.requests || (row.tokens !== undefined && (current?.tokens ?? 0) + amount > row.tokens)) {
        if (row.providerScoped) throw new ProviderFailure(429, 'AI_CONFIGURATION_BUDGET', 'This provider configuration has reached its application budget.', true);
        throw limited();
      }
      await AiCounter.updateOne({ _id: row.id }, { $inc: { requests: 1, tokens: amount } }, { session });
    }
  });
  return { all: rows.map((row) => row.id), token: rows.filter((row) => row.tokens !== undefined && row.amount === undefined).map((row) => row.id), special: rows.filter((row) => row.amount !== undefined) };
}


type Config = NonNullable<Awaited<ReturnType<typeof loadConfig>>>;
type WorkloadSettings = Awaited<ReturnType<typeof settings>>;
const loadConfig = (id: string, workload: Workload) => AiProvider.findOne({ _id: id, workload, archivedAt: null }).lean().exec();

export function eligible(config: Config, workload: WorkloadSettings, test = false) {
  if (!config.encrypted || !config.model || !config.quotaGroup || config.archivedAt || (!test && config.enabled === false)) return false;
  if (config.plan === 'PAID' && !(workload.paidAllowed && config.paidApproved)) return false;
  if (config.plan !== 'PAID' && providerName(config) === 'OPENROUTER' && !config.model.endsWith(':free')) return false;
  // Legacy Groq configurations already used the native JSON contract. New adapters must pass a versioned probe.
  return test || providerName(config) === 'GROQ' || (config.lastTest?.status === 'SUCCESS' && config.lastTest?.version === config.version);
}

export async function configuredProvider(workload: Workload, config: WorkloadSettings) {
  if (!config.enabled || !config.activeId || !encryptionReady()) return false;
  const row = await loadConfig(config.activeId, workload);
  return !!row && eligible(row, config);
}

export async function workloadBudgets() {
  const now = Date.now();
  const keys = new Map(['STUDENT_MENTOR', 'STAFF_PREPARATION'].map((workload) => [workload, counterId(`work:${workload}`, dayMs, now)]));
  const rows = await AiCounter.find({ _id: { $in: [...keys.values()] } }, 'requests tokens').lean();
  const byKey = new Map(rows.map((row) => [row._id, row]));
  return new Map([...keys].map(([workload, key]) => {
    const row = byKey.get(key);
    return [workload, { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0 }] as const;
  }));
}

export async function listProviderModels(config: Config, workload: Workload) {
  if (!config.encrypted || config.archivedAt) throw unavailable();
  try { return await discoverModels(config, decrypt(config.encrypted, workload, config)); }
  catch (error) { throw error instanceof AppError ? error : unavailable('The provider model catalog could not be reached.'); }
}

function candidateOrder(primary: Config, rows: Config[], config: WorkloadSettings) {
  const id = String(primary._id);
  if (config.mode === 'MANUAL') return [primary];
  const backups = rows.filter((row) => String(row._id) !== id && row.backup && row.independent && primary.independent
      && row.quotaScope && row.quotaScope !== 'UNKNOWN' && primary.quotaScope && primary.quotaScope !== 'UNKNOWN'
      && row.quotaGroup !== primary.quotaGroup && providerFamily(row) !== providerFamily(primary)
      && (row.plan ?? 'FREE') === (primary.plan ?? 'FREE') && eligible(row, config))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || String(a._id).localeCompare(String(b._id)));
  const sticky = config.recovery === 'STICKY' && backups.find((row) => String(row._id) === config.servingId);
  return sticky ? [sticky, ...backups.filter((row) => row !== sticky)] : [primary, ...backups];
}

async function acquireSlot(prefix: string, slots: number) {
  for (let index = 0; index < slots; index++) {
    const slot = await acquireLease(`${prefix}:${index}`, 100_000);
    if (slot) return slot;
  }
  throw limited('AI is busy. Try again in a moment.');
}

export async function completion<T>(workload: Workload, attribution: Attribution, system: string, data: unknown, validate: (value: unknown) => T, configId?: string, authorize?: () => Promise<void>, outputSchema?: z.ZodType) {
  const config = await settings(workload);
  const test = attribution.action === 'CONNECTION_TEST';
  if (!test && !config.enabled) throw unavailable('This AI workload is disabled.');
  const primaryId = (test ? configId : config.activeId) ?? '';
  const primary = primaryId ? await loadConfig(primaryId, workload) : null;
  if (!primary || !eligible(primary, config, test)) throw unavailable('An eligible and compatible AI configuration is required.');
  const candidates = test || config.mode === 'MANUAL' ? [primary] : candidateOrder(primary,
    await AiProvider.find({ workload, archivedAt: null }).limit(10).lean(), config);
  const payload = JSON.stringify(data);
  const inputEstimate = Buffer.byteLength(system + payload) + 256;
  if (inputEstimate > config.limits.context) throw new AppError(400, 'AI_CONTEXT_LIMIT', 'Shorten the request or start a fresh conversation.');
  const personal = await acquireLease(`ai:${workload}:user:${attribution.userId}`, 100_000);
  if (!personal) throw limited('An AI request is already in progress.');
  const leases = [personal];
  const logicalId = randomUUID();
  let logical: Awaited<ReturnType<typeof createLogical>> | undefined;
  let used = 0;
  let backupUsed = 0;
  let previousId: string | undefined;
  let failure: ProviderFailure | undefined;
  const visitedFamilies = new Set<string>();
  const visitedGroups = new Set<string>();
  try {
    leases.push(await acquireSlot('ai:global:slot', 12));
    leases.push(await acquireSlot(`ai:${workload}:slot`, config.limits.concurrency));
    logical = await createLogical(attribution, workload, logicalId);
    for (const provider of candidates) {
      const id = String(provider._id);
      const family = providerFamily(provider);
      const group = provider.quotaGroup!;
      if (visitedFamilies.has(family) || visitedGroups.has(group)) continue;
      if (used >= (config.mode === 'AUTO' && !test ? config.maxBackups + 1 : 1)) break;
      if (id !== primaryId && backupUsed >= config.maxBackups) break;
      visitedFamilies.add(family);
      visitedGroups.add(group);
      const reason = failure?.code;
      try {
        const output = test ? Math.min(64, provider.outputLimit ?? 64) : Math.min(config.limits.output, provider.outputLimit ?? config.limits.output);
        const schema = providerName(provider) === 'ANTHROPIC' && provider.outputMode !== 'PROMPT_JSON' && outputSchema
          ? grammarSchema(z.toJSONSchema(outputSchema)) : undefined;
        const estimate = inputEstimate + (schema ? Buffer.byteLength(JSON.stringify(schema)) : 0);
        if (id !== primaryId && estimate > (provider.inputLimit ?? config.limits.context)) continue;
        const result = await attempt({ workload, attribution, config, provider, test, system, payload, inputEstimate: estimate, output, logicalId, schema,
          attemptNumber: used + 1, reason, previousId, authorize, sent: () => { used++; if (id !== primaryId) backupUsed++; } }, validate);
        if (!test && config.mode === 'AUTO' && config.servingId !== id) {
          const updated = await AiSettings.updateOne({ _id: workload, activeId: primaryId, mode: 'AUTO', servingId: config.servingId ?? null }, { $set: { servingId: id } });
          if (updated.matchedCount && id !== (config.servingId ?? primaryId)) {
            await audit(null, 'ai.provider.automatic_switch', { type: 'AiSettings', id: workload }, {
              workload, mode: 'AUTO', previousId: config.servingId ?? primaryId, replacementId: id, reason: reason ?? 'PRIMARY_RECOVERED', recovered: id === primaryId,
            });
          }
        }
        await logical.updateOne({ status: 'COMPLETED', configId: id, provider: providerName(provider), finishedAt: new Date() });
        return result;
      } catch (error) {
        if (!(error instanceof ProviderFailure && error.retryable) || config.mode !== 'AUTO' || test) throw error;
        failure = error;
        previousId = id;
      }
    }
    throw failure ?? unavailable('No eligible AI provider is available.');
  } catch (error) {
    await logical?.updateOne({ status: 'LOGICAL_FAILED', failure: error instanceof AppError ? error.code : 'AI_UNAVAILABLE', finishedAt: new Date(),
      ...(used === 0 ? { $unset: { requestKey: 1 } } : {}) });
    throw error;
  } finally {
    await Promise.all(leases.map((lease) => releaseLease(lease).catch(() => {})));
  }
}

async function createLogical(attribution: Attribution, workload: Workload, logicalId: string) {
  try { return await AiUsage.create({ ...attribution, workload, logicalId, recordKind: 'LOGICAL', status: 'PENDING', outbound: false }); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 11000) throw conflict('This AI request was already submitted.');
    throw error;
  }
}

// Keep provider grammar to the supported subset. Length and semantic constraints remain in the application's Zod validator.
function grammarSchema(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of ['type', 'required', 'additionalProperties', 'enum'] as const) if (Object.hasOwn(value, field)) result[field] = value[field];
  if (Object.hasOwn(value, 'const')) result.enum = [value.const];
  if (value.items && typeof value.items === 'object') result.items = grammarSchema(value.items as Record<string, unknown>);
  if (value.properties && typeof value.properties === 'object') result.properties = Object.fromEntries(
    Object.entries(value.properties as Record<string, Record<string, unknown>>).map(([name, property]) => [name, grammarSchema(property)]),
  );
  return result;
}

interface Attempt {
  workload: Workload; attribution: Attribution; config: WorkloadSettings; provider: Config; test: boolean;
  system: string; payload: string; inputEstimate: number; output: number; logicalId: string; attemptNumber: number;
  schema?: Record<string, unknown>; reason?: string; previousId?: string; authorize?: () => Promise<void>; sent: () => void;
}
async function attempt<T>(a: Attempt, validate: (value: unknown) => T) {
  const { workload, attribution, config, provider, test, system, payload, inputEstimate, output, logicalId, attemptNumber, reason, previousId, authorize, sent, schema } = a;
  const name = providerName(provider);
  const id = String(provider._id);
  const family = providerFamily(provider);
  if (inputEstimate > (provider.inputLimit ?? config.limits.context)) throw new AppError(400, 'AI_CONTEXT_LIMIT', 'Shorten the request for the configured model.');
  const secret = decrypt(provider.encrypted!, workload, provider);
  const limits = config.limits;
  const reserved = inputEstimate + output;
  const providerCaps = providerLimits.parse({ ...limits, ...provider.limits });
  // Retain the existing group namespace and conservative strictest cap across both workloads.
  const groupKey = `groq:${provider.quotaGroup}`;
  const unknownKey = `ai-provider-unknown:${family}`;
  const unknown = !provider.quotaScope || provider.quotaScope === 'UNKNOWN';
  const peers = await AiProvider.find({ quotaGroup: provider.quotaGroup, archivedAt: null }, 'limits workload').lean();
  const group = { ...providerCaps };
  for (const peer of peers) {
    const peerCaps = providerLimits.parse({ ...defaults(peer.workload as Workload), ...peer.limits });
    for (const field of Object.keys(group) as (keyof typeof group)[]) group[field] = Math.min(group[field], peerCaps[field]);
  }
  const coolingKeys = [`${groupKey}:pause`, `${unknownKey}:pause`];
  const cooldown = await AiCounter.exists({ _id: { $in: coolingKeys }, expiresAt: { $gt: new Date() } });
  if (cooldown) throw new ProviderFailure(429, 'AI_PROVIDER_COOLDOWN', 'The provider quota is cooling down.', true);
  if (!test && provider.circuitUntil && provider.circuitUntil > new Date()) {
    throw new ProviderFailure(503, 'AI_PROVIDER_CIRCUIT', 'The provider is cooling down after a rejected request.', true);
  }
  const probe = !test && provider.circuitUntil ? await acquireLease(`ai:probe:${id}:${provider.version}`, 35_000) : null;
  if (!test && provider.circuitUntil && !probe) throw new ProviderFailure(503, 'AI_PROVIDER_CIRCUIT', 'Provider recovery is already being checked.', true);

  const { requestKey: _logicalKey, ...actor } = attribution;
  const started = Date.now();
  const currentVersion = { _id: id, version: provider.version };
  let counters: Awaited<ReturnType<typeof reserve>> | undefined;
  let event: Awaited<ReturnType<typeof createLogical>> | undefined;
  let providerStatus: number | undefined;
  let quota: Record<string, string> | undefined;
  let usage: ReturnType<typeof normalize> | undefined;
  let errorCode: string | undefined;
  let status = 'REJECTED';
  let outbound = false;
  const spending = provider.spending as { dailyUsd: number; inputPerMillion: number; outputPerMillion: number } | undefined;
  const estimatedMicros = (input: number, result: number) => spending ? Math.ceil(input * spending.inputPerMillion + result * spending.outputPerMillion) : undefined;
  const reservedSpend = estimatedMicros(inputEstimate, output);
  try {
    counters = await reserve([
      { prefix: `actor:${workload}:${attribution.userId}`, window: minuteMs, requests: limits.minute },
      { prefix: `attempt:${workload}:${attribution.userId}`, window: dayMs, requests: workload === 'STUDENT_MENTOR' ? limits.daily * 3 : limits.daily },
      { prefix: `work:${workload}`, window: minuteMs, requests: limits.requestsMinute, tokens: limits.tokensMinute },
      { prefix: `work:${workload}`, window: dayMs, requests: limits.requestsDay, tokens: limits.tokensDay },
      ...(workload === 'STAFF_PREPARATION' && !test ? [{
        prefix: `staff:${attribution.userId}:${attribution.action === 'STAFF_FOLLOWUP' ? 'chat' : 'generation'}`, window: dayMs,
        requests: attribution.action === 'STAFF_FOLLOWUP' ? limits.conversationDay : limits.generationDay,
      }] : []),
      { prefix: groupKey, window: minuteMs, requests: group.requestsMinute, tokens: group.tokensMinute, providerScoped: true },
      { prefix: groupKey, window: dayMs, requests: group.requestsDay, tokens: group.tokensDay, providerScoped: true },
      { prefix: `config:${id}`, window: minuteMs, requests: providerCaps.requestsMinute, tokens: providerCaps.tokensMinute, providerScoped: true },
      { prefix: `config:${id}`, window: dayMs, requests: providerCaps.requestsDay, tokens: providerCaps.tokensDay, providerScoped: true },
      // A backend-wide safety ceiling for unidentified organizations in the same provider family.
      ...(unknown ? [{ prefix: unknownKey, window: minuteMs, requests: 30, tokens: 50_000, providerScoped: true },
        { prefix: unknownKey, window: dayMs, requests: 1000, tokens: 200_000, providerScoped: true }] : []),
      ...(spending && reservedSpend !== undefined ? [{ prefix: `spend:${id}`, window: dayMs, requests: 20000,
        tokens: Math.floor(spending.dailyUsd * 1_000_000), amount: reservedSpend, providerScoped: true }] : []),
    ], reserved);
    await authorize?.();
    if (!test && !(await AiSettings.exists({ _id: workload, enabled: true, activeId: config.activeId,
      ...(id !== config.activeId ? { mode: 'AUTO' } : {}),
      ...(provider.plan === 'PAID' ? { paidAllowed: true } : {}) }))) throw unavailable('The workload configuration changed. Try again.');
    if (!(await AiProvider.exists({ ...currentVersion, archivedAt: null,
      ...(test ? {} : { enabled: { $ne: false }, ...(id !== config.activeId ? { backup: true, independent: true } : {}) }) }))) {
      throw unavailable('The provider configuration changed. Try again.');
    }
    event = await AiUsage.create({ ...actor, logicalId, recordKind: 'ATTEMPT', attempt: attemptNumber, failoverReason: reason, workload,
      configId: id, configVersion: provider.version, provider: name, model: provider.model, status: 'OUTBOUND', outbound: true });
    outbound = true;
    sent();
    status = 'FAILED';
    const reply = await invokeProvider(provider, secret, system, payload, output, schema);
    providerStatus = reply.status;
    quota = quotaHeaders(reply.headers);
    if (reply.status < 200 || reply.status >= 300) {
      const failure = providerFailure(reply.status, reply.body);
      if (reply.status === 429) {
        status = 'RATE_LIMITED';
        const expiresAt = new Date(Date.now() + Math.min(86400000, retryDelay(quota)));
        const keys = unknown ? coolingKeys : [coolingKeys[0]];
        await Promise.all(keys.map((_id) => AiCounter.updateOne({ _id }, { $max: { expiresAt } }, { upsert: true })));
      } else if (failure.retryable) {
        await AiProvider.updateOne(currentVersion, { $max: { circuitUntil: new Date(Date.now() + (failure.code === 'AI_MODEL_UNAVAILABLE' ? 900_000 : 60_000)) },
          $set: { circuitReason: failure.code } });
      }
      throw failure;
    }
    usage = normalize(name, reply.body);
    if (usage.incomplete || !usage.text || usage.text.length > 100_000) throw new AppError(502, 'AI_OUTPUT', 'The provider returned an incomplete response.');
    let content: T;
    try { content = validate(JSON.parse(usage.text)); }
    catch { throw new AppError(502, 'AI_OUTPUT', 'The provider returned an invalid response.'); }
    if (provider.circuitUntil) await AiProvider.updateOne({ ...currentVersion, circuitUntil: provider.circuitUntil }, { $unset: { circuitUntil: 1, circuitReason: 1 } });
    status = 'SUCCESS';
    return { content, model: provider.model, provider: name, configId: id, configVersion: provider.version };
  } catch (error) {
    const safe = error instanceof AppError ? error : new ProviderFailure(503, 'AI_PROVIDER_UNCERTAIN', 'The provider did not confirm whether it completed the request.');
    errorCode = safe.code;
    if (counters && !outbound) await refund(counters, reserved);
    if (outbound && safe.code === 'AI_PROVIDER_UNCERTAIN') {
      await AiProvider.updateOne(currentVersion, { $max: { circuitUntil: new Date(Date.now() + 60_000) }, $set: { circuitReason: safe.code } });
    }
    throw safe;
  } finally {
    if (probe) await releaseLease(probe).catch(() => {});
    if (event) {
      if (reason) await audit(null, 'ai.provider.backup_attempt', { type: 'AiSettings', id: workload }, {
        workload, mode: 'AUTO', previousId, replacementId: id, reason, result: status,
      });
      const observedMicros = usage?.costUsd === undefined ? undefined : Math.ceil(usage.costUsd * 1_000_000);
      const estimated = usage?.input !== undefined && usage.output !== undefined ? estimatedMicros(usage.input, usage.output) : undefined;
      const amount = observedMicros ?? estimated;
      await event.updateOne({ status, input: usage?.input, output: usage?.output, total: usage?.total, quota, providerStatus,
        costUsd: amount === undefined ? undefined : amount / 1_000_000, costEstimated: observedMicros === undefined && estimated !== undefined,
        failure: errorCode, latency: Date.now() - started, finishedAt: new Date() });
      const actual = usage?.total;
      if (actual !== undefined) await AiCounter.updateMany({ _id: { $in: counters!.token } }, { $inc: { tokens: actual - reserved } });
      if (amount !== undefined && reservedSpend !== undefined) await AiCounter.updateMany(
        { _id: { $in: counters!.special.map((row) => row.id) } }, { $inc: { tokens: amount - reservedSpend } },
      );
    }
  }
}

async function refund(counters: Awaited<ReturnType<typeof reserve>>, estimate: number) {
  await maybeTransaction(async (session) => {
    await AiCounter.updateMany({ _id: { $in: counters.all } }, { $inc: { requests: -1 } }, { session });
    await AiCounter.updateMany({ _id: { $in: counters.token } }, { $inc: { tokens: -estimate } }, { session });
    for (const row of counters.special) await AiCounter.updateOne({ _id: row.id }, { $inc: { tokens: -(row.amount ?? 0) } }, { session });
  });
}

export async function currentBudgets(provider: Config, config: WorkloadSettings) {
  const caps = providerLimits.parse({ ...config.limits, ...provider.limits });
  const key = `config:${provider._id}`;
  const now = Date.now();
  const [minute, day, spend, pause, unknownPause] = await Promise.all([
    AiCounter.findById(counterId(key, minuteMs, now)).lean(), AiCounter.findById(counterId(key, dayMs, now)).lean(),
    AiCounter.findById(counterId(`spend:${provider._id}`, dayMs, now)).lean(),
    AiCounter.findById(`groq:${provider.quotaGroup}:pause`).lean(),
    AiCounter.findById(`ai-provider-unknown:${providerFamily(provider)}:pause`).lean(),
  ]);
  return { configured: caps, minute: { requests: minute?.requests ?? 0, tokens: minute?.tokens ?? 0 },
    day: { requests: day?.requests ?? 0, tokens: day?.tokens ?? 0, estimatedUsd: (spend?.tokens ?? 0) / 1_000_000 },
    quotaCooldownUntil: [pause?.expiresAt, unknownPause?.expiresAt].filter((date): date is Date => !!date && +date > now)
      .sort((a, b) => +b - +a)[0],
  };
}

export type Limits = z.infer<typeof limitsSchema>;
