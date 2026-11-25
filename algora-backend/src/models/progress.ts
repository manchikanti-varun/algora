import { Schema, model, Types } from 'mongoose';

const oid = (ref: string, required = true) => ({ type: Types.ObjectId, ref, required });

/**
 * DERIVED per-context view. Canonical facts live in `solve_evidence`; this is rebuildable from
 * evidence + enrollment + batch_courses + problems and is never the source of truth.
 */
const progressSchema = new Schema(
  {
    studentId: oid('User'),
    batchCourseId: oid('BatchCourse'),
    problemId: oid('Problem'),
    slug: { type: String, required: true },
    status: { type: String, enum: ['VERIFIED', 'PENDING', 'UNVERIFIED'], default: 'UNVERIFIED' },
    evidenceId: oid('SolveEvidence', false),
    verifiedAt: Date, // copied from evidence
    solvedAt: Date,
  },
  { timestamps: true },
);
progressSchema.index({ studentId: 1, batchCourseId: 1, problemId: 1 }, { unique: true });
progressSchema.index({ batchCourseId: 1, status: 1 });
progressSchema.index({ evidenceId: 1 });
export const ProblemProgress = model('ProblemProgress', progressSchema, 'problem_progress');

const syncLogSchema = new Schema({
  runId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['JOB', 'STUDENT'], required: true },
  studentId: oid('User', false),
  status: { type: String, enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'], required: true },
  startedAt: { type: Date, default: Date.now },
  finishedAt: Date,
  fence: Number, // fencing token of the lease this run held
  counts: { type: Map, of: Number },
  error: String,
  trigger: { type: String, enum: ['SCHEDULE', 'MANUAL'] },
  provider: String,
});
syncLogSchema.index({ studentId: 1, startedAt: -1 });
syncLogSchema.index({ startedAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 }); // keep logs 60 days
export const LeetcodeSyncLog = model('LeetcodeSyncLog', syncLogSchema, 'leetcode_sync_logs');

const snapSchema = new Schema({
  scopeType: { type: String, enum: ['BATCH_COURSE', 'COURSE', 'BATCH'], required: true },
  batchId: oid('Batch', false),
  courseId: oid('Course', false),
  capturedAt: { type: Date, default: Date.now },
  entries: [{ _id: false, studentId: Types.ObjectId, solved: Number, points: Number, rank: Number }],
});
snapSchema.index({ scopeType: 1, batchId: 1, courseId: 1, capturedAt: -1 });
export const LeaderboardSnapshot = model('LeaderboardSnapshot', snapSchema, 'leaderboard_snapshots');

const auditSchema = new Schema({
  actorId: oid('User', false),
  actorRole: String,
  action: { type: String, required: true },
  targetType: String,
  targetId: String,
  metadata: Schema.Types.Mixed,
  ip: String,
  createdAt: { type: Date, default: Date.now },
});
auditSchema.index({ createdAt: -1 });
auditSchema.index({ actorId: 1, createdAt: -1 });
auditSchema.index({ targetType: 1, targetId: 1 });
export const AuditLog = model('AuditLog', auditSchema, 'audit_logs');

/** Distributed lease for background jobs. One document per job key; `fence` only ever increases. */
export const JobLease = model(
  'JobLease',
  new Schema({
    _id: { type: String },
    owner: { type: String, required: true },
    fence: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
    lastWriteAt: Date,
  }),
  'job_leases',
);

/** Global rate-limit bucket (see lib/ratelimit.ts). */
export const RateBucket = model(
  'RateBucket',
  new Schema({ _id: String, tokens: Number, ts: Date, granted: Boolean }),
  'rate_buckets',
);

/**
 * LeetCode account link. A link records which public account a student says is theirs; it is NOT proof of ownership.
 * Lifecycle: LINKED -> SUPERSEDED (replaced by a username change) | REVOKED (unlinked or consent withdrawn).
 * "Unlinked" is the absence of an active link. A username change creates a NEW link, so evidence from an old link is never
 * silently restored by changing the username back.
 *
 * PENDING_VERIFICATION, VERIFIED and REVALIDATION_REQUIRED are legacy states kept only so rows written before ownership
 * verification was removed still validate. VERIFIED counts as linked (migration rewrites it to LINKED); the other two do not.
 */
