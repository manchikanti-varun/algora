// Test-only dependency injection. Production uses MongoDB, official APIs and OIDC.
import { AppError } from '../middleware/errors.js';
import { setupAttendance } from './attendance-setup.js';
import { newId } from './administration-fixtures.js';
import { CodingService } from '../coding/service.js';
import { adapters, parseCodeforces } from '../coding/providers.js';
import type { CodingOwnership } from '../coding/ownership.js';
import type {
  Account,
  Evidence,
  Job,
  OAuthState,
  Progress,
  ProgressRepository,
  ProgressUnit,
  Platform,
} from '../coding/contracts.js';
import type { TestCurriculum } from './curriculum-fixtures.js';
const copy = <T>(v: T): T => structuredClone(v);
export class TestCoding implements ProgressRepository {
  accounts = new Map<string, Account>();
  states = new Map<string, OAuthState>();
  jobs = new Map<string, Job>();
  rows = new Map<string, Progress>();
  evidence = new Map<string, Evidence>();
  providerUntil = 0;
  providerToken = '';
  providerLease = 0;
  now = () => new Date();
  constructor(public curriculum: TestCurriculum) {}
  ensureReady() {
    return this.curriculum.ensureReady();
  }
  async transaction<T>(work: (tx: ProgressUnit) => Promise<T>) {
    return this.curriculum.transaction(async () => {
      const snapshot = copy({
        accounts: this.accounts,
        states: this.states,
        jobs: this.jobs,
        rows: this.rows,
        evidence: this.evidence,
      });
      try {
        return await work(this.read);
      } catch (e) {
        Object.assign(this, snapshot);
        throw e;
      }
    });
  }
  get read(): ProgressUnit {
    return {
      curriculum: this.curriculum.read,
      accounts: async (p) =>
        copy(
          [...this.accounts.values()].filter((a) => a.studentProfileId === p),
        ),
      account: async (id) => copy(this.accounts.get(id) ?? null),
      accountFor: async (p, platform) =>
        copy(
          [...this.accounts.values()].find(
            (a) => a.studentProfileId === p && a.platform === platform,
          ) ?? null,
        ),
      saveAccount: async (a, revision) => {
        if ((this.accounts.get(a.id)?.revision ?? null) !== revision)
          throw new AppError(409, 'STALE_STATE', 'Account changed');
        if (
          a.active &&
          a.status === 'VERIFIED' &&
          [...this.accounts.values()].some(
            (v) =>
              v.id !== a.id &&
              v.active &&
              v.status === 'VERIFIED' &&
              v.platform === a.platform &&
              (v.normalizedHandle === a.normalizedHandle ||
                v.subject === a.subject),
          )
        )
          throw new AppError(
            409,
            'DUPLICATE_BINDING',
            'Account is already bound',
          );
        this.accounts.set(a.id, copy(a));
        return copy(a);
      },
      lockAccount: async (id, revision) =>
        this.accounts.get(id)?.revision === revision,
      insertOAuth: async (s) => {
        this.states.set(s.id, copy(s));
      },
      consumeOAuth: async (hash, user, session, now) => {
        const s = [...this.states.values()].find(
          (v) =>
            v.stateHash === hash &&
            v.userId === user &&
            v.sessionHash === session &&
            v.expiresAt > now,
        );
        if (!s) return null;
        this.states.delete(s.id);
        return copy(s);
      },
      jobs: async (account, batch) =>
        copy(
          [...this.jobs.values()]
            .filter(
              (j) => j.accountId === account && (!batch || j.batchId === batch),
            )
            .reverse()
            .slice(0, 20),
        ),
      job: async (id) => copy(this.jobs.get(id) ?? null),
      queue: async (j, now) => {
        const existing = [...this.jobs.values()].find(
          (v) =>
            v.active && v.accountId === j.accountId && v.batchId === j.batchId,
        );
        if (existing) return copy(existing);
        if (
          [...this.jobs.values()].some(
            (v) =>
              v.accountId === j.accountId &&
              v.batchId === j.batchId &&
              Date.parse(v.createdAt) > Date.parse(now) - 60000,
          )
        )
          throw new AppError(429, 'SYNC_COOLDOWN', 'Cooldown');
        this.jobs.set(j.id, copy(j));
        return copy(j);
      },
      saveJob: async (j, token) => {
        const old = this.jobs.get(j.id);
        if (
          !old ||
          !old.active ||
          old.status !== 'RUNNING' ||
          old.leaseToken !== token ||
          Date.parse(old.leaseUntil ?? '') <= this.now().getTime()
        )
          return false;
        this.jobs.set(j.id, copy(j));
        return true;
      },
      progress: async (p, b, e) =>
        copy(
          [...this.rows.values()].filter(
            (v) =>
              v.studentProfileId === p &&
              v.batchId === b &&
              v.enrollmentId === e,
          ),
        ),
      putProgress: async (p) => {
        this.rows.set(p.id, copy(p));
      },
      insertEvidence: async (e) => {
        if (this.evidence.has(e.evidenceId)) return false;
        this.evidence.set(e.evidenceId, copy(e));
        return true;
      },
      evidence: async (p, b, a, e) =>
        copy(
          [...this.evidence.values()].filter(
            (v) =>
              v.studentProfileId === p &&
              v.batchId === b &&
              v.assignmentId === a &&
              v.enrollmentId === e,
          ),
        ),
      lockEligibility: async (p, e) =>
        !!this.curriculum.learning.students.profiles.get(p) &&
        this.curriculum.learning.enrollments.get(e)?.status === 'ACTIVE',
    };
  }
  async claim(now: string, token: string) {
    const j = [...this.jobs.values()].find(
      (v) =>
        v.active &&
        ((['QUEUED', 'RETRY_WAIT'].includes(v.status) && v.nextAt <= now) ||
          (v.status === 'RUNNING' && (v.leaseUntil ?? '') <= now)),
    );
    if (!j) return null;
    j.status = 'RUNNING';
    j.leaseToken = token;
    j.leaseUntil = new Date(Date.parse(now) + 60000).toISOString();
    j.attempts++;
    return copy(j);
  }
  async reserveProvider(now: string, token: string) {
    const time = Date.parse(now);
    if (this.providerUntil > time || this.providerLease > time) return false;
    this.providerUntil = time + 3000;
    this.providerLease = time + 30000;
    this.providerToken = token;
    return true;
  }
  async releaseProvider(token: string, until: string) {
    if (this.providerToken === token) {
      this.providerUntil = Date.parse(until);
      this.providerLease = 0;
    }
  }
  async scheduled(now: string, limit: number) {
    return copy(
      [...this.accounts.values()]
        .filter(
          (a) => a.active && a.status === 'VERIFIED' && a.nextSyncAt <= now,
        )
        .slice(0, limit),
    );
  }
}
export const rawSubmission = (
  time: Date,
  patch: Record<string, unknown> = {},
) => ({
  id: 123456,
  creationTimeSeconds: Math.floor(time.getTime() / 1000),
  problem: { contestId: 123, index: 'A' },
  author: { members: [{ handle: 'learner' }] },
  programmingLanguage: 'GNU C++20',
  verdict: 'OK',
  testset: 'TESTS',
  ...patch,
});
export async function setupCoding() {
  const base = await setupAttendance(),
    repo = new TestCoding(base.repo.curriculum),
    student = await base.addStudent();
  let now = new Date(Date.now() + 10000);
  repo.now = () => now;
  const frozen = [...repo.curriculum.frozen.values()][0]!;
  const problemId = newId();
  frozen.problemAssignments = [
    {
      problemId,
      category: 'REQUIRED',
      instructorNote: '',
      editorialId: null,
      editorialVisibility: 'HIDDEN',
      problem: {
        id: problemId,
        title: 'Test problem',
        platform: 'CODEFORCES',
        platformProblemId: '123-A',
        url: 'https://codeforces.com/problemset/problem/123/A',
        difficulty: 'EASY',
        topics: [],
        description: '',
        ownerCollegeId: null,
        revision: 0,
        createdBy: base.owner.id,
        updatedBy: base.owner.id,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      editorial: null,
    },
  ];
  let response: unknown = {
    status: 'OK',
    result: [rawSubmission(new Date(now.getTime() - 2000))],
  };
  let providerError: Error | undefined;
  let calls = 0;
  let registration = 1000000000;
  const providers = {
    ...adapters,
    CODEFORCES: {
      ...adapters.CODEFORCES,
      identity: async () => registration,
      async fetchPage(handle: string, offset: number) {
        calls++;
        if (providerError) throw providerError;
        return parseCodeforces(response, handle, offset, now);
      },
    },
  };
  let identity = {
    subject: 'provider-subject',
    handle: 'learner',
    issuedAt: now.toISOString(),
  };
  let configured = true;
  const ownership: CodingOwnership = {
    configured: () => configured,
    authorize: (checks) =>
      'https://codeforces.com/oauth/authorize?' + new URLSearchParams(checks),
    verify: async () => identity,
  };
  const service = new CodingService(
    repo,
    base.learning,
    providers,
    ownership,
    () => now,
    async () => {},
  );
  async function link(
    platform: Platform = 'CODEFORCES',
    handle = 'learner',
    user = student.user.id,
  ) {
    return service.link(
      user,
      { platform, handle, expectedRevision: null, confirmed: true },
      'test',
    );
  }
  async function verify(accountId: string, user = student.user.id) {
    const a = (await repo.read.account(accountId))!;
    const begun = await service.beginOwnership(
      user,
      'session-bound',
      accountId,
      { expectedRevision: a.revision, confirmed: true },
      'test',
    );
    const state = new URL(begun.authorizationUrl).searchParams.get('state')!;
    const result = await service.finishOwnership(
      user,
      'session-bound',
      state,
      'test-code',
      'test',
    );
    now = new Date(now.getTime() + 3001);
    return result;
  }
  async function queue() {
    return service.refresh(
      student.user.id,
      base.batch,
      { platform: 'CODEFORCES', confirmed: true },
      'test',
    );
  }
  return {
    ...base,
    attendanceRepo: base.repo,
    repo,
    service,
    student,
    problemId,
    frozen,
    link,
    verify,
    queue,
    setNow: (value: Date) => {
      now = value;
    },
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
    getNow: () => now,
    setResponse: (value: unknown) => {
      response = value;
    },
    setRegistration: (value: number) => {
      registration = value;
    },
    setProviderError: (error?: Error) => {
      providerError = error;
    },
    calls: () => calls,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
    setConfigured: (value: boolean) => {
      configured = value;
    },
  };
}
