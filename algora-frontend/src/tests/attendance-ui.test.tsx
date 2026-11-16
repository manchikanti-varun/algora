import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { webcrypto } from 'node:crypto';
import {
  AttendanceDashboard,
  AttendanceHub,
} from '@/features/attendance/dashboard';
import { AttendanceReview } from '@/features/attendance/review';
import { AttendanceReports } from '@/features/attendance/reports';
import { AttendanceScanner } from '@/features/attendance/scanner';
import {
  StudentAttendance,
  StudentAttendanceBatches,
} from '@/features/attendance/student';
const mocks = vi.hoisted(() => ({
  status: 'OPEN',
  recordStatus: 'UNMARKED',
  empty: false,
  error: false,
  scanError: '',
  already: false,
  token: 'a'.repeat(43),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function TestCamera({
      onScan,
      paused,
      onError,
    }: {
      onScan: (v: string) => void;
      paused: boolean;
      onError: (e: unknown) => void;
    }) {
      return (
        <div aria-label="Test camera">
          <span>{paused ? 'Camera paused' : 'Camera scanning'}</span>
          <button onClick={() => onScan(mocks.token)}>Detect QR frame</button>
          <button onClick={() => onError(Error('permission denied'))}>
            Camera failure
          </button>
        </div>
      );
    },
}));
const batch = 'a'.repeat(24),
  sessionId = 'b'.repeat(24),
  dayId = 'c'.repeat(24),
  profileId = 'd'.repeat(24),
  recordId = 'e'.repeat(24),
  courseId = 'f'.repeat(24);
const session = () => ({
  id: sessionId,
  batchId: batch,
  collegeId: courseId,
  courseId,
  curriculumRevisionId: courseId,
  learningDayId: dayId,
  dayNumber: 100,
  dayTitle: 'Arrays and maps',
  batchName: 'June cohort',
  collegeName: 'Example College',
  courseTitle: 'DSA foundations',
  sessionType: 'MORNING',
  status: mocks.status,
  revision: 2,
  rosterCount: 1,
  openedAt: '2030-01-01T09:00:00.000Z',
  ...(mocks.status === 'FINALIZED'
    ? { finalizedAt: '2030-01-01T10:00:00.000Z' }
    : {}),
});
const counts = () => ({
  present: mocks.recordStatus === 'PRESENT' ? 1 : 0,
  absent: mocks.recordStatus === 'ABSENT' ? 1 : 0,
  excused: mocks.recordStatus === 'EXCUSED' ? 1 : 0,
  unmarked: mocks.recordStatus === 'UNMARKED' ? 1 : 0,
  total: 1,
});
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalPages: items.length ? 1 : 0,
});
const response = (data: unknown, status = 200, code = 'UNAVAILABLE') =>
  new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : {
            success: false,
            error: { code, message: 'Attendance temporarily unavailable' },
          },
    ),
    { status },
  );
