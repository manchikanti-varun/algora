import { Router } from 'express';
import { z } from 'zod';
import { AppError, badRequest, conflict, notFound, parse } from '../../lib/errors';
import { takeToken } from '../../lib/ratelimit';
import { withLease } from '../../lib/lease';
import { objectId } from '../../lib/validate';
import { requireRole } from '../../middleware/auth';
import { AuditLog, Batch } from '../../models';
import { AiBatch, AiProvider, AiSettings, AiUsage } from '../../models/ai';
import { audit } from '../audit/audit';
import { toXlsx } from '../analytics/analytics.routes';
import { toCsv } from '../../lib/csv';
import { limitsSchema, providerLimits, workloads, type Workload } from './policy';
import { budgetSnapshots, completion, currentBudgets, eligible, encrypt, encryptionReady, limited, listProviderModels, settings, todayStart, unavailable, workloadBudgets } from './runtime';

import { customEndpoints, discoverModels, ProviderFailure, providerBase, providerIdentity, providerName, providerNames, type ProviderDiagnostics } from './providers';

const workloadSchema = z.enum(workloads);
const configFields = z.object({
  name: z.string().trim().min(1).max(80), model: z.string().trim().regex(/^[a-z0-9_./:-]{1,160}$/i),
  provider: z.enum(providerNames).optional(),
  endpoint: z.string().trim().max(120).nullable().optional(),
  organization: z.string().trim().max(80).optional(), project: z.string().trim().max(80).optional(),
  quotaGroup: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,50}$/), plan: z.enum(['FREE', 'PAID']).optional(),
  quotaScope: z.enum(['UNKNOWN', 'ORGANIZATION', 'PROJECT', 'MODEL', 'ACCOUNT']).optional(),
  enabled: z.boolean().optional(), backup: z.boolean().optional(), independent: z.boolean().optional(),
  paidApproved: z.boolean().optional(), priority: z.number().int().min(1).max(100).optional(),
  outputMode: z.enum(['JSON_OBJECT', 'PROMPT_JSON']).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(25000).optional(),
  inputLimit: z.number().int().min(100).max(10000000).nullable().optional(),
  outputLimit: z.number().int().min(64).max(1000000).nullable().optional(),
  spending: z.object({ dailyUsd: z.number().min(0.01).max(10000), inputPerMillion: z.number().nonnegative().max(10000),
    outputPerMillion: z.number().nonnegative().max(10000) }).strict().refine((v) => v.inputPerMillion > 0 || v.outputPerMillion > 0).nullable().optional(),
  limits: providerLimits.partial().optional(), apiKey: z.string().trim().regex(/^[!-~]{8,512}$/),
}).strict();
type Provider = Awaited<ReturnType<typeof getProvider>>;
async function getProvider(id: string) {
  const doc = await AiProvider.findById(id).lean();
  if (!doc) throw notFound('Configuration not found');
  return doc;
}
function publicConfig(row: Provider) {
  const { _id, workload, name, model, organization, project, quotaGroup, masked, plan, version, limits, archivedAt, lastTest, createdAt, updatedAt,
    endpoint, enabled, backup, priority, independent, quotaScope, paidApproved, outputMode, timeoutMs, inputLimit, outputLimit, spending, circuitUntil, circuitReason } = row;
  return { _id, workload, name, model, organization, project, quotaGroup, masked, plan, version, limits, archivedAt, lastTest, createdAt, updatedAt,
    provider: providerName(row), endpoint, enabled: enabled !== false, backup: !!backup, priority: priority ?? 100, independent: !!independent,
    quotaScope: quotaScope ?? 'UNKNOWN', paidApproved: !!paidApproved, outputMode, timeoutMs: timeoutMs ?? 12000, inputLimit, outputLimit, spending,
    circuitUntil, circuitReason };
}

