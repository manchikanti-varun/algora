import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Registration } from '@/features/students/registration';
import { StudentQr } from '@/features/students/qr';
import { StudentProfilePage } from '@/features/students/profile';
import { StudentManagement } from '@/features/students/management';
import { registrationSchema, rollSchema } from '@/features/students/contracts';
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  encode: vi.fn(async () => 'data:image/png;base64,test'),
  error: false,
  canVerify: true,
  correctionQueue: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT', email: 'learner@example.test' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.encode } }));
const college = 'b'.repeat(24),
  profileId = 'c'.repeat(24);
const input = {
  fullName: 'Alice Morgan',
  rollNumber: '23A91A05B2',
  phoneNumber: '+12025550123',
  collegeId: college,
  department: 'CSE',
  yearOfStudy: 2,
  leetCodeUsername: 'Alice_1',
  codeforcesUsername: 'Alice.1',
  codechefUsername: 'alice_1',
};
const profile = {
  ...input,
  id: profileId,
  userId: 'a'.repeat(24),
  studentUsername: '23a91a05b2-alice-morgan',
  verificationStatus: 'PENDING_VERIFICATION',
  revision: 1,
  qrCredentialVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  totalPages: items.length ? 1 : 0,
  page: 1,
  pageSize: 10,
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status >= 400
        ? {
            success: false,
            error: {
              code: 'UNAVAILABLE',
              message: 'Student management is temporarily unavailable',
            },
          }
        : { success: true, data },
    ),
    { status },
  );
beforeEach(() => {
  mocks.error = false;
  mocks.canVerify = true;
  mocks.correctionQueue = false;
  mocks.replace.mockClear();
  mocks.encode.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown, init?: RequestInit) => {
      const path = String(raw);
      if (mocks.error) return response(null, 503);
      if (path.endsWith('/auth/csrf')) return response({ csrfToken: 'csrf' });
      if (path.includes('registration-options'))
        return response({
          colleges: page([
            { id: college, name: 'Example Institute', code: 'EXAMPLE' },
          ]),
          departments: ['CSE', 'Civil', 'Biomedical'],
          qrIssuanceAvailable: true,
        });
      if (path.includes('roll-number-availability'))
        return response({ rollNumber: '23A91A05B2', available: true });
      if (path.endsWith('/qr/rotate')) return response({ version: 2 });
      if (path.endsWith('/me/qr'))
        return response({ token: 'x'.repeat(43), version: 1 });
      if (path.endsWith('/students/me'))
        return response({
          profile,
          email: 'learner@example.test',
          college: { id: college, name: 'Example Institute', status: 'ACTIVE' },
          qrIssuanceAvailable: true,
        });
      if (path.includes('correction-requests'))
        return response(
          page(
            mocks.correctionQueue
              ? [
                  {
                    id: 'd'.repeat(24),
                    studentProfileId: profileId,
                    requesterUserId: profile.userId,
                    sourceCollegeId: college,
                    requestedChanges: { fullName: 'Alice Newname' },
                    reason: 'Registrar confirmed a corrected registered name',
                    status: 'PENDING',
                    profileRevision: profile.revision,
                    reviewNote: '',
                    createdAt: profile.createdAt,
                  },
                ]
              : [],
          ),
        );
      if (path.endsWith('/students/' + profileId))
        return response({
          profile,
          canVerify: mocks.canVerify,
          email: 'learner@example.test',
          college: { id: college, name: 'Example Institute', status: 'ACTIVE' },
        });
      if (path.endsWith('/students/register')) return response(profile, 201);
      if (
        path.includes('/super-admin/students?') ||
        path.includes('/admin/students?')
      )
        return response(page([profile]));
      if (path.includes('/colleges'))
        return response(page([{ id: college, name: 'Example Institute' }]));
      if (init?.method) return response({ updated: true });
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
it('validates exact ASCII roll normalization and all mandatory fields', () => {
  expect(rollSchema.parse(' 23a91a05b2 ')).toBe('23A91A05B2');
  for (const roll of ['23A91A05B', '23A91A05B22', 'ſ3A91A05B2', '23A91A 5B2'])
    expect(rollSchema.safeParse(roll).success).toBe(false);
  expect(registrationSchema.safeParse(input).success).toBe(true);
  for (const key of Object.keys(input)) {
    const data: Record<string, unknown> = { ...input };
    delete data[key];
    expect(registrationSchema.safeParse(data).success).toBe(false);
  }
});
it('shows readonly verified Google email and blocks incomplete form submission', async () => {
  wrap(<Registration />);
  const email = await screen.findByLabelText('Verified Google email');
  expect(email).toHaveAttribute('readonly');
  expect(email).toHaveValue('learner@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
  await waitFor(() =>
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/students/register') && init?.method === 'POST',
      ),
  ).toBe(false);
});
it('reviews, confirms and submits backend identity-safe registration JSON', async () => {
  wrap(<Registration />);
  await screen.findByLabelText('Full name');
  const fields = {
    'Full name': input.fullName,
    'Roll number': '23a91a05b2',
    'Phone number': input.phoneNumber,
    Department: input.department,
    'LeetCode username': input.leetCodeUsername,
    'Codeforces username': input.codeforcesUsername,
    'CodeChef username': input.codechefUsername,
  };
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText('College'), {
    target: { value: college },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
  await screen.findByRole('region', { name: 'Registration review' });
  fireEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith('/student/profile'),
  );
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith('/students/register'))!;
  const body = JSON.parse(String(call[1]?.body));
  expect(body.rollNumber).toBe('23A91A05B2');
  expect(body.confirmed).toBe(true);
  for (const field of ['email', 'userId', 'role', 'verificationStatus'])
    expect(body).not.toHaveProperty(field);
});
it('shows unavailable without inventing registration success', async () => {
  mocks.error = true;
  wrap(<Registration />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(
    screen.queryByRole('button', { name: 'Submit registration' }),
  ).not.toBeInTheDocument();
});
it('displays own profile, permanent username and pending verification distinction', async () => {
  wrap(<StudentProfilePage />);
  expect(await screen.findByText(profile.studentUsername)).toBeInTheDocument();
  expect(
    screen.getByText(/Institutional verification is required/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'View your permanent QR' }),
  ).toHaveAttribute('href', '/student/my-qr');
});
it('retrieves QR only on explicit display, encodes only opaque token and allows PNG download', async () => {
  wrap(<StudentQr />);
  await screen.findByRole('button', { name: 'Display QR' });
  expect(
    vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/me/qr')),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Display QR' }));
  expect(
    await screen.findByAltText('Private student QR credential'),
  ).toBeInTheDocument();
  expect(mocks.encode).toHaveBeenCalledWith('x'.repeat(43), expect.any(Object));
  expect(
    screen.getByRole('link', { name: 'Download QR as PNG' }),
  ).toHaveAttribute('download', 'algora-student-qr.png');
  fireEvent.click(screen.getByRole('button', { name: 'Hide QR' }));
  expect(
    screen.queryByAltText('Private student QR credential'),
  ).not.toBeInTheDocument();
});
it('requires confirmation before rotation and clears displayed credential image', async () => {
  wrap(<StudentQr />);
  fireEvent.click(await screen.findByRole('button', { name: 'Display QR' }));
  await screen.findByAltText('Private student QR credential');
  fireEvent.click(
    screen.getByRole('button', { name: 'Rotate compromised QR' }),
  );
  expect(
    vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/qr/rotate')),
  ).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([u]) => String(u).endsWith('/qr/rotate')),
    ).toBe(true),
  );
  expect(
    screen.queryByAltText('Private student QR credential'),
  ).not.toBeInTheDocument();
});
it.each([true, false])(
  'loads real API-backed staff directory, superAdmin=%s',
  async (superAdmin) => {
    wrap(<StudentManagement superAdmin={superAdmin} />);
    expect(
      await screen.findByText(profile.studentUsername),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View student' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Correction reviews' }),
    ).toBeInTheDocument();
  },
);