const summary = { present: 0, absent: 0, excused: 0, percentage: null };
function report() {
  return {
    rows: page(
      mocks.empty
        ? []
        : [
            {
              sessionId,
              studentProfileId: profileId,
              rollNumber: 'R000000001',
              studentName: 'Example Learner',
              college: 'Example College',
              course: 'DSA foundations',
              batch: 'June cohort',
              dayNumber: 100,
              dayTitle: 'Arrays and maps',
              sessionType: 'MORNING',
              sessionStatus: mocks.status,
              status: mocks.recordStatus,
              markedAt: null,
              finalizedAt: null,
              official: mocks.status === 'FINALIZED',
            },
          ],
    ),
    summary,
    students: page([
      {
        ...summary,
        studentProfileId: profileId,
        studentName: 'Example Learner',
        rollNumber: 'R000000001',
      },
    ]),
    days: page([{ ...summary, dayNumber: 100 }]),
    comparison: { MORNING: summary, AFTERNOON: summary },
    policy:
      'Finalized sessions only. EXCUSED excluded from denominator. Zero denominator is N/A.',
  };
}
beforeEach(() => {
  Object.assign(mocks, {
    status: 'OPEN',
    recordStatus: 'UNMARKED',
    empty: false,
    error: false,
    scanError: '',
    already: false,
    token: 'a'.repeat(43),
  });
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
  });
  URL.createObjectURL = vi.fn(() => 'blob:attendance-test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown, init?: RequestInit) => {
      const path = String(raw);
      if (mocks.error) return response(null, 503);
      if (path.endsWith('/auth/csrf')) return response({ csrfToken: 'csrf' });
      if (init?.method === 'POST') {
        if (path.endsWith('/scan'))
          return mocks.scanError
            ? response(
                null,
                mocks.scanError === 'NETWORK_ERROR' ? 0 : 409,
                mocks.scanError,
              )
            : response({
                outcome: mocks.already ? 'ALREADY_MARKED' : 'MARKED',
                student: { name: 'Example Learner', rollNumber: 'R000000001' },
                status: 'PRESENT',
              });
        if (path.endsWith('/export'))
          return response({
            filename: 'algora-attendance.csv',
            mime: 'text/csv',
            base64: btoa('Roll number,Name\nR000000001,Example Learner'),
            rowCount: 1,
          });
        return response(session());
      }
      if (path.includes('/students/me/attendance/batches'))
        return response(
          page(
            mocks.empty
              ? []
              : [
                  {
                    id: batch,
                    name: 'June cohort',
                    college: 'Example College',
                    course: 'DSA foundations',
                  },
                ],
          ),
        );
      if (path.includes('/students/me/batches/'))
        return response({
          ...page(
            mocks.empty
              ? []
              : [
                  {
                    id: sessionId,
                    dayNumber: 100,
                    dayTitle: 'Arrays and maps',
                    sessionType: 'MORNING',
                    sessionStatus: mocks.status,
                    status: mocks.recordStatus,
                    openedAt: '2030-01-01T09:00:00.000Z',
                    official: mocks.status === 'FINALIZED',
                    ...(mocks.status === 'FINALIZED'
                      ? { finalizedAt: '2030-01-01T10:00:00.000Z' }
                      : {}),
                  },
                ],
          ),
          message: mocks.empty ? 'No attendance records to display' : '',
        });
      if (path.includes('/attendance/batches'))
        return response(
          page([
            {
              id: batch,
              name: 'June cohort',
              collegeId: courseId,
              courseId,
              status: 'ACTIVE',
              courseTitle: 'DSA foundations',
            },
          ]),
        );
      if (path.includes('/colleges')) return response(page([]));
      if (path.includes('/reports')) return response(report());
      if (path.includes('/refresh-preview'))
        return response({
          sessionId,
          sessionRevision: 2,
          existing: 1,
          additions: 1,
          impactFingerprint: 'f'.repeat(64),
        });
      if (path.includes('/history'))
        return response(
          page([
            {
              id: recordId,
              action: 'ATTENDANCE_SESSION_OPENED',
              newStatus: 'OPEN',
              actorUserId: courseId,
              actorName: 'Authorized Reviewer',
              reason: 'Reviewed institutional attendance session',
              createdAt: '2030-01-01T09:00:00.000Z',
            },
          ]),
        );
      if (path.includes('/roster'))
        return response({
          session: session(),
          counts: counts(),
          rows: page(
            mocks.empty
              ? []
              : [
                  {
                    id: profileId,
                    studentProfileId: profileId,
                    studentName: 'Example Learner',
                    rollNumber: 'R000000001',
                    status: mocks.recordStatus,
                    record:
                      mocks.recordStatus === 'UNMARKED'
                        ? null
                        : {
                            id: recordId,
                            revision: 0,
                            markedAt: '2030-01-01T09:10:00.000Z',
                            source: 'QR_SCAN',
                          },
                  },
                ],
          ),
        });
      if (path.includes('/sessions/'))
        return response({ session: session(), counts: counts() });
      return response({
        batch: {
          id: batch,
          name: 'June cohort',
          status: 'ACTIVE',
          courseTitle: 'DSA foundations',
        },
        revision: mocks.empty ? null : { id: courseId, revisionNumber: 1 },
        days: page(
          mocks.empty
            ? []
            : [
                {
                  id: dayId,
                  dayNumber: 100,
                  title: 'Arrays and maps',
                  released: true,
                  sessions: [
                    {
                      sessionType: 'MORNING',
                      session: session(),
                      counts: counts(),
                    },
                    { sessionType: 'AFTERNOON', session: null, counts: null },
                  ],
                },
              ],
        ),
        message: mocks.empty ? 'Curriculum not assigned' : '',
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(ui: React.ReactNode) {
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
      {ui}
    </QueryClientProvider>,
  );
}
const writes = () =>
  vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST');
it('lists authorized Attendance Batches and their real scope', async () => {
  mount(<AttendanceHub superAdmin />);
  expect(await screen.findByText('June cohort')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open attendance/ })).toHaveAttribute(
    'href',
    '/super-admin/batches/' + batch + '/attendance',
  );
});
it('dashboard shows exactly Morning and Afternoon with real unmarked counts', async () => {
  mount(<AttendanceDashboard batchId={batch} />);
  expect(await screen.findByText('MORNING')).toBeInTheDocument();
  expect(screen.getByText('AFTERNOON')).toBeInTheDocument();
  expect(screen.queryByText('EVENING')).not.toBeInTheDocument();
  expect(screen.getByText('Unmarked')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Create afternoon session' }),
  ).toBeInTheDocument();
});
it('creating a session requires confirmation and does not fabricate an absent roster', async () => {
  mount(<AttendanceDashboard batchId={batch} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create afternoon session' }),
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'No student is marked absent',
  );
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
    learningDayId: dayId,
    sessionType: 'AFTERNOON',
  });
});
it('dashboard displays honest unassigned state', async () => {
  mocks.empty = true;
  mount(<AttendanceDashboard batchId={batch} />);
  expect(
    (await screen.findAllByText('Curriculum not assigned')).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole('button', { name: /Create afternoon/ }),
  ).not.toBeInTheDocument();
});
it('review distinguishes draft unmarked records from official absence', async () => {
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  expect(await screen.findByText('Example Learner')).toBeInTheDocument();
  expect(
    screen.getByText(/never official ABSENT until finalization/),
  ).toBeInTheDocument();
  expect(screen.getAllByText('UNMARKED').length).toBeGreaterThan(0);
  expect(
    screen.queryByRole('button', { name: 'Correct official record' }),
  ).not.toBeInTheDocument();
});
it('finalization requires reason and a second explicit confirmation', async () => {
  mocks.status = 'CLOSED';
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review finalization' }),
  );
  expect(
    screen.getByRole('button', { name: 'Review confirmation' }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Attendance change reason'), {
    target: { value: 'Reviewed the closed durable roster' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review confirmation' }));
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(String(writes()[0][0])).toContain('/finalize');
  expect(JSON.parse(String(writes()[0][1]?.body)).expectedRevision).toBe(2);
});
it('closed review supports reasoned excusing of an unmarked member', async () => {
  mocks.status = 'CLOSED';
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Excuse unmarked member' }),
  );
  expect(screen.getByLabelText('Corrected attendance status')).toHaveValue(
    'EXCUSED',
  );
  expect(screen.getByLabelText('Corrected attendance status')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Attendance change reason'), {
    target: { value: 'Approved institutional leave was reviewed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review confirmation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(String(writes()[0][0])).toContain('/roster/' + profileId + '/excuse');
});
it('finalized review exposes audited corrections and preserves revision checks', async () => {
  mocks.status = 'FINALIZED';
  mocks.recordStatus = 'ABSENT';
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Correct official record' }),
  );
  fireEvent.change(screen.getByLabelText('Attendance change reason'), {
    target: { value: 'Registrar reviewed the evidence of presence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review confirmation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
    status: 'PRESENT',
    expectedRecordRevision: 0,
    confirmed: true,
  });
});
it('reviews additive roster impact before refresh', async () => {
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review roster additions' }),
  );
  expect(await screen.findByText(/1 eligible additions/)).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
it('renders actual history actor and sanitized text', async () => {
  mount(<AttendanceReview batchId={batch} sessionId={sessionId} />);
  expect(await screen.findByText('Authorized Reviewer')).toBeInTheDocument();
  expect(
    screen.getByText('Reviewed institutional attendance session'),
  ).toBeInTheDocument();
});
it('reports use finalized-only statistics with N/A and separate views', async () => {
  mount(<AttendanceReports batchId={batch} />);
  expect((await screen.findAllByText(/N\/A/)).length).toBeGreaterThan(0);
  expect(
    screen.getByText(/EXCUSED excluded from denominator/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Student summary' }));
  expect(
    screen.getByRole('button', { name: 'Student CSV' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Day summary' }));
  expect(screen.getByText('Day 100')).toBeInTheDocument();
});
it('exports are confirmed POST requests with CSRF and bounded server filters', async () => {
  mount(<AttendanceReports batchId={batch} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Export Batch CSV' }),
  );
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
    format: 'CSV',
    scope: 'BATCH',
    confirmed: true,
  });
  expect(writes()[0][1]?.headers).toMatchObject({ 'X-CSRF-Token': 'csrf' });
});
it('report filters use backend query parameters', async () => {
  mount(<AttendanceReports batchId={batch} />);
  await screen.findByText('Official attendance');
  fireEvent.change(screen.getByLabelText('Attendance report state'), {
    target: { value: 'FINALIZED' },
  });
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([u]) => String(u).includes('status=FINALIZED')),
    ).toBe(true),
  );
});
it('Student view shows pending UNMARKED without self-marking controls', async () => {
  mount(<StudentAttendance batchId={batch} />);
  expect(await screen.findByText(/^unmarked$/i)).toBeInTheDocument();
  expect(screen.getByText('Pending finalization')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /Mark present|Start camera/ }),
  ).not.toBeInTheDocument();
});
it('Student can find completed Batch history through its own roster hub', async () => {
  mount(<StudentAttendanceBatches />);
  expect(await screen.findByText('June cohort')).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /View my attendance/ }),
  ).toHaveAttribute('href', '/student/batches/' + batch + '/attendance');
});
it('Student finalized history is explicitly official', async () => {
  mocks.status = 'FINALIZED';
  mocks.recordStatus = 'ABSENT';
  mount(<StudentAttendance batchId={batch} />);
  expect(await screen.findByText(/^absent$/i)).toBeInTheDocument();
  expect(screen.getByText('Finalized official record')).toBeInTheDocument();
});
it('Student empty history is honest', async () => {
  mocks.empty = true;
  mount(<StudentAttendance batchId={batch} />);
  expect(
    await screen.findByText('No attendance records to display'),
  ).toBeInTheDocument();
});
it('unavailable attendance shows a retryable error', async () => {
  mocks.error = true;
  mount(<AttendanceDashboard batchId={batch} />);
  expect(
    await screen.findByText('Attendance temporarily unavailable'),
  ).toBeInTheDocument();
});
it('scanner starts, pauses, resumes and stops without persistent token storage', async () => {
  const local = vi.spyOn(Storage.prototype, 'setItem');
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  expect(screen.getByText('Camera scanning')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pause scanning' }));
  expect(screen.getByText('Camera paused')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resume scanning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  expect(screen.queryByLabelText('Test camera')).not.toBeInTheDocument();
  expect(local).not.toHaveBeenCalled();
});
it('scanner sends opaque POST body and suppresses duplicate frames', async () => {
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  expect(await screen.findByText('Attendance recorded')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(String(writes()[0][0])).not.toContain(mocks.token);
  expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
    credential: mocks.token,
  });
  expect(
    screen.getByRole('button', { name: 'Detect QR frame' }),
  ).toBeInTheDocument();
});
it('scanner displays authoritative duplicate feedback and continues', async () => {
  mocks.already = true;
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  expect(
    await screen.findByText('Already marked — no duplicate record'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Pause scanning' }),
  ).toBeInTheDocument();
});
it('scanner blocks malformed payloads before any request', async () => {
  mocks.token = '<script>bad</script>';
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  expect(screen.getByText(/Invalid QR/)).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
it('scanner closed response stops the camera', async () => {
  mocks.scanError = 'SESSION_CLOSED';
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  expect(
    await screen.findByText('Session closed. Scanning has stopped.'),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Test camera')).not.toBeInTheDocument();
});
it('scanner explains camera permission failure and offers retry', async () => {
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Camera failure' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Camera access failed');
  expect(
    screen.getByRole('button', { name: 'Start camera' }),
  ).toBeInTheDocument();
});
it('scanner refuses insecure or unsupported camera environments', async () => {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: false,
  });
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Use HTTPS or localhost');
});
it('scanner cannot start a closed session', async () => {
  mocks.status = 'CLOSED';
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  expect(
    await screen.findByRole('button', { name: 'Start camera' }),
  ).toBeDisabled();
});
it('scanner requests sign-in renewal when the staff session is too old', async () => {
  mocks.scanError = 'SCANNER_SESSION_RENEWAL_REQUIRED';
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  expect(
    await screen.findByText(
      'Sign out and sign in again to renew scanning access.',
    ),
  ).toBeInTheDocument();
});
it('scanner retries an unconfirmed network failure immediately without deduping the failed request', async () => {
  mocks.scanError = 'NETWORK_ERROR';
  mount(<AttendanceScanner batchId={batch} sessionId={sessionId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  await screen.findByText(
    'Network error. Attendance was not confirmed; retry the scan.',
  );
  mocks.scanError = '';
  fireEvent.click(screen.getByRole('button', { name: 'Detect QR frame' }));
  await screen.findByText('Attendance recorded');
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/scan')),
  ).toHaveLength(2);
});