export const LINK_STATUSES = ['LINKED', 'PENDING_VERIFICATION', 'VERIFIED', 'REVALIDATION_REQUIRED', 'SUPERSEDED', 'REVOKED'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];
/** Statuses whose evidence counts: the student's currently linked account. */
export const COUNTING_LINK_STATUSES = ['LINKED', 'VERIFIED'] as const;
export const linkFlags = (status: LinkStatus) => ({
  isActive: status === 'LINKED' || status === 'PENDING_VERIFICATION' || status === 'VERIFIED' || status === 'REVALIDATION_REQUIRED', // reserves the username
  isCurrent: status === 'LINKED' || status === 'VERIFIED' || status === 'REVALIDATION_REQUIRED', // the student's established link (at most one)
  isPending: status === 'PENDING_VERIFICATION', // legacy: a not-yet-proven request (at most one)
});
const linkSchema = new Schema(
  {
    studentId: oid('User'),
    username: { type: String, required: true, trim: true },
    usernameNorm: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: LINK_STATUSES, required: true },
    isActive: { type: Boolean, required: true },
    isCurrent: { type: Boolean, required: true },
    isPending: { type: Boolean, required: true },
    kind: { type: String, enum: ['INITIAL', 'CHANGE'], default: 'INITIAL' },
    replacesLinkId: oid('LeetcodeLink', false),
    /** Challenge the student places in their public LeetCode profile summary. Not a secret. */
    /** Legacy ownership-verification fields. Kept so historical rows validate; nothing writes them anymore. */
    challenge: String,
    challengeIssuedAt: Date,
    lastVerifyAttemptAt: Date,
    verifiedAt: Date,
    lastValidatedAt: Date,
    linkedAt: Date,
    requestedAt: { type: Date, default: Date.now },
    /** Student agreed to Algora reading this account's public accepted submissions. Required for any synchronization. */
    consentedAt: Date,
    endedAt: Date,
    endedReason: String,
    endedBy: oid('User', false),
  },
  { timestamps: true },
);
linkSchema.index({ usernameNorm: 1 }, { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active_link_per_username' });
linkSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_link_per_student' });
linkSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { isPending: true }, name: 'one_pending_link_per_student' });
linkSchema.index({ studentId: 1, createdAt: -1 });
linkSchema.index({ studentId: 1, status: 1 });
linkSchema.index({ status: 1, studentId: 1 }); // scheduler: verified links among enrolled students
export const LeetcodeLink = model('LeetcodeLink', linkSchema, 'leetcode_links');

/**
 * Canonical, student-level proof that a LeetCode problem (by slug) was solved through one verified link.
 * Independent of batches and courses. Chapter visibility and enrollment decide whether it counts in a context.
 *
 * Only AUTOMATED_PROVIDER evidence (and MOCK_DEV outside production) is written or counted. STUDENT_SELF_REPORT and
 * TRAINER_ATTESTATION are LEGACY values: nothing writes them, they never count, and they are never deleted.
 * `source` is part of the unique key, so legacy or mock rows can never block real automated evidence.
 */
export const EVIDENCE_SOURCES = ['AUTOMATED_PROVIDER', 'MOCK_DEV', 'STUDENT_SELF_REPORT', 'TRAINER_ATTESTATION'] as const;
export const COUNTING_SOURCES = ['AUTOMATED_PROVIDER', 'MOCK_DEV'] as const;
const evidenceSchema = new Schema(
  {
    studentId: oid('User'),
    linkId: oid('LeetcodeLink', false), // absent only on legacy rows
    slug: { type: String, required: true, lowercase: true },
    leetcodeUsername: { type: String, required: true, lowercase: true },
    title: String,
    status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], required: true },
    source: { type: String, enum: EVIDENCE_SOURCES, required: true },
    provider: String, // provider of the most recent confirmation
    providers: { type: [String], default: [] }, // every provider that has confirmed this problem
    submissionId: { type: String, default: null }, // nullable: never fabricated
    /** Earliest accepted submission timestamp Algora has OBSERVED. Not necessarily the student's first-ever accepted submission. */
    earliestObservedSolvedAt: Date,
    /** Most recent accepted submission timestamp observed. */
    latestObservedSolvedAt: Date,
    /** Distinct submission timestamps observed (for date-range reporting). */
    observedAt: { type: [Date], default: [] },
    firstVerifiedAt: Date, // first time Algora confirmed this evidence
    lastVerifiedAt: Date, // most recent confirmation
  },
  { timestamps: true },
);
evidenceSchema.index({ studentId: 1, slug: 1, leetcodeUsername: 1, source: 1, linkId: 1 }, { unique: true });
evidenceSchema.index({ studentId: 1, linkId: 1, status: 1 });
evidenceSchema.index({ slug: 1, status: 1 });
evidenceSchema.index({ linkId: 1, slug: 1, status: 1 }); // scoring: evidence of verified links in a scope
export const SolveEvidence = model('SolveEvidence', evidenceSchema, 'solve_evidence');

