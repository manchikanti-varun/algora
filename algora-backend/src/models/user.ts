import { Schema, model, Types, type InferSchemaType } from 'mongoose';

export const ROLES = ['SUPER_ADMIN', 'TRAINER', 'STUDENT'] as const;
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    googleSub: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE', required: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    fullName: { type: String, required: true, trim: true },
    picture: String,
    /** Incrementing this invalidates every existing session for the user. */
    sessionVersion: { type: Number, default: 0 },
    lastLoginAt: Date,
    // Trainer
    trainerId: { type: String, unique: true, sparse: true },
    canManageCourses: { type: Boolean, default: false },
    approvedBy: { type: Types.ObjectId, ref: 'User' },
    // Student
    rollNumber: { type: String, unique: true, sparse: true, match: /^[A-Z0-9]{10}$/ },
    collegeId: { type: Types.ObjectId, ref: 'College' },
    mobile: String,
    leetcodeUsername: { type: String, trim: true },
    leetcodeUsernameChangedAt: Date,
    /** LeetCode sync state (per student). Evidence itself lives in solve_evidence. */
    sync: {
      status: {
        type: String,
        enum: ['IDLE', 'SYNCING', 'SYNC_PENDING', 'SYNC_SUCCESS', 'POSSIBLE_EVIDENCE_GAP', 'NO_SUBMISSIONS_OBSERVED', 'SUBMISSIONS_UNAVAILABLE', 'ACCOUNT_NOT_FOUND', 'SYNC_FAILED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'VERIFICATION_UNAVAILABLE', 'SYNC_PAUSED'],
        default: 'IDLE',
      },
      /** Extra detail for the last result (e.g. INCOMPLETE_VISIBILITY, ACCOUNT_PROBE_UNAVAILABLE). */
      statusDetail: String,
      lastProvider: String,
      coverage: { type: String, enum: ['FULL', 'REDUCED'] },
      lastAttemptAt: Date,
      lastSuccessAt: Date,
      lastError: String,
      consecutiveFailures: { type: Number, default: 0 },
      nextEligibleAt: Date,
      lastActiveAt: Date,
      possibleGap: { type: Boolean, default: false },
    },
    deletedAt: Date,
  },
  { timestamps: true },
);
// Enforce at most one active Super Admin at the database level.
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'SUPER_ADMIN', status: 'ACTIVE' }, name: 'single_active_super_admin' },
);
userSchema.index({ role: 1, status: 1 });
userSchema.index({ collegeId: 1 });
userSchema.index({ leetcodeUsername: 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model('User', userSchema, 'users');