it('requires documented evidence and confirmation before staff verification', async () => {
  wrap(<StudentManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'View student' }));
  const action = await screen.findByRole('button', { name: 'Verify identity' });
  expect(action).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Verification evidence reference'), {
    target: { value: 'Authorized registrar reviewed original records' },
  });
  fireEvent.click(action);
  expect(
    vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/verify')),
  ).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(
      vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/verify')),
    ).toBe(true),
  );
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([u]) => String(u).endsWith('/verify'))!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    method: 'AUTHORIZED_MANUAL',
    confirmed: true,
    expectedRevision: 1,
  });
});
it('hides privileged review actions without current verification permission', async () => {
  mocks.canVerify = false;
  wrap(<StudentManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'View student' }));
  await screen.findByText(/actions require student.verify permission/);
  expect(
    screen.queryByRole('button', { name: 'Verify identity' }),
  ).not.toBeInTheDocument();
});
it('submits protected identity corrections rather than direct profile edits', async () => {
  wrap(<StudentProfilePage />);
  fireEvent.change(await screen.findByLabelText('Correct fullName'), {
    target: { value: 'Alice Newname' },
  });
  fireEvent.change(screen.getByLabelText('Correction reason'), {
    target: { value: 'Registrar confirmed corrected name spelling' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Request correction' }));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([u, init]) =>
            String(u).endsWith('/me/correction-requests') &&
            init?.method === 'POST',
        ),
    ).toBe(true),
  );
  const call = vi
    .mocked(fetch)
    .mock.calls.find(
      ([u, init]) =>
        String(u).endsWith('/me/correction-requests') &&
        init?.method === 'POST',
    )!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    requestedChanges: { fullName: 'Alice Newname' },
    expectedRevision: 1,
  });
});
it('reviews correction values with a shared note and explicit confirmation', async () => {
  mocks.correctionQueue = true;
  wrap(<StudentManagement superAdmin />);
  fireEvent.click(screen.getByRole('button', { name: 'Correction reviews' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review correction' }),
  );
  await screen.findByLabelText('Correction review note');
  fireEvent.change(screen.getByLabelText('Correction review note'), {
    target: { value: 'Reviewed the corrected institutional name record' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve correction' }));
  expect(
    vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/approve')),
  ).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(
      vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/approve')),
    ).toBe(true),
  );
});
