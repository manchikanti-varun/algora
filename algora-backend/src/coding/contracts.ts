import { z } from 'zod';
import type { CurriculumUnit } from '../curriculum/contracts.js';
import { idSchema } from '../administration/contracts.js';
export const platforms = ['CODEFORCES', 'LEETCODE', 'CODECHEF'] as const;
export type Platform = (typeof platforms)[number];
export const ownershipStates = [
  'UNLINKED',
  'PENDING_VERIFICATION',
  'VERIFIED',
  'VERIFICATION_UNAVAILABLE',
  'REVOKED',
] as const;
export const progressStates = [
  'NOT_STARTED',
  'ATTEMPTED_VERIFIED',
  'SOLVED_VERIFIED',
  'VERIFICATION_UNAVAILABLE',
] as const;
export type ProgressState = (typeof progressStates)[number];
export const jobStates = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'RETRY_WAIT',
  'FAILED',
  'CANCELLED',
] as const;
export const activeJobStates = ['QUEUED', 'RUNNING', 'RETRY_WAIT'];
export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const linkSchema = z
  .object({
    platform: z.enum(platforms),
    handle: handleSchema,
    expectedRevision: z.number().int().nonnegative().nullable(),
    confirmed: z.literal(true),
  })
  .strict();
export const confirmSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();
export const refreshSchema = z
  .object({
    platform: z.enum(platforms),
    studentProfileId: idSchema.optional(),
    confirmed: z.literal(true),
  })
  .strict();
export const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(10),
    assignmentPage: z.coerce.number().int().min(1).max(1000).default(1),
    day: z.coerce.number().int().min(1).max(1000000000).optional(),
    platform: z.enum(platforms).optional(),
    status: z.enum(progressStates).optional(),
    verification: z.enum(ownershipStates).optional(),
    studentProfileId: idSchema.optional(),
    problemId: idSchema.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Invalid date range');
export type Query = z.infer<typeof querySchema>;
export interface Account {
  id: string;
  studentProfileId: string;
  userId: string;
  platform: Platform;
  handle: string;
  normalizedHandle: string;
  status: (typeof ownershipStates)[number];
  active: boolean;
  revision: number;
  subject?: string;
  method: 'OIDC' | 'UNAVAILABLE';
  registrationTimeSeconds?: number;
  verifiedAt?: string;
  proofExpiresAt?: string;
  proofDigest?: string;
  syncStatus:
    | 'NEVER_CHECKED'
    | 'QUEUED'
    | 'RUNNING'
    | 'SUCCESS'
    | 'PARTIAL'
    | 'RATE_LIMITED'
    | 'FAILED'
    | 'PROVIDER_UNAVAILABLE';
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  nextSyncAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface OAuthState {
  id: string;
  stateHash: string;
  userId: string;
  sessionHash: string;
  accountId: string;
  accountRevision: number;
  nonce: string;
  expiresAt: string;
}
export interface Submission {
  id: string;
  problemKey: string;
  handle: string;
  verdict: string;
  accepted: boolean;
  language: string;
  submittedAt: string;
  sourceUrl: string;
  digest: string;
}
export interface ProviderPage {
  submissions: Submission[];
  nextOffset: number | null;
  complete: boolean;
  partial: boolean;
}
export interface Adapter {
  platform: Platform;
  available: boolean;
  reason: string;
  version: string;
  identity?(handle: string): Promise<number>;
  fetchPage(handle: string, offset: number): Promise<ProviderPage>;
}
export interface Assignment {
  difficulty: string;
  id: string;
  dayId: string;
  dayNumber: number;
  problemId: string;
  platform: Platform;
  problemKey: string;
  title: string;
  url: string;
}
export interface Evidence extends Submission {
  evidenceId: string;
  platform: Platform;
  accountId: string;
  accountRevision: number;
  studentProfileId: string;
  batchId: string;
  curriculumRevisionId: string;
  enrollmentId: string;
  assignmentId: string;
  problemId: string;
  fetchedAt: string;
  adapterVersion: string;
  sourceType: 'OFFICIAL_API';
  confidence: 'TRUSTED';
}
export interface Progress {
  id: string;
  studentProfileId: string;
  batchId: string;
  curriculumRevisionId: string;
  enrollmentId: string;
  assignmentId: string;
  problemId: string;
  platform: Platform;
  accountId: string;
  accountRevision: number;
  status: 'ATTEMPTED_VERIFIED' | 'SOLVED_VERIFIED';
  firstAttemptAt: string;
  solvedAt?: string;
  latestEvidenceId: string;
  updatedAt: string;
}
export interface Job {
  id: string;
  accountId: string;
  accountRevision: number;
  studentProfileId: string;
  userId: string;
  actorId: string;
  batchId: string;
  curriculumRevisionId: string;
  enrollmentId: string;
  eligibleAfter: string;
  status: (typeof jobStates)[number];
  active: boolean;
  offset: number;
  pages: number;
  attempts: number;
  nextAt: string;
  leaseUntil?: string;
  leaseToken?: string;
  error?: string;
  coverage: 'UNKNOWN' | 'PARTIAL' | 'COMPLETE';
  createdAt: string;
  updatedAt: string;
}
export interface ProgressUnit {
  curriculum: CurriculumUnit;
  accounts(profile: string): Promise<Account[]>;
  account(id: string): Promise<Account | null>;
  accountFor(profile: string, platform: Platform): Promise<Account | null>;
  saveAccount(data: Account, expected: number | null): Promise<Account>;
  lockAccount(id: string, revision: number): Promise<boolean>;
  insertOAuth(data: OAuthState): Promise<void>;
  consumeOAuth(
    hash: string,
    user: string,
    session: string,
    now: string,
  ): Promise<OAuthState | null>;
  jobs(account: string, batch?: string): Promise<Job[]>;
  job(id: string): Promise<Job | null>;
  queue(job: Job, now: string): Promise<Job>;
  saveJob(job: Job, leaseToken: string): Promise<boolean>;
  progress(
    profile: string,
    batch: string,
    enrollment: string,
  ): Promise<Progress[]>;
  putProgress(data: Progress): Promise<void>;
  insertEvidence(data: Evidence): Promise<boolean>;
  evidence(
    profile: string,
    batch: string,
    assignment: string,
    enrollment: string,
  ): Promise<Evidence[]>;
  lockEligibility(profile: string, enrollment: string): Promise<boolean>;
}
export interface ProgressRepository {
  ensureReady(): Promise<void>;
  read: ProgressUnit;
  transaction<T>(work: (tx: ProgressUnit) => Promise<T>): Promise<T>;
  claim(now: string, token: string): Promise<Job | null>;
  reserveProvider(now: string, token: string): Promise<boolean>;
  releaseProvider(token: string, until: string): Promise<void>;
  scheduled(now: string, limit: number): Promise<Account[]>;
}
