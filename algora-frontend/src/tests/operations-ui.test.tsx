import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  BatchOperations,
  SyncRecovery,
  readinessSchema,
} from '@/features/analytics/operations';
import { AttendanceRates } from '@/features/attendance/rates';
import { apiGet, healthSchema } from '@/lib/api/client';
const state = vi.hoisted(() => ({
  pending: false,
  error: false,
  empty: false,
  commandError: false,
  busy: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
  paths: [] as string[],
}));
const coding = {
  assigned: 9000,
  solved: 1,
  attempted: 0,
  noVerifiedSolve: 49,
  unavailable: 8950,
  completion: 1 / 9000,
  coverage: 50 / 9000,
};
const attendance = {
  eligible: 120,
  present: 90,
  absent: 29,
  excused: 1,
  unmarked: 0,
  corrected: 1,
  percentage: 0.75,
  attendanceRate: 0.75,
  participationRate: 90 / 119,
};
const data = () => ({
  batchId: 'batch',
  batchName: 'Java DSA cohort',
  generatedAt: '2026-11-16T00:00:00.000Z',
  attendanceReady: true,
  codingReady: false,
  checks: [
    {
      check: 'Pinned curriculum',
      status: 'PASS',
      guidance: 'Assigned published revision',
    },
    {
      check: 'Supported coding ownership',
      status: 'NOT CONFIGURED',
      guidance: 'Configure official Codeforces ownership',
    },
  ],
  blockers: [
    {
      check: 'Supported coding ownership',
      status: 'NOT CONFIGURED',
      guidance: 'Configure official Codeforces ownership',
    },
  ],
  sessions: state.empty
    ? []
    : [
        {
          day: 1,
          title: 'Arrays',
          type: 'MORNING',
          sessionId: 'session',
          status: 'OPEN',
          expectedEligibleStudents: 120,
          snapshotStudents: 120,
          scanReady: true,
          camera: 'NOT TESTED',
          guidance:
            'Confirm camera permission and connectivity on this device.',
        },
        {
          day: 1,
          title: 'Arrays',
          type: 'AFTERNOON',
          sessionId: null,
          status: 'NOT CREATED',
          expectedEligibleStudents: 120,
          snapshotStudents: 0,
          scanReady: false,
          camera: 'NOT TESTED',
          guidance: 'Create and open the session before scanning.',
        },
      ],
  days: state.empty
    ? []
    : [
        {
          day: 1,
          title: 'Arrays',
          assignedProblems: 15,
          coding,
          morning: attendance,
          afternoon: attendance,
          finalizedSessions: 1,
          pendingSessions: 1,
          issues: ['Coding verification is incomplete or unavailable'],
        },
      ],
});
vi.mock('@/features/administration/queries', () => ({
  useAdministration: (path: string) => {
    state.paths.push(path);
    return {
      isPending: state.pending,
      error: state.error
        ? new Error('Database unavailable; retry later')
        : null,
      data:
        state.pending || state.error
          ? undefined
          : readinessSchema.parse(data()),
      refetch: state.refetch,
    };
  },
  useCommand: () => ({
    mutate: state.mutate,
    isPending: state.busy,
    error: state.commandError
      ? new Error('Wait for the scheduled retry window')
      : null,
  }),
}));
beforeEach(() => {
  state.pending = false;
  state.error = false;
  state.empty = false;
  state.commandError = false;
  state.busy = false;
  state.paths = [];
  state.mutate.mockClear();
  state.refetch.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('loads the private Batch readiness endpoint', () => {
  render(<BatchOperations batchId="batch" />);
  expect(state.paths[0]).toBe('/analytics/batches/batch/readiness');
  expect(screen.getByText('Pinned curriculum: PASS')).toBeInTheDocument();
});
it('shows configuration blockers without claiming live acceptance', () => {
  render(<BatchOperations batchId="batch" />);
  expect(
    screen.getByText('Supported coding ownership: NOT CONFIGURED'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Configuration does not establish live browser/),
  ).toBeInTheDocument();
});
it('shows eligible and snapshot counts with separate Morning and Afternoon', () => {
  render(<BatchOperations batchId="batch" />);
  expect(
    screen.getByRole('columnheader', { name: 'Eligible now' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('columnheader', { name: 'Roster snapshot' }),
  ).toBeInTheDocument();
  expect(screen.getAllByText('NOT TESTED')).toHaveLength(2);
  expect(screen.getByText('MORNING')).toBeInTheDocument();
  expect(screen.getByText('AFTERNOON')).toBeInTheDocument();
});
it('offers scanning only for a ready OPEN session', () => {
  render(<BatchOperations batchId="batch" />);
  expect(screen.getAllByRole('link', { name: 'Open scanner' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Open scanner' })).toHaveAttribute(
    'href',
    '/admin/batches/batch/attendance/session/scan',
  );
  expect(screen.getByRole('link', { name: 'Create session' })).toHaveAttribute(
    'href',
    '/admin/batches/batch/attendance',
  );
});
it('preserves Super Admin route conventions', () => {
  render(<BatchOperations batchId="batch" superAdmin />);
  expect(screen.getByRole('link', { name: 'Review session' })).toHaveAttribute(
    'href',
    '/super-admin/batches/batch/attendance/session',
  );
});
it('renders truthful end-of-day evidence and unresolved verification', () => {
  render(<BatchOperations batchId="batch" />);
  expect(
    screen.getByRole('heading', { name: 'End of day summary' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Morning finalized rates' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Afternoon finalized rates' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Verified solved 1 \/ 9000 opportunities/),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Coding verification is incomplete or unavailable'),
  ).toBeInTheDocument();
});
it('refreshes readiness manually without infinite retry', () => {
  render(<BatchOperations batchId="batch" />);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh readiness' }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
it('shows loading without stale readiness', () => {
  state.pending = true;
  render(<BatchOperations batchId="batch" />);
  expect(
    screen.getByLabelText('Loading administration data'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Pinned curriculum: PASS')).not.toBeInTheDocument();
});
it('shows database failure and recovery action', () => {
  state.error = true;
  render(<BatchOperations batchId="batch" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
it('shows real empty data instead of fake session records', () => {
  state.empty = true;
  render(<BatchOperations batchId="batch" />);
  expect(screen.getByText('No released Learning Days')).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Open scanner' }),
  ).not.toBeInTheDocument();
});
it('exposes exact separately named rates for excused and missing marks', () => {
  render(
    <AttendanceRates
      counts={{ present: 3, absent: 1, excused: 1, unmarked: 1 }}
    />,
  );
  expect(screen.getByText('Attendance Rate')).toBeInTheDocument();
  expect(screen.getByText('Participation Rate')).toBeInTheDocument();
  expect(screen.getByText('50.00%')).toBeInTheDocument();
  expect(screen.getByText('75.00%')).toBeInTheDocument();
});
it('preserves N/A for zero denominators', () => {
  render(<AttendanceRates counts={{ present: 0, absent: 0, excused: 0 }} />);
  expect(screen.getAllByText('N/A')).toHaveLength(2);
});
it('counts excused-only opportunities without claiming participation', () => {
  render(<AttendanceRates counts={{ present: 0, absent: 0, excused: 1 }} />);
  expect(screen.getByText('0.00%')).toBeInTheDocument();
  expect(screen.getByText('N/A')).toBeInTheDocument();
});
it('does not offer manual retries for active or successful jobs', () => {
  render(
    <SyncRecovery
      batchId="batch"
      jobs={[
        { id: 'active', status: 'RETRY_WAIT' },
        { id: 'done', status: 'SUCCEEDED' },
      ]}
    />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('retries a failed job through the existing authenticated command path', () => {
  render(
    <SyncRecovery batchId="batch" jobs={[{ id: 'job', status: 'FAILED' }]} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed sync' }));
  expect(state.mutate).toHaveBeenCalledWith({
    path: '/batches/batch/progress/jobs/job/retry',
    body: { confirmed: true },
  });
});
it('prevents duplicate retry clicks while busy', () => {
  state.busy = true;
  render(
    <SyncRecovery batchId="batch" jobs={[{ id: 'job', status: 'PARTIAL' }]} />,
  );
  expect(
    screen.getByRole('button', { name: 'Retry partial sync' }),
  ).toBeDisabled();
});
it('communicates backoff without replacing the job with fake success', () => {
  state.commandError = true;
  render(
    <SyncRecovery batchId="batch" jobs={[{ id: 'job', status: 'FAILED' }]} />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('scheduled retry window');
});
it('rejects an incompatible backend contract header', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { service: 'algora-backend', status: 'ok' },
          }),
          { headers: { 'X-Algora-API-Version': '2' } },
        ),
    ),
  );
  await expect(apiGet('/health', healthSchema)).rejects.toMatchObject({
    code: 'API_VERSION_MISMATCH',
  });
});
it('accepts the current backend contract', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { service: 'algora-backend', status: 'ok' },
          }),
          { headers: { 'X-Algora-API-Version': '1' } },
        ),
    ),
  );
  await expect(apiGet('/health', healthSchema)).resolves.toEqual({
    service: 'algora-backend',
    status: 'ok',
  });
});
it('uses the existing responsive table scroll containers', () => {
  const { container } = render(<BatchOperations batchId="batch" />);
  expect(container.querySelector('.data-table-scroll')).toBeInTheDocument();
});
