import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import {
  OperationalDashboard,
  BatchAnalytics,
  PersonalAnalytics,
  AnalyticsChart,
  percent,
} from '@/features/analytics/dashboard';
const state = vi.hoisted(() => ({
  query: '',
  pending: false,
  error: false,
  empty: false,
  replace: vi.fn(),
  paths: [] as string[],
  download: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => '/admin/analytics',
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/features/learning/options', () => ({
  CollegePicker: ({ onChange }: { onChange: (v: string) => void }) => (
    <button onClick={() => onChange('college')}>Pick College</button>
  ),
  CoursePicker: ({ onChange }: { onChange: (v: string) => void }) => (
    <button onClick={() => onChange('course')}>Pick Course</button>
  ),
}));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
vi.mock('@/lib/api/client', () => ({
  apiMutate: (...args: unknown[]) => state.download(...args),
  ApiError: class extends Error {},
}));
const coding = {
  assigned: 5,
  solved: 1,
  attempted: 1,
  noVerifiedSolve: 2,
  unavailable: 2,
  completion: 0.2,
  coverage: 0.6,
};
const attendance = {
  eligible: 2,
  present: 1,
  absent: 1,
  excused: 0,
  unmarked: 0,
  corrected: 1,
  percentage: 0.5,
};
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  totalPages: items.length ? 1 : 0,
});
const follow = {
  id: 'follow',
  studentId: 'student',
  name: 'Example Student',
  roll: 'R000000001',
  batchId: 'batch',
  batch: 'Foundations',
  reason: 'REPEATED_ABSENCE',
  absent: 2,
  assigned: 5,
  completion: 0.2,
  coverage: 0.6,
  lastSuccess: null,
  updatedAt: null,
};
const b = {
  id: 'batch',
  name: 'Foundations',
  collegeId: 'college',
  courseId: 'course',
  course: 'Algorithms',
  status: 'ACTIVE',
  coding,
  attendance,
  lastSuccess: null,
};
const mark = {
  sessionId: 'session',
  studentId: 'student',
  roll: 'R000000001',
  name: 'Example Student',
  day: 1,
  title: 'Arrays',
  type: 'MORNING',
  sessionStatus: 'FINALIZED',
  status: 'PRESENT',
  corrected: true,
  updatedAt: '2026-11-16T00:00:00.000Z',
  official: true,
};
function overview() {
  return {
    generatedAt: '2026-11-16T00:00:00.000Z',
    summary: {
      colleges: 1,
      activeColleges: 1,
      registeredStudents: 120,
      verifiedStudents: 119,
      courses: 1,
      activeBatches: 1,
      enrollments: 120,
      enrolledStudents: 120,
      learningDays: 1,
      assignedProblems: 5,
      attendanceSessions: 2,
      coding,
      attendance,
      followUpStudents: 1,
    },
    colleges: page(
      state.empty
        ? []
        : [
            {
              id: 'college',
              name: 'Example College',
              code: 'EX',
              registeredStudents: 120,
              verifiedStudents: 119,
              activeBatches: 1,
              enrolledStudents: 120,
              attendance,
              coding,
              lastActivity: null,
            },
          ],
    ),
    batches: state.empty ? [] : [b],
    alerts: page(
      state.empty
        ? []
        : [
            {
              id: 'alert',
              batchId: 'batch',
              message: 'Attendance awaits finalization',
              target: 'attendance',
            },
          ],
    ),
    followUp: page(state.empty ? [] : [follow]),
  };
}
function batch() {
  return {
    generatedAt: '2026-11-16T00:00:00.000Z',
    batch: {
      ...b,
      college: 'Example College',
      curriculumRevisionId: 'revision',
    },
    summary: {
      eligibleStudents: 120,
      releasedDays: 1,
      assignedProblems: 5,
      coding,
      attendance,
      finalizedSessions: 1,
      pendingSessions: 1,
    },
    freshness: { lastSuccess: null, pending: 1, failed: 0, unavailable: 2 },
    days: state.empty
      ? []
      : [
          {
            id: 'day',
            day: 1,
            title: 'Arrays',
            publishedAssignments: 5,
            eligibleStudents: 120,
            coding,
            morning: attendance,
            afternoon: attendance,
          },
        ],
    sessions: state.empty
      ? []
      : [
          {
            id: 'session',
            day: 1,
            title: 'Arrays',
            type: 'MORNING',
            status: 'FINALIZED',
            eligible: 120,
            present: 119,
            absent: 1,
            percentage: 119 / 120,
          },
          {
            id: 'afternoon',
            day: 1,
            title: 'Arrays',
            type: 'AFTERNOON',
            status: 'OPEN',
            eligible: 120,
            present: 1,
            absent: null,
            percentage: null,
          },
        ],
    platforms: [{ platform: 'CODEFORCES', coding }],
    problems: state.empty
      ? []
      : [
          {
            id: 'problem',
            day: 1,
            title: 'Arrays practice',
            platform: 'CODEFORCES',
            problemKey: '123-A',
            coding,
          },
        ],
    students: page(
      state.empty
        ? []
        : [
            {
              id: 'student',
              name: 'Example Student',
              roll: 'R000000001',
              year: null,
              lastSuccess: null,
              lastSync: null,
              coding,
              attendance,
            },
          ],
    ),
    attendanceMatrix: page(
      state.empty
        ? []
        : [
            {
              id: 'student',
              name: 'Example Student',
              roll: 'R000000001',
              marks: [mark],
            },
          ],
    ),
    followUp: page(state.empty ? [] : [follow]),
  };
}
function personal() {
  return {
    generatedAt: '2026-11-16T00:00:00.000Z',
    summary: { enrolledCourses: 1, activeBatches: 1, coding, attendance },
    batches: state.empty
      ? []
      : [
          {
            ...b,
            currentDay: 1,
            days: [{ id: 'day', day: 1, title: 'Arrays', coding }],
            morning: attendance,
            afternoon: attendance,
            assignments: [
              {
                id: 'problem',
                day: 1,
                title: 'Arrays practice',
                url: 'https://codeforces.com/problemset/problem/123/A',
                platform: 'CODEFORCES',
                status: 'VERIFICATION_UNAVAILABLE',
              },
            ],
            history: [mark],
            accounts: [
              {
                platform: 'CODEFORCES',
                status: 'VERIFIED',
                proofExpired: false,
                syncStatus: 'FAILED',
                lastSuccess: null,
                lastError: 'PROVIDER_UNAVAILABLE',
              },
            ],
          },
        ],
  };
}
vi.mock('@/features/administration/queries', () => ({
  useAdministration: (
    path: string,
    schema: { parse: (v: unknown) => unknown },
  ) => {
    state.paths.push(path);
    return {
      isPending: state.pending,
      error: state.error ? new Error('Current permission unavailable') : null,
      data:
        state.pending || state.error
          ? undefined
          : schema.parse(
              path.includes('/analytics/me')
                ? personal()
                : path.includes('/analytics/batches/')
                  ? batch()
                  : overview(),
            ),
      refetch: vi.fn(),
    };
  },
}));
beforeEach(() => {
  state.query = '';
  state.pending = false;
  state.error = false;
  state.empty = false;
  state.paths = [];
  state.replace.mockReset();
  state.download.mockReset();
  state.download.mockResolvedValue({
    filename: 'algora-attendance-analytics.csv',
    mime: 'text/csv',
    base64: btoa('safe,report'),
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('shows platform KPIs and College comparison for Super Admin', () => {
  render(<OperationalDashboard superAdmin />);
  expect(screen.getByText('Total Colleges')).toBeInTheDocument();
  expect(screen.getByText('College performance')).toBeInTheDocument();
  expect(screen.getByText('Example College · EX')).toBeInTheDocument();
  expect(state.paths[0]).toContain('/analytics/platform');
});
it('shows College Admin operational scope with real backend counts', () => {
  render(<OperationalDashboard />);
  expect(screen.getByText('Enrolled Students')).toBeInTheDocument();
  expect(screen.getByText('Batch operations')).toBeInTheDocument();
  expect(screen.queryByText('Total Colleges')).not.toBeInTheDocument();
});
it('links instructor alerts to authorized operations', () => {
  render(<OperationalDashboard />);
  expect(
    screen.getByRole('link', { name: 'Attendance awaits finalization' }),
  ).toHaveAttribute('href', '/admin/batches/batch/attendance');
});
it('shows follow-up rules and evidence with authorized Student link', () => {
  render(<OperationalDashboard followUp />);
  expect(screen.getByText('2 finalized absences')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Example Student/ })).toHaveAttribute(
    'href',
    '/admin/students?search=R000000001',
  );
});
it('persists College selection and clears dependent filters and pagination', () => {
  state.query = 'courseId=old&batchId=old&page=3';
  render(<OperationalDashboard />);
  fireEvent.click(screen.getByText('Pick College'));
  expect(state.replace.mock.calls[0]![0]).toContain('collegeId=college');
  expect(state.replace.mock.calls[0]![0]).not.toContain('batchId');
  expect(state.replace.mock.calls[0]![0]).not.toContain('page=');
});
it('updates Year and Platform filters in the URL', () => {
  render(<OperationalDashboard />);
  fireEvent.change(screen.getByLabelText('Student Year'), {
    target: { value: '4' },
  });
  expect(state.replace).toHaveBeenCalledWith(
    expect.stringContaining('year=4'),
    { scroll: false },
  );
  fireEvent.change(screen.getByLabelText('Platform'), {
    target: { value: 'CODEFORCES' },
  });
  expect(state.replace).toHaveBeenCalledWith(
    expect.stringContaining('platform=CODEFORCES'),
    { scroll: false },
  );
});
it('applies paired UTC dates and Student search', () => {
  render(<OperationalDashboard />);
  fireEvent.change(screen.getByLabelText('Student search'), {
    target: { value: 'R0001' },
  });
  fireEvent.change(screen.getByLabelText('From date UTC'), {
    target: { value: '2026-11-01' },
  });
  fireEvent.change(screen.getByLabelText('To date UTC'), {
    target: { value: '2026-11-16' },
  });
  fireEvent.click(screen.getByText('Apply search and dates'));
  expect(state.replace.mock.calls[0]![0]).toContain('search=R0001');
  expect(state.replace.mock.calls[0]![0]).toContain('from=2026-11-01');
});
it('shows loading skeletons without stale analytics', () => {
  state.pending = true;
  render(<OperationalDashboard />);
  expect(
    screen.getByLabelText('Loading administration data'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Batch operations')).not.toBeInTheDocument();
});
it('shows permission errors and retry state', () => {
  state.error = true;
  render(<BatchAnalytics batchId="batch" />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Current permission unavailable',
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
it('shows empty states without fabricated production data', () => {
  state.empty = true;
  render(<OperationalDashboard />);
  expect(screen.getByText('No authorized Batches match')).toBeInTheDocument();
  expect(
    screen.getByText('No actionable conditions were found in this selection.'),
  ).toBeInTheDocument();
});
it('renders six dedicated Batch navigation views', () => {
  render(<BatchAnalytics batchId="batch" />);
  for (const name of [
    'Overview',
    'Attendance',
    'Coding Progress',
    'Learning Days',
    'Students',
    'Reports',
  ])
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Students' }));
  expect(state.replace.mock.calls[0]![0]).toContain('tab=Students');
});
it('renders separate Morning and Afternoon and provisional absence state', () => {
  state.query = 'tab=Attendance';
  render(<BatchAnalytics batchId="batch" />);
  expect(screen.getByRole('link', { name: 'MORNING' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'AFTERNOON' })).toBeInTheDocument();
  expect(screen.getByText('Not finalized')).toBeInTheDocument();
  expect(
    screen.getByText(/Day 1 MORNING: PRESENT Finalized Corrected/),
  ).toBeInTheDocument();
});
it('renders evidence distinctions and accessible charts in Coding Progress', () => {
  state.query = 'tab=Coding+Progress';
  render(<BatchAnalytics batchId="batch" />);
  expect(
    screen.getByText('No verified accepted submission checked'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: /Platform verification coverage/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Verified attempted is included/),
  ).toBeInTheDocument();
});
it('renders Learning Day analytics and authorized assignment navigation', () => {
  render(<BatchAnalytics batchId="batch" day={1} />);
  expect(state.paths[0]).toContain('/days/1');
  expect(screen.getByText('Selected Learning Day 1')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Day 1 · Arrays practice' }),
  ).toBeInTheDocument();
});
it('renders Student performance matrix with legacy missing year', () => {
  state.query = 'tab=Students';
  render(<BatchAnalytics batchId="batch" />);
  expect(screen.getByText('Not provided')).toBeInTheDocument();
  expect(screen.getByLabelText('Sort students')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Sort students'), {
    target: { value: 'completion' },
  });
  expect(state.replace.mock.calls[0]![0]).toContain('sort=completion');
});
it('reuses Phase 8 report controls and offers reconciled attendance downloads', () => {
  state.query = 'tab=Reports';
  render(<BatchAnalytics batchId="batch" />);
  expect(screen.getByText('Coding progress downloads')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Attendance analytics CSV' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Complete Batch')).toBeInTheDocument();
});
it('downloads matching private attendance analytics through the backend', async () => {
  state.query = 'tab=Reports&year=4';
  render(<BatchAnalytics batchId="batch" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Attendance analytics CSV' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Attendance analytics downloaded',
    ),
  );
  expect(state.download).toHaveBeenCalledWith(
    '/analytics/batches/batch/attendance/export',
    'POST',
    expect.anything(),
    expect.objectContaining({
      format: 'CSV',
      filters: expect.objectContaining({ year: '4' }),
    }),
  );
});
it('shows download errors without losing report controls', async () => {
  state.query = 'tab=Reports';
  state.download.mockRejectedValue(
    new Error('Current export permission denied'),
  );
  render(<BatchAnalytics batchId="batch" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Attendance analytics CSV' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Current export permission denied',
    ),
  );
});
it('renders own Student summary and links to assignments and editorials', () => {
  render(<PersonalAnalytics />);
  expect(state.paths[0]).toContain('/analytics/me');
  expect(
    screen.getByRole('link', { name: 'Arrays practice · Day 1' }),
  ).toHaveAttribute('href', '/student/batches/batch/days/1');
  expect(screen.getByText(/MORNING: PRESENT/)).toBeInTheDocument();
  expect(
    screen.getByText(/Unsupported platforms cannot provide trusted/),
  ).toBeInTheDocument();
});
it('shows empty Student enrollment state', () => {
  state.empty = true;
  render(<PersonalAnalytics />);
  expect(
    screen.getByText('No eligible learning records yet.'),
  ).toBeInTheDocument();
});
it('renders N/A rather than zero for zero denominators', () => {
  expect(percent(null)).toBe('N/A');
  expect(percent(0)).toBe('0.0%');
  render(
    <AnalyticsChart
      title="Empty rates"
      points={[{ label: 'Day 1', value: null }]}
    />,
  );
  expect(screen.getByText(/Zero denominators are N\/A/)).toBeInTheDocument();
});
it('renders an accessible bounded percentage chart with exact values', () => {
  render(
    <AnalyticsChart
      title="Attendance trend"
      line
      points={[{ label: 'Day 1', value: 0.5 }]}
    />,
  );
  expect(
    screen.getByRole('img', { name: /Attendance trend/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Attendance trend/ })).toHaveStyle({
    minWidth: '500px',
  });
  expect(screen.getByText('100%')).toBeInTheDocument();
  expect(
    screen.getByText('Day 1: 50.0%', { selector: 'p' }),
  ).toBeInTheDocument();
});