export const adminAi = Router();
adminAi.use(requireRole('SUPER_ADMIN'));
adminAi.get('/settings', async (_req, res) => {
  const [rows, budgets] = await Promise.all([Promise.all(workloads.map(async (workload) => ({ workload, ...await settings(workload) }))), workloadBudgets()]);
  res.json({ encryptionReady: encryptionReady(), workloads: rows.map((row) => ({ ...row, budget: budgets.get(row.workload) })), providers: providerNames, customEndpoints });
});
adminAi.patch('/settings/:workload', async (req, res) => {
  const workload = parse(workloadSchema, req.params.workload);
  const input = parse(z.object({ enabled: z.boolean().optional(), limits: limitsSchema.partial().optional(),
    mode: z.enum(['MANUAL', 'AUTO']).optional(), recovery: z.enum(['STICKY', 'COOLDOWN']).optional(),
    maxBackups: z.number().int().min(1).max(2).optional(), paidAllowed: z.boolean().optional() }).strict(), req.body);
  const fields: Record<string, number | boolean | string> = Object.fromEntries(Object.entries(input.limits ?? {}).map(([field, value]) => [`limits.${field}`, value]));
  for (const field of ['enabled', 'mode', 'recovery', 'maxBackups', 'paidAllowed'] as const) {
    if (input[field] !== undefined) fields[field] = input[field];
  }
  await AiSettings.updateOne({ _id: workload }, { $set: fields,
    ...(input.mode || input.recovery ? { $unset: { servingId: 1 } } : {}) }, { upsert: true });
  await audit(req, 'ai.settings.update', { type: 'AiSettings', id: workload }, input);
  res.json(await settings(workload));
});
adminAi.get('/providers', async (_req, res) => {
  const rows = await AiProvider.find({ archivedAt: null }).sort({ priority: 1, createdAt: 1 }).limit(20).lean();
  const controls = new Map(await Promise.all(workloads.map(async (workload) => [workload, await settings(workload)] as const)));
  const budgets = await budgetSnapshots(rows, controls);
  res.json({ items: rows.map((row) => {
    const config = controls.get(row.workload as Workload)!;
    return { ...publicConfig(row), active: config.activeId === String(row._id), eligible: eligible(row, config), budget: budgets.get(String(row._id)) };
  }) });
});
adminAi.get('/providers/:id/budget', async (req, res) => {
  const row = await getProvider(parse(objectId, req.params.id));
  res.json(await currentBudgets(row, await settings(parse(workloadSchema, row.workload))));
});
adminAi.get('/failover-history', async (_req, res) => {
  const items = await AuditLog.find({ action: { $in: ['ai.provider.automatic_switch', 'ai.provider.backup_attempt', 'ai.credential.activate', 'ai.credential.deactivate'] } },
    'action actorId targetId metadata createdAt').sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items });
});
const discoveryFields = z.object({
  provider: z.enum(providerNames).optional(),
  endpoint: z.string().trim().max(120).nullable().optional(),
  apiKey: z.string().trim().regex(/^[!-~]{8,512}$/).optional(),
  configId: objectId.optional(),
}).strict().refine((value) => !!value.configId || (!!value.apiKey && !!value.provider), {
  message: 'Enter an API key and provider, or choose a saved configuration.',
});
/** Discover models before saving (using the key being entered) or with an existing encrypted credential. */
adminAi.post('/providers/discover', async (req, res) => {
  const input = parse(discoveryFields, req.body);
  if (!(await takeToken(`ai:models:${req.user!._id}`, 4, 4, true))) throw limited('Wait before requesting more provider model catalogs.');
  let models;
  let provider = input.provider;
  if (input.apiKey) {
    const options = { provider: input.provider!, endpoint: input.provider === 'CUSTOM' ? input.endpoint ?? null : null, timeoutMs: 12_000 };
    providerBase(options);
    try { models = await discoverModels(options, input.apiKey); }
    catch (error) { throw error instanceof AppError ? error : unavailable('The provider model catalog could not be reached.'); }
  } else {
    const row = await getProvider(input.configId!);
    provider = providerName(row);
    models = await listProviderModels(row, parse(workloadSchema, row.workload));
  }
  await audit(req, 'ai.credential.models', { type: 'AiProvider', id: input.configId ?? 'discovery' }, { count: models.length, provider });
  res.json({ items: models });
});
adminAi.post('/providers/:id/models', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const row = await getProvider(id);
  if (!(await takeToken(`ai:models:${req.user!._id}`, 4, 4, true))) throw limited('Wait before requesting more provider model catalogs.');
  const models = await listProviderModels(row, parse(workloadSchema, row.workload));
  await audit(req, 'ai.credential.models', { type: 'AiProvider', id }, { count: models.length });
  res.json({ items: models });
});
adminAi.post('/providers', async (req, res) => {
  const { apiKey, workload, ...fields } = parse(configFields.extend({ workload: workloadSchema }), req.body);
  providerBase(fields);
  const encrypted = encrypt(apiKey, workload, fields);
  const result = await withLease(`ai:configs:${workload}`, 15_000, async () => {
    const slots = new Set(await AiProvider.distinct('slot', { workload, archivedAt: null }));
    const max = 10;
    const slot = Array.from({ length: max }, (_, i) => i).find((i) => !slots.has(i));
    if (slot === undefined) throw conflict(`This workload supports up to ${max} saved configuration(s).`);
    const record = await AiProvider.create({ ...fields, plan: fields.plan ?? 'FREE', workload, slot, encrypted, masked: `••••${apiKey.slice(-4)}`, version: 1 });
    await audit(req, 'ai.credential.create', { type: 'AiProvider', id: record._id }, { workload, model: fields.model });
    return publicConfig(record.toObject());
  });
  if (!result) throw conflict('Another configuration change is in progress.');
  res.status(201).json(result);
});
adminAi.patch('/providers/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const { apiKey, ...fields } = parse(configFields.partial(), req.body);
  const old = await getProvider(id);
  const workload = parse(workloadSchema, old.workload);
  const result = await withLease(`ai:configs:${workload}`, 15_000, async () => {
    const current = await getProvider(id);
    const next = { ...current, ...fields };
    if (providerIdentity(current) !== providerIdentity(next) && !apiKey) throw badRequest('Replacing the provider or endpoint requires a new API key.');
    const invalidateTest = !!apiKey || current.model !== next.model || current.outputMode !== next.outputMode || current.outputLimit !== next.outputLimit;
    const version = (current.version ?? 0) + 1;
    const row = await AiProvider.findOneAndUpdate({ _id: id, archivedAt: null }, {
      $set: { ...fields, version,
        ...(apiKey ? { encrypted: encrypt(apiKey, workload, next), masked: `••••${apiKey.slice(-4)}` } : {}),
        ...(!invalidateTest && current.lastTest ? { lastTest: { ...current.lastTest, version } } : {}),
      },
      ...(invalidateTest ? { $unset: { lastTest: 1, circuitUntil: 1, circuitReason: 1 } } : {}),
    }, { returnDocument: 'after' }).lean();
    if (!row) throw notFound('Configuration not found');
    if (row.enabled === false || (row.plan === 'PAID' && !row.paidApproved)) {
      await AiSettings.updateOne({ _id: workload, activeId: id }, { $unset: { activeId: 1, servingId: 1 } });
      await AiSettings.updateOne({ _id: workload, servingId: id }, { $unset: { servingId: 1 } });
    }
    return publicConfig(row);
  });
  if (!result) throw conflict('Another configuration change is in progress.');
  await audit(req, apiKey ? 'ai.credential.replace' : 'ai.credential.edit', { type: 'AiProvider', id }, { model: fields.model });
  res.json(result);
});
adminAi.post('/providers/:id/activate', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const provider = await getProvider(id);
  const workload = parse(workloadSchema, provider.workload);
  const result = await withLease(`ai:configs:${workload}`, 15_000, async () => {
    const row = await getProvider(id);
    const config = await settings(workload);
    if (!eligible(row, config) || !encryptionReady()) throw badRequest('Enable an eligible configuration and complete its connection test before activation.');
    await AiSettings.updateOne({ _id: workload }, { $set: { activeId: id, servingId: id } }, { upsert: true });
    return { previousId: config.servingId ?? config.activeId };
  });
  if (!result) throw conflict('Another configuration change is in progress.');
  await audit(req, 'ai.credential.activate', { type: 'AiProvider', id }, { workload, mode: 'MANUAL', reason: 'ADMIN_ACTIVATION', previousId: result.previousId, replacementId: id });
  res.status(204).end();
});
adminAi.post('/providers/deactivate/:workload', async (req, res) => {
  const workload = parse(workloadSchema, req.params.workload);
  const config = await AiSettings.findOneAndUpdate({ _id: workload }, { $unset: { activeId: 1, servingId: 1 } }, { returnDocument: 'before' }).lean();
  await audit(req, 'ai.credential.deactivate', { type: 'AiSettings', id: workload }, { workload, mode: 'MANUAL', reason: 'ADMIN_DEACTIVATION',
    previousId: config?.servingId ?? config?.activeId });
  res.status(204).end();
});
adminAi.delete('/providers/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const row = await getProvider(id);
  const result = await withLease(`ai:configs:${row.workload}`, 15_000, async () => {
    await AiProvider.updateOne({ _id: id, archivedAt: null }, { $set: { archivedAt: new Date() }, $unset: { encrypted: 1, slot: 1 } });
    await AiSettings.updateOne({ _id: row.workload, activeId: id }, { $unset: { activeId: 1, servingId: 1 } });
    await AiSettings.updateOne({ _id: row.workload, servingId: id }, { $unset: { servingId: 1 } });
    return true;
  });
  if (!result) throw conflict('Another configuration change is in progress.');
  await audit(req, 'ai.credential.archive', { type: 'AiProvider', id });
  res.status(204).end();
});
adminAi.post('/providers/:id/test', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const row = await getProvider(id);
  const workload = parse(workloadSchema, row.workload);
  const started = Date.now();
  let status = 'SUCCESS';
  let latency = 0;
  let quota: Record<string, string> | undefined;
  let testedProvider: string | undefined;
  let testedModel: string | null | undefined;
  let diagnostics: ProviderDiagnostics | undefined;
  try {
    const schema = z.object({ ok: z.literal(true) }).strict();
    const result = await completion(workload, { userId: String(req.user!._id), role: req.user!.role, action: 'CONNECTION_TEST' },
      'Return the JSON object {"ok":true}.', { test: true }, (value) => schema.parse(value), id, undefined, schema);
    quota = result.quota;
    testedProvider = result.provider;
    testedModel = result.model;
  } catch (error) {
    status = error instanceof Error && 'code' in error ? String(error.code) : 'UNAVAILABLE';
    // Sanitized diagnostics are for the Super Admin only. Student and staff routes never receive them.
    if (error instanceof ProviderFailure && error.diagnostics) {
      diagnostics = error.diagnostics;
      throw new AppError(error.status, error.code, error.message, { diagnostics });
    }
    throw error;
  } finally {
    latency = Date.now() - started;
    await AiProvider.updateOne({ _id: id, version: row.version }, { $set: { lastTest: {
      status, latency, at: new Date(), version: row.version, ...(quota ? { quota } : {}), ...(diagnostics ? { diagnostics } : {}),
    } } });
    await audit(req, 'ai.credential.test', { type: 'AiProvider', id }, { status });
  }
  res.json({ status, latency, provider: testedProvider ?? providerName(row), model: testedModel ?? row.model, quota });
});