/**
 * Shared, cross-instance provider health. One document per provider (`provider:<id>`) and one for each upstream
 * (`upstream:leetcode-graphql`). Counters use atomic $inc; the circuit breaker lives here so every instance agrees.
 */
export const ProviderState = model(
  'ProviderState',
  new Schema(
    {
      _id: String,
      kind: { type: String, enum: ['PROVIDER', 'UPSTREAM'], required: true },
      totalRequests: { type: Number, default: 0 },
      successes: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
      rateLimited: { type: Number, default: 0 },
      consecutiveFailures: { type: Number, default: 0 },
      latencyEwmaMs: Number,
      acceptedRetrievals: Number,
      lastAcceptedRetrievalAt: Date,
      lastSuccessAt: Date,
      lastFailureAt: Date,
      lastError: String,
      lastErrorKind: String,
      openedAt: Date, // circuit breaker opened
      openCount: { type: Number, default: 0 },
      probeUntil: Date, // a half-open probe is in flight until this time (one per cluster)
      rateLimitedUntil: Date, // provider's own rate limit (Retry-After)
      // upstream only
      blockedUntil: Date,
      blockedReason: String,
      networkFailures: { type: [{ _id: false, provider: String, at: Date }], default: [] },
    },
    { timestamps: true },
  ),
  'provider_state',
);

const eventSchema = new Schema({
  type: { type: String, enum: ['FAILOVER', 'PROVIDER_ERROR', 'UPSTREAM_BLOCK', 'CIRCUIT_OPEN', 'CIRCUIT_CLOSED', 'HEALTH_CHECK', 'ALL_FAILED'], required: true },
  provider: String,
  toProvider: String,
  kind: String,
  message: String,
  studentId: { type: Types.ObjectId, ref: 'User' },
  at: { type: Date, default: Date.now },
});
eventSchema.index({ at: -1 });
eventSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
export const ProviderEvent = model('ProviderEvent', eventSchema, 'provider_events');

/**
 * Short-lived cache of account-existence probes, so an empty submission window does not cause a second request on every sync.
 * Shared across instances; documents expire automatically. Never contains submission data.
 */
export const AccountProbe = model(
  'AccountProbe',
  new Schema(
    {
      _id: String, // `probe:<provider>:<normalised username>`
      provider: { type: String, required: true },
      usernameNorm: { type: String, required: true },
      exists: { type: Boolean, required: true },
      /** Solve counts in the public submission calendar, when the provider reports them. */
      calendarTotal: { type: Number, default: null },
      checkedAt: { type: Date, default: Date.now },
      expiresAt: { type: Date, required: true },
    },
    { timestamps: true },
  ),
  'account_probes',
);
// Expired probes are removed by MongoDB itself (TTL 0 = delete at expiresAt).
AccountProbe.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Submission ids seen per verified link (only when a provider returns ids). Used to detect cross-provider conflicts. */
const obsSchema = new Schema({
  linkId: oid('LeetcodeLink'),
  studentId: oid('User'),
  submissionId: { type: String, required: true },
  slug: { type: String, required: true },
  submittedAt: Date,
  providers: { type: [String], default: [] },
  firstSeenAt: { type: Date, default: Date.now },
});
obsSchema.index({ linkId: 1, submissionId: 1 }, { unique: true });
obsSchema.index({ studentId: 1 });
export const ObservedSubmission = model('ObservedSubmission', obsSchema, 'observed_submissions');

/** Disagreements between providers. Conflicting data is never used to award or extend verification. */
const conflictSchema = new Schema({
  studentId: oid('User'),
  linkId: oid('LeetcodeLink'),
  type: { type: String, enum: ['SUBMISSION_SLUG_MISMATCH', 'TIMESTAMP_MISMATCH', 'FUTURE_TIMESTAMP'], required: true },
  submissionId: String,
  slug: String,
  expected: Schema.Types.Mixed,
  received: Schema.Types.Mixed,
  provider: String,
  at: { type: Date, default: Date.now },
});
conflictSchema.index({ studentId: 1, at: -1 });
conflictSchema.index({ at: -1 });
export const EvidenceConflict = model('EvidenceConflict', conflictSchema, 'evidence_conflicts');
