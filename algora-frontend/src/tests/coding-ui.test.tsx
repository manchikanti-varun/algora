import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CodingAccounts } from '@/features/coding/accounts';
import {
  StudentProgress,
  DayProgress,
  StaffProgress,
  ProgressBatches,
} from '@/features/coding/progress';
import {
  accountsSchema,
  progressItemSchema,
  evidenceSchema,
} from '@/features/coding/contracts';
const state = vi.hoisted(() => ({
  error: false,
  empty: false,
  verified: false,
  solved: false,
  ownership: false,
  authorization: 'https://codeforces.com/oauth/authorize?state=test',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
const batch = 'a'.repeat(24),
  profile = 'b'.repeat(24),
  assignment = 'c'.repeat(24),
  problem = 'd'.repeat(24);
const metrics = () => ({
  assigned: 1,
  solved: state.solved ? 1 : 0,
  attempted: 0,
  unavailable: state.solved ? 0 : 1,
  verifiedCoverage: state.solved ? 1 : 0,
  completionPercent: state.solved ? 100 : 0,
});
const item = () => ({
  id: assignment,
  dayId: 'day',
  dayNumber: 100,
  problemId: problem,
  platform: 'CODEFORCES',
  problemKey: '123-A',
  title: 'Arrays practice',
  url: 'https://codeforces.com/problemset/problem/123/A',
  status: state.solved ? 'SOLVED_VERIFIED' : 'VERIFICATION_UNAVAILABLE',
  reason: state.solved ? null : 'ACCOUNT_OWNERSHIP_REQUIRED',
  solvedAt: state.solved ? '2030-01-01T10:00:00.000Z' : null,
  firstAttemptAt: state.solved ? '2030-01-01T10:00:00.000Z' : null,
  latestEvidenceId: state.solved ? 'evidence' : null,
  syncStatus: 'NEVER_CHECKED',
});
const dashboard = () => ({
  batchId: batch,
  batchName: 'Foundation cohort',
  course: 'DSA foundations',
  studentProfileId: profile,
  enrollmentId: 'enrollment',
  eligibleAfter: '2030-01-01T00:00:00.000Z',
  summary: metrics(),
  filteredSummary: metrics(),
  platforms: [{ platform: 'CODEFORCES', ...metrics() }],
  days: [{ day: 100, ...metrics() }],
  items: state.empty ? [] : [item()],
  page: 1,
  pageSize: 10,
  total: state.empty ? 0 : 1,
  totalPages: 1,
  jobs: [
    {
      id: 'job',
      status: 'PARTIAL',
      coverage: 'PARTIAL',
      error: 'INCOMPLETE_PROVIDER_HISTORY',
      createdAt: '2030-01-01T10:00:00.000Z',
      updatedAt: '2030-01-01T10:00:00.000Z',
    },
  ],
});
const account = () => ({
  id: 'account',
  platform: 'CODEFORCES',
  handle: 'learner',
  status: state.verified ? 'VERIFIED' : 'PENDING_VERIFICATION',
  active: true,
  revision: 0,
  method: 'OIDC',
  verifiedAt: null,
  proofExpiresAt: null,
  syncStatus: 'NEVER_CHECKED',
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastError: null,
});
const accounts = () => ({
  accounts: state.empty ? [] : [account()],
  capabilities: ['CODEFORCES', 'LEETCODE', 'CODECHEF'].map((platform) => ({
    platform,
    submissions: platform === 'CODEFORCES',
    ownership: platform === 'CODEFORCES' && state.ownership,
    reason:
      platform === 'CODEFORCES'
        ? 'Official public API'
        : 'No approved submission integration',
    ownershipReason:
      platform === 'CODEFORCES'
        ? 'Official ownership setup required'
        : 'Verification unavailable',
  })),
});
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : {
            error: {
              code: 'UNAVAILABLE',
              message: 'Progress service unavailable',
            },
          },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
beforeEach(() => {
  Object.assign(state, {
    error: false,
    empty: false,
    verified: false,
    solved: false,
    ownership: false,
    authorization: 'https://codeforces.com/oauth/authorize?state=test',
  });
  URL.createObjectURL = vi.fn(() => 'blob:coding-test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown, init?: RequestInit) => {
      const path = String(raw);
      if (state.error) return response(null, 503);
      if (path.endsWith('/auth/csrf')) return response({ csrfToken: 'csrf' });
      if (init?.method === 'POST') {
        if (path.endsWith('/verify'))
          return response({ authorizationUrl: state.authorization });
        if (path.endsWith('/export'))
          return response({
            filename: 'coding.csv',
            mime: 'text/csv',
            base64: btoa('Batch,Student'),
            page: 1,
            totalPages: 1,
          });
        return response({ id: 'job', status: 'QUEUED' });
      }
      if (path.includes('/evidence'))
        return response({
          items: state.solved
            ? [
                {
                  id: 'evidence',
                  platform: 'CODEFORCES',
                  providerSubmissionId: '123456',
                  problemId: problem,
                  assignmentId: assignment,
                  handle: 'learner',
                  verdict: 'OK',
                  language: 'GNU C++20',
                  submittedAt: '2030-01-01T10:00:00.000Z',
                  fetchedAt: '2030-01-01T10:01:00.000Z',
                  sourceUrl:
                    'https://codeforces.com/contest/123/submission/123456',
                  sourceType: 'OFFICIAL_API',
                  confidence: 'TRUSTED',
                  adapterVersion: 'cf-api-v1/1',
                  accountRevision: 0,
                },
              ]
            : [],
        });
      if (path.includes('/analytics'))
        return response({
          items: [
            {
              id: assignment,
              dayNumber: 100,
              title: 'Arrays practice',
              platform: 'CODEFORCES',
              eligibleStudents: 1,
              solved: state.solved ? 1 : 0,
              attempted: 0,
              unavailable: state.solved ? 0 : 1,
              notStarted: 0,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        });
      if (path.includes('/coding/accounts')) return response(accounts());
      if (
        path.includes('/progress/batches') ||
        path.includes('/coding/batches')
      )
        return response({
          items: state.empty
            ? []
            : [
                {
                  id: batch,
                  name: 'Foundation cohort',
                  course: 'DSA foundations',
                },
              ],
          page: 1,
          totalPages: 1,
        });
      if (path.includes('/students/me/batches/')) return response(dashboard());
      if (path.includes('/progress'))
        return response({
          batchId: batch,
          batchName: 'Foundation cohort',
          items: [
            {
              id: profile,
              name: 'Example Learner',
              rollNumber: 'R000000001',
              ...dashboard(),
            },
          ],
          page: 1,
          pageSize: 10,
          total: 1,
          totalPages: 1,
        });
      return response({
        items: [],
        total: 0,
        totalPages: 0,
        page: 1,
        pageSize: 50,
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function show(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
it('renders all platform cards and honest unavailable integration notices', async () => {
  show(<CodingAccounts />);
  expect(await screen.findByText('learner')).toBeInTheDocument();
  expect(screen.getAllByText('Verification unavailable')).toHaveLength(2);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('renders unlinked empty account states without inventing verified accounts', async () => {
  state.empty = true;
  show(<CodingAccounts />);
  expect(await screen.findAllByText('No account linked')).toHaveLength(3);
  expect(screen.getAllByText('unlinked')).toHaveLength(3);
});
it('links handles with revision confirmation and CSRF', async () => {
  show(<CodingAccounts />);
  const input = await screen.findByLabelText(
    'Replace handle (invalidates current proof)',
  );
  fireEvent.change(input, { target: { value: 'replacement' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Save replacement handle' }),
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/coding/accounts') &&
            init?.method === 'POST' &&
            String(init.body).includes('replacement'),
        ),
    ).toBe(true),
  );
  const post = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/coding/accounts') && init?.method === 'POST',
    );
  expect(post?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
});
it('shows verified ownership separately from never-checked sync state', async () => {
  state.verified = true;
  show(<CodingAccounts />);
  expect(await screen.findByText('verified')).toBeInTheDocument();
  expect(screen.getByText('never checked')).toBeInTheDocument();
});
it('asks for explicit disconnect confirmation before revoking attribution', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  show(<CodingAccounts />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
  expect(window.confirm).toHaveBeenCalled();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/disconnect') && init?.method === 'POST',
      ),
  ).toBe(false);
});
it('rejects an unsafe ownership authorization destination', async () => {
  state.ownership = true;
  state.authorization = 'https://attacker.invalid/oauth/authorize';
  show(<CodingAccounts />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Verify with Codeforces' }),
  );
  expect(
    await screen.findByText('Ownership verification could not start.'),
  ).toBeInTheDocument();
});
it('renders the Student dashboard denominator and unavailable coverage', async () => {
  show(<StudentProgress batchId={batch} />);
  expect(await screen.findByText('Foundation cohort')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Completion uses all released assigned problems. Unavailable coverage remains in the denominator.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText('verification unavailable').length,
  ).toBeGreaterThan(0);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('renders accepted solve evidence links and timestamps', async () => {
  state.solved = true;
  show(<StudentProgress batchId={batch} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View evidence' }));
  const source = await screen.findByRole('link', { name: /Submission 123456/ });
  expect(source).toHaveAttribute(
    'href',
    'https://codeforces.com/contest/123/submission/123456',
  );
  expect(source).toHaveAttribute('rel', 'noopener noreferrer');
});
it('distinguishes empty evidence from an accepted claim', async () => {
  show(<StudentProgress batchId={batch} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View evidence' }));
  expect(
    await screen.findByText(
      'No trusted submission evidence has been recorded for this assignment.',
    ),
  ).toBeInTheDocument();
});
it('queues refresh rather than setting a solved checkbox', async () => {
  show(<StudentProgress batchId={batch} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Refresh CODEFORCES' }),
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/progress/refresh') &&
            init?.method === 'POST' &&
            JSON.parse(String(init.body)).platform === 'CODEFORCES',
        ),
    ).toBe(true),
  );
});
it('filters Student queries by platform and day', async () => {
  show(<StudentProgress batchId={batch} />);
  await screen.findByText('Foundation cohort');
  fireEvent.change(screen.getByLabelText('Platform'), {
    target: { value: 'CODECHEF' },
  });
  fireEvent.change(screen.getByLabelText('Learning Day'), {
    target: { value: '100' },
  });
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url]) =>
            String(url).includes('platform=CODECHEF') &&
            String(url).includes('day=100'),
        ),
    ).toBe(true),
  );
});
it('requests the exact Learning Day without unlocking other days', async () => {
  show(<DayProgress batchId={batch} day={100} />);
  await screen.findByText('Foundation cohort');
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([url]) => String(url).includes('day=100')),
  ).toBe(true);
  expect(screen.getByLabelText('Learning Day')).toHaveValue(100);
});
it('shows sync history as partial coverage', async () => {
  show(<StudentProgress batchId={batch} />);
  fireEvent.click(await screen.findByText('Recent sync jobs'));
  expect(screen.getByText('partial')).toBeInTheDocument();
  expect(screen.getByText(/Coverage partial/)).toBeInTheDocument();
});
it('shows recoverable backend errors', async () => {
  state.error = true;
  show(<StudentProgress batchId={batch} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Progress service unavailable',
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
it('shows the staff matrix and problem-wise unavailable coverage', async () => {
  show(<StaffProgress batchId={batch} />);
  expect(
    await screen.findByRole('button', { name: /Example Learner/ }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole('region', { name: 'Problem analytics' }),
  ).toBeInTheDocument();
  expect(screen.getAllByText('Verified solves').length).toBeGreaterThan(0);
});
it('opens scoped staff evidence and sync history for a selected Student', async () => {
  state.solved = true;
  show(<StaffProgress batchId={batch} />);
  fireEvent.click(
    await screen.findByRole('button', { name: /Example Learner/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'View evidence' }));
  await screen.findByRole('link', { name: /Submission 123456/ });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url]) =>
          String(url).includes('studentProfileId=' + profile) &&
          String(url).includes('/evidence'),
      ),
  ).toBe(true);
});
it('exports bounded reports through authenticated CSRF mutations and revokes blobs', async () => {
  show(<StaffProgress batchId={batch} />);
  await screen.findByRole('button', { name: /Example Learner/ });
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() =>
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:coding-test'),
  );
  const post = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/progress/export') && init?.method === 'POST',
    );
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    format: 'CSV',
    reportType: 'COMPLETE',
    confirmed: true,
    filters: {},
  });
  const submitted = JSON.parse(String(post?.[1]?.body));
  expect(submitted.filters).not.toHaveProperty('page');
  expect(submitted.filters).not.toHaveProperty('pageSize');
  expect(submitted.filters).not.toHaveProperty('assignmentPage');
  expect(post?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
});
it('links to real Batch progress and account management', async () => {
  show(<ProgressBatches />);
  expect(
    await screen.findByRole('link', { name: /View verified progress/ }),
  ).toHaveAttribute('href', '/student/batches/' + batch + '/progress');
  expect(
    screen.getByRole('link', { name: 'Coding Accounts' }),
  ).toBeInTheDocument();
});
it('shows a genuine empty Batch list', async () => {
  state.empty = true;
  show(<ProgressBatches />);
  expect(await screen.findByText(/No eligible Batches/)).toBeInTheDocument();
});
it('rejects malformed account status and dangerous problem/source links', () => {
  expect(
    accountsSchema.safeParse({
      ...accounts(),
      accounts: [{ ...account(), status: 'SELF_APPROVED' }],
    }).success,
  ).toBe(false);
  expect(
    progressItemSchema.safeParse({ ...item(), url: 'javascript:alert(1)' })
      .success,
  ).toBe(false);
  expect(
    evidenceSchema.safeParse({
      items: [{ sourceUrl: 'https://attacker.invalid' }],
    }).success,
  ).toBe(false);
});