adminAi.get('/batches', async (_req, res) => {
  const batches = await Batch.find({ status: { $ne: 'ARCHIVED' } }, 'name status').sort({ name: 1 }).limit(200).lean();
  const controls = await AiBatch.find({ _id: { $in: batches.map((batch) => String(batch._id)) } }).lean();
  const map = new Map(controls.map((row) => [row._id, row]));
  res.json({ items: batches.map((batch) => ({ ...batch, controls: map.get(String(batch._id)) })) });
});
adminAi.put('/batches/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  if (!(await Batch.exists({ _id: id, status: { $ne: 'ARCHIVED' } }))) throw notFound('Batch not found');
  const input = parse(z.object({
    enabled: z.boolean(), daily: z.number().int().min(1).max(1000).nullable(), courseIds: z.array(objectId).max(100),
    startsAt: z.iso.datetime({ offset: true }).nullable(), endsAt: z.iso.datetime({ offset: true }).nullable(),
    startMinute: z.number().int().min(0).max(1439).nullable(), endMinute: z.number().int().min(0).max(1439).nullable(),
  }).strict().refine((value) => (!value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt))
    && ((value.startMinute != null && value.endMinute != null && value.startMinute !== value.endMinute) ||
      (value.startMinute == null && value.endMinute == null))), req.body);
  await AiBatch.updateOne({ _id: id }, { $set: input }, { upsert: true });
  await audit(req, 'ai.batch.update', { type: 'Batch', id }, input);
  res.status(204).end();
});

