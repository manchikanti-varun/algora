import { Schema, model } from 'mongoose';
import {
  platforms,
  ownershipStates,
  jobStates,
  progressStates,
} from '../coding/contracts.js';
const options = {
  strict: 'throw' as const,
  autoIndex: false,
  timestamps: true,
};
const required = { type: String, required: true };
const account = new Schema(
  {
    studentProfileId: required,
    userId: required,
    platform: { type: String, enum: platforms, required: true },
    handle: required,
    normalizedHandle: required,
    status: { type: String, enum: ownershipStates, required: true },
    active: { type: Boolean, required: true },
    revision: { type: Number, required: true },
    operationalRevision: { type: Number, default: 0 },
    subject: String,
    method: { type: String, enum: ['OIDC', 'UNAVAILABLE'], required: true },
    registrationTimeSeconds: Number,
    verifiedAt: String,
    proofExpiresAt: String,
    proofDigest: String,
    syncStatus: {
      type: String,
      enum: [
        'NEVER_CHECKED',
        'QUEUED',
        'RUNNING',
        'SUCCESS',
        'PARTIAL',
        'RATE_LIMITED',
        'FAILED',
        'PROVIDER_UNAVAILABLE',
      ],
      required: true,
    },
    lastCheckedAt: String,
    lastSuccessAt: String,
    lastError: String,
    nextSyncAt: required,
  },
  options,
);
account.index({ studentProfileId: 1, platform: 1 }, { unique: true });
account.index(
  { platform: 1, subject: 1 },
  {
    unique: true,
    partialFilterExpression: {
      active: true,
      status: 'VERIFIED',
      subject: { $type: 'string' },
    },
  },
);
account.index(
  { platform: 1, normalizedHandle: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, status: 'VERIFIED' },
  },
);
account.index({ active: 1, status: 1, nextSyncAt: 1 });
export const StudentCodingAccount = model('StudentCodingAccount', account);
const oauth = new Schema(
  {
    stateHash: { ...required, unique: true },
    userId: required,
    sessionHash: required,
    accountId: required,
    accountRevision: { type: Number, required: true },
    nonce: required,
    expiresAt: { type: Date, required: true },
  },
  options,
);
oauth.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const CodingOAuthState = model('CodingOAuthState', oauth);
const job = new Schema(
  {
    accountId: required,
    accountRevision: { type: Number, required: true },
    studentProfileId: required,
    userId: required,
    actorId: required,
    batchId: required,
    curriculumRevisionId: required,
    enrollmentId: required,
    eligibleAfter: required,
    status: { type: String, enum: jobStates, required: true },
    active: { type: Boolean, required: true },
    offset: { type: Number, min: 1, required: true },
    pages: { type: Number, required: true },
    attempts: { type: Number, required: true },
    nextAt: required,
    leaseUntil: String,
    leaseToken: String,
    error: String,
    coverage: {
      type: String,
      enum: ['UNKNOWN', 'PARTIAL', 'COMPLETE'],
      required: true,
    },
  },
  options,
);
job.index(
  { accountId: 1, batchId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
job.index({ active: 1, nextAt: 1, leaseUntil: 1 });
job.index({ batchId: 1, createdAt: -1 });
export const CodingSyncJob = model('CodingSyncJob', job);
const progress = new Schema(
  {
    studentProfileId: required,
    batchId: required,
    curriculumRevisionId: required,
    enrollmentId: required,
    assignmentId: required,
    problemId: required,
    platform: { type: String, enum: platforms, required: true },
    accountId: required,
    accountRevision: { type: Number, required: true },
    status: { type: String, enum: progressStates, required: true },
    firstAttemptAt: required,
    solvedAt: String,
    latestEvidenceId: required,
  },
  options,
);
progress.index(
  {
    studentProfileId: 1,
    batchId: 1,
    curriculumRevisionId: 1,
    enrollmentId: 1,
    assignmentId: 1,
  },
  { unique: true },
);
progress.index({ batchId: 1, problemId: 1, status: 1 });
export const StudentProblemProgress = model('StudentProblemProgress', progress);
const immutable = { type: String, required: true, immutable: true };
const evidence = new Schema(
  {
    evidenceId: immutable,
    id: immutable,
    problemKey: immutable,
    handle: immutable,
    verdict: immutable,
    accepted: { type: Boolean, required: true, immutable: true },
    language: immutable,
    submittedAt: immutable,
    sourceUrl: immutable,
    digest: immutable,
    platform: { ...immutable, enum: platforms },
    accountId: immutable,
    accountRevision: { type: Number, required: true, immutable: true },
    studentProfileId: immutable,
    batchId: immutable,
    curriculumRevisionId: immutable,
    enrollmentId: immutable,
    assignmentId: immutable,
    problemId: immutable,
    fetchedAt: immutable,
    adapterVersion: immutable,
    sourceType: { ...immutable, enum: ['OFFICIAL_API'] },
    confidence: { ...immutable, enum: ['TRUSTED'] },
  },
  { ...options, timestamps: false, id: false },
);
evidence.index(
  {
    platform: 1,
    accountId: 1,
    accountRevision: 1,
    id: 1,
    digest: 1,
    batchId: 1,
    enrollmentId: 1,
    assignmentId: 1,
  },
  { unique: true },
);
evidence.index({
  studentProfileId: 1,
  batchId: 1,
  assignmentId: 1,
  enrollmentId: 1,
  submittedAt: -1,
});
evidence.pre('updateOne', function () {
  const update = this.getUpdate();
  if (
    !this.getOptions().upsert ||
    !update ||
    Array.isArray(update) ||
    Object.keys(update).some((k) => k !== '$setOnInsert')
  )
    throw new Error('Immutable coding evidence');
});
for (const operation of [
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const)
  evidence.pre(operation, function () {
    throw new Error('Immutable coding evidence');
  });
evidence.pre('save', function () {
  if (!this.isNew) throw new Error('Immutable coding evidence');
});
export const SubmissionEvidence = model('SubmissionEvidence', evidence);
const control = new Schema(
  {
    _id: String,
    nextAllowedAt: Date,
    leaseUntil: Date,
    token: String,
    revision: { type: Number, default: 0 },
  },
  options,
);
export const CodingProviderControl = model('CodingProviderControl', control);
export const codingModels = [
  StudentCodingAccount,
  CodingOAuthState,
  CodingSyncJob,
  StudentProblemProgress,
  SubmissionEvidence,
  CodingProviderControl,
];
