import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CourseCatalog } from '@/features/learning/courses';
import { BatchCatalog, BatchDetail } from '@/features/learning/batches';
import {
  EnrollmentWorkspace,
  ManualEnrollment,
  BulkEnrollment,
} from '@/features/learning/enrollments';
import { StudentLearning } from '@/features/learning/student';
import { ReconciliationStatus } from '@/features/learning/reconciliation';
const mocks = vi.hoisted(() => ({
  error: false,
  manage: true,
  enroll: true,
  roster: true,
  empty: false,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT', email: 'student@example.test' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
const college = 'a'.repeat(24),
  courseId = 'b'.repeat(24),
  batchId = 'c'.repeat(24),
  enrollmentId = 'd'.repeat(24);
const course = {
  id: courseId,
  title: 'DSA Foundations',
  code: 'DSA-101',
  slug: 'dsa-foundations',
  description: 'A deliberate introduction to data structures.',
  shortDescription: 'Build foundations',
  difficulty: 'BEGINNER',
  estimatedDurationDays: 6,
  tags: ['dsa'],
  scope: 'PLATFORM',
  ownerCollegeId: null,
  sharedCollegeIds: [],
  status: 'PUBLISHED',
  revision: 2,
  canManage: true,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};
const batch = {
  id: batchId,
  name: 'November Cohort',
  code: 'NOV-26',
  description: 'College delivery',
  courseId,
  collegeId: college,
  status: 'ACTIVE',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  capacity: 200,
  seatCount: 1,
  revision: 2,
  enrollmentPolicy: 'ADMIN_ROLL_ONLY',
  snapshot: {
    title: course.title,
    code: course.code,
    slug: course.slug,
    description: course.description,
    difficulty: course.difficulty,
    courseRevision: 1,
  },
  canManage: true,
  canEnroll: true,
  canViewRoster: true,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
};
const enrollment = {
  id: enrollmentId,
  batchId,
  collegeId: college,
  rollNumber: '23A91A05B2',
  status: 'PENDING_REGISTRATION',
  source: 'MANUAL',
  reason: 'REGISTRATION_REQUIRED',
  revision: 0,
  createdAt: course.createdAt,
  updatedAt: course.updatedAt,
};
const results = [
  {
    row: 1,
    rollNumber: '23A91A05B2',
    outcome: 'PENDING_REGISTRATION',
    status: 'PENDING_REGISTRATION',
    reason: 'REGISTRATION_REQUIRED',
  },
  {
    row: 2,
    rollNumber: '23A91A05B2',
    outcome: 'DUPLICATE_INPUT',
    reason: 'Duplicate input row',
  },
  {
    row: 3,
    rollNumber: 'invalid',
    outcome: 'INVALID_ROLL',
    reason: 'Exactly 10 characters required',
  },
];
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalPages: items.length ? 1 : 0,
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status >= 400
        ? {
            success: false,
            error: {
              code: 'UNAVAILABLE',
              message:
                'Course and enrollment management is temporarily unavailable',
            },
          }
        : { success: true, data },
    ),
    { status },
  );
beforeEach(() => {
  Object.assign(mocks, {
    error: false,
    manage: true,
    enroll: true,
    roster: true,
    empty: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown, init?: RequestInit) => {
      const path = String(raw);
      if (mocks.error) return response(null, 503);
      if (path.endsWith('/auth/csrf')) return response({ csrfToken: 'csrf' });
      if (path.endsWith('/enrollments/preview'))
        return response({
          previewToken: 'x'.repeat(43),
          operationId: 'e'.repeat(24),
          expiresAt: '2030-01-01T00:00:00Z',
          warnings: ['Only Roll Number is used.'],
          results,
        });
      if (
        path.endsWith('/enrollments/import') ||
        (init?.method === 'POST' && path.endsWith('/enrollments'))
      )
        return response({
          operationId: 'e'.repeat(24),
          replayed: false,
          results,
          warnings: [],
        });
      if (init?.method === 'POST' || init?.method === 'PATCH')
        return response({ updated: true });
      if (path.includes('/colleges'))
        return response(
          page([
            {
              id: college,
              name: 'Example Institute',
              status: 'ACTIVE',
              permissions: [
                'college.view',
                'course.manage',
                'batch.manage',
                'student.enroll',
                'student.view',
              ],
            },
          ]),
        );
      if (
        path.includes('/students/me/courses') ||
        path.includes('/students/me/batches')
      )
        return response({
          ...page(
            mocks.empty
              ? []
              : [
                  {
                    id: enrollmentId,
                    status: 'ACTIVE',
                    effectiveAccess: true,
                    courseTitle: course.title,
                    batchName: batch.name,
                    collegeName: 'Example Institute',
                    batchStatus: 'ACTIVE',
                    startDate: batch.startDate,
                    endDate: batch.endDate,
                    message: '',
                  },
                ],
          ),
        });
      if (path.includes('/learning/reconciliation'))
        return response({
          queues: [
            {
              kind: 'PROFILE',
              pending: 1,
              failed: [
                {
                  targetId: college,
                  attempts: 8,
                  message: 'Reconciliation failed; review required',
                },
              ],
            },
          ],
        });
      if (path.includes('/courses?'))
        return response(
          page(mocks.empty ? [] : [{ ...course, canManage: mocks.manage }]),
        );
      if (path.includes('/batches?'))
        return response(
          page(
            mocks.empty
              ? []
              : [
                  {
                    ...batch,
                    canManage: mocks.manage,
                    canEnroll: mocks.enroll,
                    canViewRoster: mocks.roster,
                  },
                ],
          ),
        );
      if (path.includes('/enrollment-events')) return response(page([]));
      if (
        path.includes('/enrollments?') ||
        path.includes('/enrollment-history?')
      )
        return response(page(mocks.empty ? [] : [enrollment]));
      if (path.endsWith('/batches/' + batchId))
        return response({
          ...batch,
          canManage: mocks.manage,
          canEnroll: mocks.enroll,
          canViewRoster: mocks.roster,
        });
      return response(null, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
function posted(path: string) {
  return vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(path) &&
        ['POST', 'PATCH'].includes(String(init?.method)),
    );
}
it('renders an authorized course catalog and hides edit actions for read-only courses', async () => {
  mocks.manage = false;
  wrap(<CourseCatalog />);
  expect(await screen.findByText(course.title)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Archive' }),
  ).not.toBeInTheDocument();
});
it('validates and creates a course draft using the existing CSRF API client', async () => {
  wrap(<CourseCatalog superAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Create course' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save course' }));
  await waitFor(() =>
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0),
  );
  for (const [label, value] of Object.entries({
    'Course title': 'Java Problem Solving',
    'Course code': 'JAVA-1',
    'URL slug': 'java-problem-solving',
    'Course description': 'A new structured Java practice program.',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save course' }));
  await waitFor(() =>
    expect(screen.queryAllByRole('alert').map((e) => e.textContent)).toEqual(
      [],
    ),
  );
  await waitFor(() => expect(posted('/courses')).toBeTruthy());
  const body = JSON.parse(String(posted('/courses')![1]?.body));
  expect(body).toMatchObject({
    scope: 'PLATFORM',
    title: 'Java Problem Solving',
  });
  expect(body).not.toHaveProperty('status');
});
it('requires confirmation and expected revision before course archive', async () => {
  wrap(<CourseCatalog superAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
  expect(posted('/courses/' + courseId + '/archive')).toBeUndefined();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(posted('/courses/' + courseId + '/archive')).toBeTruthy(),
  );
  expect(
    JSON.parse(String(posted('/courses/' + courseId + '/archive')![1]?.body)),
  ).toEqual({ expectedRevision: 2, confirmed: true });
});
it('renders batch metadata and current reserved membership counts without fake progress', async () => {
  wrap(<BatchCatalog />);
  expect(await screen.findByText(batch.name)).toBeInTheDocument();
  expect(screen.getByText('1 / 200')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Details' })[0]).toHaveAttribute(
    'href',
    '/admin/batches/' + batchId,
  );
  expect(screen.queryByText(/progress.*%/i)).not.toBeInTheDocument();
});
it('creates batches with eligible college/course selection and validated dates', async () => {
  wrap(<BatchCatalog superAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Create batch' }));
  await screen.findByLabelText('Batch name');
  await screen.findAllByRole('option', { name: 'Example Institute' });
  const collegeSelectors = screen.getAllByLabelText('College');
  fireEvent.change(collegeSelectors.at(-1)!, { target: { value: college } });
  await waitFor(() =>
    expect(
      screen.getAllByLabelText('Published course').at(-1),
    ).not.toBeDisabled(),
  );
  fireEvent.change(screen.getAllByLabelText('Published course').at(-1)!, {
    target: { value: courseId },
  });
  fireEvent.change(screen.getByLabelText('Batch name'), {
    target: { value: 'December cohort' },
  });
  fireEvent.change(screen.getByLabelText('Batch code'), {
    target: { value: 'DEC-26' },
  });
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-12-01' },
  });
  fireEvent.change(screen.getByLabelText('End date'), {
    target: { value: '2026-12-31' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save batch' }));
  await waitFor(() => expect(posted('/batches')).toBeTruthy());
});
it('shows batch snapshots and confirms completion before mutation', async () => {
  wrap(<BatchDetail id={batchId} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Complete batch' }),
  );
  expect(posted('/batches/' + batchId + '/complete')).toBeUndefined();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(posted('/batches/' + batchId + '/complete')).toBeTruthy(),
  );
  expect(screen.getByText(/revision 1/)).toBeInTheDocument();
});
it('organizes enrollment roster, pending and history sections with roll-only search', async () => {
  wrap(<EnrollmentWorkspace id={batchId} />);
  expect(await screen.findByText(enrollment.rollNumber)).toBeInTheDocument();
  for (const name of [
    'Current',
    'Pending',
    'Add student',
    'Bulk import',
    'History',
    'Events',
  ])
    expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  expect(screen.getByLabelText('Find roll number')).toBeInTheDocument();
});
it('validates manual roll input and confirms before sending normalized roll without PII', async () => {
  wrap(<ManualEnrollment id={batchId} />);
  fireEvent.change(screen.getByLabelText('Student roll number'), {
    target: { value: 'short' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review enrollment' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('exactly 10');
  fireEvent.change(screen.getByLabelText('Student roll number'), {
    target: { value: '23a91a05b2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review enrollment' }));
  expect(posted('/enrollments')).toBeUndefined();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/enrollments') && init?.method === 'POST',
        ),
    ).toBe(true),
  );
  const call = vi
    .mocked(fetch)
    .mock.calls.find(
      ([u, i]) => String(u).endsWith('/enrollments') && i?.method === 'POST',
    )!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    rollNumber: '23A91A05B2',
    confirmed: true,
  });
  expect(String(call[1]?.body)).not.toMatch(/email|phone|studentProfileId/);
});
it('previews bulk paste, summarizes rejected rows and confirms the server token', async () => {
  wrap(<BulkEnrollment id={batchId} />);
  fireEvent.change(screen.getByLabelText('Roll numbers'), {
    target: { value: '23A91A05B2\n23A91A05B2\ninvalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate & preview' }));
  await screen.findByRole('heading', { name: 'Import preview' });
  expect(screen.getByText(/3 input rows/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
  expect(posted('/enrollments/import')).toBeUndefined();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await screen.findByRole('heading', { name: 'Import results' });
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([u]) => String(u).endsWith('/enrollments/import'))!;
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    previewToken: 'x'.repeat(43),
    confirmed: true,
  });
});
it('clears an old preview after input changes', async () => {
  wrap(<BulkEnrollment id={batchId} />);
  fireEvent.change(screen.getByLabelText('Roll numbers'), {
    target: { value: '23A91A05B2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate & preview' }));
  await screen.findByRole('heading', { name: 'Import preview' });
  fireEvent.change(screen.getByLabelText('Roll numbers'), {
    target: { value: '23A91A05B3' },
  });
  expect(
    screen.queryByRole('button', { name: 'Confirm import' }),
  ).not.toBeInTheDocument();
});
it.each(['csv', 'xlsx'])(
  'uploads %s only to server preview with bounded base64 file content',
  async (ext) => {
    wrap(<BulkEnrollment id={batchId} />);
    fireEvent.click(screen.getByRole('button', { name: 'CSV / Excel file' }));
    const file = new File(['RollNumber\n23A91A05B2'], 'students.' + ext);
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('fixture').buffer,
    });
    fireEvent.change(screen.getByLabelText('CSV or XLSX file'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate & preview' }));
    await screen.findByRole('heading', { name: 'Import preview' });
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => String(u).endsWith('/enrollments/preview'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      kind: ext === 'csv' ? 'CSV' : 'XLSX',
      base64: btoa('fixture'),
    });
  },
);
it('rejects unsupported uploads before sending a preview request', async () => {
  wrap(<BulkEnrollment id={batchId} />);
  fireEvent.click(screen.getByRole('button', { name: 'CSV / Excel file' }));
  fireEvent.change(screen.getByLabelText('CSV or XLSX file'), {
    target: { files: [new File(['bad'], 'roster.exe')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Validate & preview' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Only CSV and XLSX',
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([u]) => String(u).endsWith('/enrollments/preview')),
  ).toBe(false);
});
it('renders real own enrollment cards and honest empty states', async () => {
  wrap(<StudentLearning />);
  expect(await screen.findByText(course.title)).toBeInTheDocument();
  expect(screen.getByText(/Your enrollment is active/)).toBeInTheDocument();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
});
it('does not fabricate courses or counts while unavailable', async () => {
  mocks.error = true;
  wrap(<StudentLearning />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByText(course.title)).not.toBeInTheDocument();
});
it('shows real reconciliation failure visibility and requires explicit retry confirmation', async () => {
  wrap(<ReconciliationStatus />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry after review' }),
  );
  expect(posted('/learning/reconciliation/retry')).toBeUndefined();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(posted('/learning/reconciliation/retry')).toBeTruthy(),
  );
});