const analyticsQuery = z.object({
  workload: workloadSchema.optional(), role: z.enum(['STUDENT', 'TRAINER', 'SUPER_ADMIN']).optional(),
  userId: objectId.optional(), batchId: objectId.optional(), courseId: objectId.optional(), chapterId: objectId.optional(),
  problemId: objectId.optional(), collegeId: objectId.optional(), configId: objectId.optional(),
  provider: z.enum(providerNames).optional(), action: z.string().max(100).optional(), model: z.string().max(160).optional(), status: z.string().max(32).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), format: z.enum(['csv', 'xlsx']).default('csv'),
});
const exportFields = ['createdAt', 'finishedAt', 'workload', 'role', 'userId', 'batchId', 'courseId', 'chapterId', 'problemId', 'collegeId',
  'action', 'referenceId', 'logicalId', 'recordKind', 'attempt', 'provider', 'failoverReason', 'costUsd', 'costEstimated', 'configId', 'configVersion', 'model', 'status', 'outbound', 'local', 'input', 'output', 'total', 'latency', 'providerStatus', 'failure'] as const;
export function usageFilter(value: z.infer<typeof analyticsQuery>) {
  const { from, to, provider, format: _format, ...filters } = value;
  const start = from ? new Date(`${from}T00:00:00+05:30`) : todayStart();
  const end = to ? new Date(Date.parse(`${to}T00:00:00+05:30`) + 86400000) : new Date(Math.max(Date.now(), +start) + 1);
  if (+end <= +start || +end - +start > 92 * 86400000) throw badRequest('Choose a date range of up to 92 days.');
  const byProvider = provider === 'GROQ' ? { $or: [{ provider }, { provider: { $exists: false }, outbound: true }] } : provider ? { provider } : {};
  return { ...filters, ...byProvider, createdAt: { $gte: start, $lt: end } };
}
const stats = {
  requests: { $sum: { $cond: [{ $ne: ['$recordKind', 'ATTEMPT'] }, 1, 0] } },
  backupAttempts: { $sum: { $cond: [{ $and: ['$outbound', { $ne: [{ $ifNull: ['$failoverReason', null] }, null] }] }, 1, 0] } },
  costUsd: { $sum: '$costUsd' }, knownCost: { $sum: { $cond: [{ $isNumber: '$costUsd' }, 1, 0] } }, outbound: { $sum: { $cond: ['$outbound', 1, 0] } },
  local: { $sum: { $cond: ['$local', 1, 0] } }, input: { $sum: '$input' }, output: { $sum: '$output' }, total: { $sum: '$total' },
  unknownTokens: { $sum: { $cond: [{ $and: ['$outbound', { $eq: [{ $ifNull: ['$total', null] }, null] }] }, 1, 0] } },
  success: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
  failed: { $sum: { $cond: [{ $in: ['$status', ['FAILED', 'RATE_LIMITED']] }, 1, 0] } },
  rateLimited: { $sum: { $cond: [{ $eq: ['$status', 'RATE_LIMITED'] }, 1, 0] } },
  averageLatency: { $avg: '$latency' },
};
adminAi.get('/usage', async (req, res) => {
  const filter = usageFilter(parse(analyticsQuery, req.query));
  const daily = { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } };
  const [summary] = await AiUsage.aggregate([{ $match: filter }, { $facet: {
    workloads: [{ $group: { _id: '$workload', ...stats, users: { $addToSet: '$userId' } } }, { $set: { uniqueUsers: { $size: '$users' } } }, { $unset: 'users' }],
    daily: [{ $group: { _id: { day: daily, workload: '$workload' }, ...stats } }, { $sort: { '_id.day': 1 } }],
    actions: [{ $group: { _id: '$action', ...stats } }, { $sort: { requests: -1 } }, { $limit: 30 }],
    problems: [{ $match: { problemId: { $type: 'string' } } }, { $group: { _id: '$problemId', ...stats } }, { $sort: { requests: -1 } }, { $limit: 20 }],
    providers: [{ $match: { outbound: true } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$configId', ...stats, quota: { $first: '$quota' }, lastStatus: { $first: '$status' }, lastFailure: { $first: '$failure' }, observed: { $first: '$createdAt' } } }],
  } }]);
  const history = await AiUsage.aggregate([{ $match: { configId: { $type: 'string' }, outbound: true } },
    { $sort: { createdAt: -1 } }, { $group: { _id: '$configId', ...stats, lastObserved: { $first: '$createdAt' }, quota: { $first: '$quota' },
      lastSuccess: { $max: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, '$finishedAt', null] } }, lastFailureAt: { $max: { $cond: [{ $in: ['$status', ['FAILED', 'RATE_LIMITED']] }, '$finishedAt', null] } } } }, { $sort: { lastObserved: -1 } }, { $limit: 100 }]);
  res.json({ ...summary, history });
});
adminAi.get('/usage/export', async (req, res) => {
  const query = parse(analyticsQuery, req.query);
  const rows = await AiUsage.find(usageFilter(query), exportFields.join(' ')).sort({ createdAt: -1 }).limit(10001).lean();
  if (rows.length > 10000) throw badRequest('Narrow the date range or add filters to export fewer than 10,001 events.');
  const values = rows.map((row) => exportFields.map((field) => row[field] instanceof Date ? (row[field] as Date).toISOString() : row[field]));
  await audit(req, 'ai.usage.export', { type: 'AiUsage', id: query.format }, { rows: rows.length });
  if (query.format === 'xlsx') {
    res.attachment('algora-ai-usage.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await toXlsx([...exportFields], values, 'AI usage'));
  } else {
    res.attachment('algora-ai-usage.csv').type('text/csv').send(toCsv([...exportFields], values));
  }
});
