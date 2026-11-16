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
import { ProfileFacts } from '@/features/students/profile';
import {
  profileSchema,
  registrationSchema,
} from '@/features/students/contracts';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: { role: 'STUDENT', email: 'learner@example.test' },
    loading: false,
    error: null,
    logout: vi.fn(),
  }),
}));
const state = { empty: false, error: false, pending: false };
let resolveOptions: (value: Response) => void;
const college = 'a'.repeat(24);
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : {
            error: {
              code: 'DIRECTORY_UNAVAILABLE',
              message: 'College directory unavailable',
            },
          },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
const options = (search = false) =>
  response({
    colleges: {
      items: state.empty
        ? []
        : search
          ? [{ id: college, name: 'Alpha Institute', code: 'ALPHA' }]
          : [
              { id: college, name: 'Alpha Institute', code: 'ALPHA' },
              { id: 'b'.repeat(24), name: 'Zulu Institute', code: 'ZULU' },
            ],
      page: 1,
      pageSize: 10,
      total: state.empty ? 0 : search ? 1 : 2,
      totalPages: state.empty ? 0 : 1,
    },
    departments: ['CSE'],
    qrIssuanceAvailable: false,
  });
const input = {
  fullName: 'Example Learner',
  rollNumber: 'R000000001',
  phoneNumber: '+12025550123',
  collegeId: college,
  department: 'CSE',
  yearOfStudy: 3,
  leetCodeUsername: 'learner',
  codeforcesUsername: 'learner',
  codechefUsername: 'learner',
};
beforeEach(() => {
  state.empty = false;
  state.error = false;
  state.pending = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: unknown) => {
      if (state.pending)
        return new Promise<Response>((resolve) => {
          resolveOptions = resolve;
        });
      if (state.error) return response(null, 503);
      return options(String(raw).includes('search=Alpha'));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
it('loads real College names/codes and does not default to a guessed first year', async () => {
  show(<Registration />);
  expect(
    await screen.findByRole('option', { name: 'Alpha Institute (ALPHA)' }),
  ).toHaveValue(college);
  expect(screen.getByLabelText('Year of study')).toHaveValue('');
  expect(screen.getByRole('option', { name: '1st Year' })).toHaveValue('1');
  expect(screen.getByRole('option', { name: '4th Year' })).toHaveValue('4');
  expect(
    screen.queryByRole('textbox', { name: 'College ID' }),
  ).not.toBeInTheDocument();
});
it('searches the backend while preserving typed registration details', async () => {
  show(<Registration />);
  fireEvent.change(await screen.findByLabelText('Full name'), {
    target: { value: 'Example Learner' },
  });
  fireEvent.change(screen.getByLabelText('Find your college'), {
    target: { value: 'Alpha' },
  });
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url]) =>
            String(url).includes('registration-options') &&
            String(url).includes('search=Alpha'),
        ),
    ).toBe(true),
  );
  expect(screen.getByLabelText('Full name')).toHaveValue('Example Learner');
  await waitFor(() =>
    expect(
      screen.queryByRole('option', { name: 'Zulu Institute (ZULU)' }),
    ).not.toBeInTheDocument(),
  );
});
it('shows a no ACTIVE Colleges state without fake options', async () => {
  state.empty = true;
  show(<Registration />);
  expect(
    await screen.findByText(/No ACTIVE Colleges match/),
  ).toBeInTheDocument();
  expect(
    screen.getByLabelText('College').querySelectorAll('option'),
  ).toHaveLength(1);
});
it('shows College directory loading and then real options', async () => {
  state.pending = true;
  show(<Registration />);
  expect(
    screen.getByLabelText('Loading administration data'),
  ).toBeInTheDocument();
  await waitFor(() => expect(typeof resolveOptions).toBe('function'));
  state.pending = false;
  resolveOptions(options());
  expect(
    await screen.findByRole('option', { name: 'Alpha Institute (ALPHA)' }),
  ).toBeInTheDocument();
});
it('supports retry after a directory failure without assuming registration success', async () => {
  state.error = true;
  show(<Registration />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'College directory unavailable',
  );
  state.error = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByRole('option', { name: 'Alpha Institute (ALPHA)' }),
  ).toBeInTheDocument();
});
it.each([1, 2, 3, 4])(
  'accepts canonical Year %s only after explicit selection',
  (year) => {
    expect(
      registrationSchema.parse({ ...input, yearOfStudy: year }).yearOfStudy,
    ).toBe(year);
  },
);
it.each([undefined, 0, -1, 5, 2.5, '2', 'First Year'])(
  'rejects invalid/missing registration year %j',
  (year) =>
    expect(
      registrationSchema.safeParse({ ...input, yearOfStudy: year }).success,
    ).toBe(false),
);
it('reads legacy profiles without a year and displays the resolved College plus missing-data state', () => {
  const parsed = profileSchema.parse({
    ...input,
    yearOfStudy: undefined,
    id: 'profile',
    userId: 'user',
    studentUsername: 'permanent',
    verificationStatus: 'VERIFIED',
    revision: 0,
    qrCredentialVersion: 1,
    createdAt: '2030-01-01T00:00:00Z',
    updatedAt: '2030-01-01T00:00:00Z',
  });
  render(<ProfileFacts profile={parsed} college="Resolved Institute" />);
  expect(screen.getByText('Not provided')).toBeInTheDocument();
  expect(screen.getByText('Resolved Institute')).toBeInTheDocument();
  expect(screen.queryByText(college)).not.toBeInTheDocument();
});
