import { model, Schema } from 'mongoose';

const mixed = Schema.Types.Mixed;
const scope = { workload: String, userId: String, batchId: String, courseId: String, chapterId: String, problemId: String };

export const AiSettings = model('AiSettings', new Schema({
  _id: String, enabled: Boolean, activeId: String, limits: mixed,
  mode: String, recovery: String, maxBackups: Number, paidAllowed: Boolean, servingId: String,
}), 'ai_settings');

const provider = new Schema({
  workload: String, slot: Number, name: String, model: String, organization: String, project: String, quotaGroup: String,
  encrypted: String, masked: String, plan: String, version: Number, limits: mixed, archivedAt: Date, lastTest: mixed,
  provider: String, endpoint: String, enabled: Boolean, backup: Boolean, priority: Number, independent: Boolean, quotaScope: String,
  outputMode: String, timeoutMs: Number, inputLimit: Number, outputLimit: Number, paidApproved: Boolean, spending: mixed,
  circuitUntil: Date, circuitReason: String,
}, { timestamps: true });
provider.index({ workload: 1, slot: 1 }, { unique: true, partialFilterExpression: { slot: { $type: 'number' } } });
export const AiProvider = model('AiProvider', provider, 'ai_provider_configs');

export const AiBatch = model('AiBatch', new Schema({
  _id: String, enabled: Boolean, daily: Number, courseIds: [String], startsAt: Date, endsAt: Date, startMinute: Number, endMinute: Number,
}, { timestamps: true }), 'ai_batch_settings');

const conversation = new Schema({ ...scope, batchCourseId: String, language: String, turns: [mixed], level: Number, expiresAt: Date }, { timestamps: true });
conversation.index({ workload: 1, userId: 1, batchCourseId: 1, chapterId: 1, problemId: 1, updatedAt: -1 });
conversation.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiConversation = model('AiConversation', conversation, 'ai_conversations');

const usage = new Schema({
  ...scope, role: String, collegeId: String, action: String, referenceId: String, requestKey: String,
  configId: String, configVersion: Number, model: String, status: String, outbound: Boolean, local: Boolean,
  provider: String, logicalId: String, recordKind: String, attempt: Number, failoverReason: String, costUsd: Number, costEstimated: Boolean,
  providerStatus: Number, failure: String, providerCode: String, providerParam: String, providerRequestId: String, input: Number, output: Number, total: Number, latency: Number,
  quota: mixed, finishedAt: Date,
}, { timestamps: true });
usage.index({ workload: 1, createdAt: -1 });
usage.index({ configId: 1, createdAt: -1 });
usage.index({ logicalId: 1 });
usage.index({ workload: 1, userId: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });
export const AiUsage = model('AiUsage', usage, 'ai_usage_events');

const counter = new Schema({ _id: String, requests: Number, tokens: Number, expiresAt: Date });
counter.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiCounter = model('AiCounter', counter, 'ai_usage_counters');

const preparation = new Schema({
  _id: String, fingerprint: String, language: String, content: mixed, version: Number, status: String, model: String, provider: String, configId: String, configVersion: Number,
  promptVersion: Number, generatedAt: Date, editedBy: String, reviewedBy: String, reviewedAt: Date, sectionReviews: mixed, history: [mixed],
}, { timestamps: true });
export const AiPreparation = model('AiPreparation', preparation, 'ai_preparations');

const hint = new Schema({
  _id: String, catalogId: String, courseId: String, language: String, level: Number, text: String,
  status: String, author: String, reviewer: String, version: Number, history: [mixed],
}, { timestamps: true });
hint.index({ catalogId: 1, courseId: 1, language: 1, level: 1, status: 1 });
export const AiHint = model('AiHint', hint, 'ai_problem_hints');

const job = new Schema({
  ...scope, language: String, signature: String, status: String, active: Boolean, tasks: [mixed],
  availableAt: Date, expiresAt: Date,
}, { timestamps: true });
job.index({ signature: 1 }, { unique: true, partialFilterExpression: { active: true } });
job.index({ active: 1, availableAt: 1 });
job.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AiJob = model('AiJob', job, 'ai_preparation_jobs');

export const AiPractice = model('AiPractice', new Schema({ _id: String, batchCourseId: String, problemId: String }), 'ai_practice');
