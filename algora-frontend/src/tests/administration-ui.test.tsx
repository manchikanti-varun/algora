import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast, Toaster } from 'sonner';
import { SuperAdminOverview } from '@/features/super-admin/overview';
import { AdminAccessPage } from '@/features/admin-requests/request-page';
import { AdminApprovals } from '@/features/admin-requests/review';
import { CollegeManagement } from '@/features/colleges/management';
import { OwnAdminScope } from '@/features/admin-management/own-scope';
import { AdminManagement } from '@/features/admin-management/management';
import { ApiError } from '@/lib/api/client';
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  authError: null as Error | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks }));
const user = {
  id: 'a'.repeat(24),
  email: 'learner@example.test',
  emailVerified: true,
  displayName: 'Alice Morgan',
  role: 'STUDENT' as const,
  accountStatus: 'PENDING' as const,
  registrationStatus: 'NOT_STARTED' as const,
};
vi.mock('@/features/auth/provider', () => ({
  useAuth: () => ({
    user: {
      id: 'a'.repeat(24),
      email: 'learner@example.test',
      role: 'STUDENT',
      accountStatus: 'PENDING',
      registrationStatus: 'NOT_STARTED',
    },
    loading: false,
    error: mocks.authError,
    logout: vi.fn(),
  }),
}));
const college = {
  id: 'b'.repeat(24),
  name: 'Example Institute',
  code: 'EXAMPLE',
  slug: 'example-institute',
  city: 'Example City',
  state: 'Example State',
  country: 'Example Country',
  status: 'ACTIVE',
  revision: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const pending = {
  id: 'c'.repeat(24),
  requesterUserId: user.id,
  fullName: user.displayName,
  email: user.email,
  requestedCollegeIds: [college.id],
  reason:
    'I support our college learning community and need administrative access.',
  status: 'PENDING',
  reviewNote: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const paged = <T,>(items: T[], extras: Record<string, unknown> = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalPages: items.length ? 1 : 0,
  ...extras,
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status >= 400
        ? {
            success: false,
            error: {
              code: 'UNAVAILABLE',
              message: 'Service temporarily unavailable',
            },
          }
        : { success: true, data },
    ),
    { status },
  );
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      {children}
      <Toaster />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authError = null;
});
afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
});
describe('administration loading/error/real-data states', () => {
  it('does not fabricate metrics while loading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    wrap(<SuperAdminOverview />);
    expect(
      screen.getByLabelText('Loading administration data'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Total colleges')).not.toBeInTheDocument();
  });
  it('shows database failure without invented zero metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 503)));
    wrap(<SuperAdminOverview />);
    await screen.findByRole('alert');
    expect(
      screen.getByText('Administration is unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Total colleges')).not.toBeInTheDocument();
  });
  it('renders actual overview values and activity from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          totalColleges: 7,
          activeColleges: 6,
          totalAdmins: 4,
          activeAdmins: 3,
          pendingRequests: 2,
          recentActivity: [],
        }),
      ),
    );
    wrap(<SuperAdminOverview />);
    await screen.findByText('Total colleges');
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('A clear starting point')).toBeInTheDocument();
  });
  it('renders only the returned Admin scope without course metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        response(
          url.includes('/admin/me')
            ? {
                user: {
                  id: user.id,
                  displayName: user.displayName,
                  email: user.email,
                  role: 'ADMIN',
                  accountStatus: 'ACTIVE',
                  username: 'ad-alicemorgan',
                  revision: 1,
                },
              }
            : {
                items: [
                  {
                    ...college,
                    permissions: ['college.view'],
                    accessStatus: 'ACTIVE',
                  },
                ],
                unavailableAssignments: 1,
              },
        ),
      ),
    );
    wrap(<OwnAdminScope />);
    await screen.findByText(college.name);
    expect(screen.getByText(/ad-alicemorgan/)).toBeInTheDocument();
    expect(screen.queryByText('Total students')).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 assignment\(s\) currently unavailable/),
    ).toBeInTheDocument();
  });
});
describe('authenticated Admin access request UI', () => {
  it.each([
    [401, 'SESSION_EXPIRED', '/login?reason=session-expired'],
    [403, 'ACCOUNT_SUSPENDED', '/account-suspended'],
    [503, 'AUTH_UNAVAILABLE', '/login?error=unavailable'],
  ] as const)(
    'routes authentication failure %s without showing the request form',
    async (status, code, path) => {
      mocks.authError = new ApiError(status, code, 'Unavailable');
      vi.stubGlobal('fetch', vi.fn());
      wrap(<AdminAccessPage user={user} />);
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(path));
      expect(
        screen.queryByLabelText('Verified Google email'),
      ).not.toBeInTheDocument();
    },
  );
  function setup() {
    let records: (typeof pending)[] = [];
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/csrf'))
        return response({ csrfToken: 'test-csrf' });
      if (url.includes('/eligible-colleges')) return response(paged([college]));
      if (url.includes('/admin-access-requests/me'))
        return response(
          paged(records, {
            pending: records.some((r) => r.status === 'PENDING'),
          }),
        );
      if (options?.method === 'POST') {
        records = [pending];
        return response(pending, 201);
      }
      return response(null, 503);
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  it('supports incomplete students and uses read-only verified email', async () => {
    setup();
    wrap(<AdminAccessPage user={user} />);
    await screen.findByLabelText('Verified Google email');
    expect(screen.getByLabelText('Verified Google email')).toHaveAttribute(
      'readonly',
    );
    expect(screen.queryByLabelText(/roll number/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Student registration and a roll number are not required/,
      ),
    ).toBeInTheDocument();
  });
  it('validates required college and reason before submitting', async () => {
    const fetch = setup();
    wrap(<AdminAccessPage user={user} />);
    await screen.findByRole('button', { name: 'Submit access request' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit access request' }),
    );
    await screen.findByText('Select at least one college');
    expect(
      screen.getByText('Please provide at least 20 characters'),
    ).toBeInTheDocument();
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    );
  });
  it('submits only allowlisted fields with CSRF and displays pending review', async () => {
    const fetch = setup();
    wrap(<AdminAccessPage user={user} />);
    const choice = await screen.findByRole('checkbox', {
      name: /Example Institute/,
    });
    fireEvent.click(choice);
    fireEvent.change(screen.getByLabelText('Reason for requesting access'), {
      target: { value: pending.reason },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit access request' }),
    );
    await screen.findByText('Your request is awaiting review.');
    const call = fetch.mock.calls.find((call) => call[1]?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      fullName: user.displayName,
      collegeIds: [college.id],
      reason: pending.reason,
    });
    expect(call[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
    expect(call[1]?.credentials).toBe('include');
  });
  it('shows only shared rejection feedback and permits a fresh request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        response(
          url.includes('/eligible-colleges')
            ? paged([college])
            : paged(
                [
                  {
                    ...pending,
                    status: 'REJECTED',
                    reviewNote: 'Please provide more institutional context.',
                  },
                ],
                { pending: false },
              ),
        ),
      ),
    );
    wrap(<AdminAccessPage user={user} />);
    await screen.findByText('Please provide more institutional context.');
    expect(
      screen.getByRole('button', { name: 'Submit access request' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Private review fixture'),
    ).not.toBeInTheDocument();
  });
  it('requires confirmation before cancelling a pending request', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) =>
      response(
        url.endsWith('/auth/csrf')
          ? { csrfToken: 'test-csrf' }
          : options?.method === 'POST'
            ? { ...pending, status: 'CANCELLED' }
            : paged([pending], { pending: true }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    wrap(<AdminAccessPage user={user} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel pending request' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel this access request?',
    });
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          (call) =>
            String(call[0]).endsWith('/' + pending.id + '/cancel') &&
            call[1]?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
describe('Super Admin approvals and college forms', () => {
  function reviewSetup() {
    let status = 'PENDING';
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/csrf'))
        return response({ csrfToken: 'test-csrf' });
      if (url.endsWith('/permissions'))
        return response({
          permissions: [
            {
              key: 'college.view',
              label: 'college · view',
              availableNow: true,
            },
            {
              key: 'course.manage',
              label: 'course · manage',
              availableNow: false,
            },
          ],
        });
      if (options?.method === 'POST') {
        status = url.endsWith('/approve') ? 'APPROVED' : 'REJECTED';
        return response({ updated: true });
      }
      if (url.includes('/admin-requests/' + pending.id))
        return response({
          ...pending,
          status,
          colleges: [college],
          internalNote: '',
        });
      if (url.includes('/admin-requests?'))
        return response(paged([{ ...pending, status }]));
      return response(null, 503);
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  it('requires explicit confirmation and sends scoped approval grants', async () => {
    const fetch = reviewSetup();
    wrap(<AdminApprovals />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review Alice Morgan' }),
    );
    await screen.findByText('Requester’s reason'.toUpperCase());
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve admin access' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Approve this administrator?',
    });
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    );
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Confirm' }),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some((call) => String(call[0]).endsWith('/approve')),
      ).toBe(true),
    );
    const approval = fetch.mock.calls.find((call) =>
      String(call[0]).endsWith('/approve'),
    )!;
    expect(JSON.parse(String(approval[1]?.body)).assignments).toEqual([
      { collegeId: college.id, permissions: ['college.view'] },
    ]);
  });
  it('validates shared rejection notes before opening confirmation', async () => {
    reviewSetup();
    wrap(<AdminApprovals />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review Alice Morgan' }),
    );
    await screen.findByRole('button', { name: 'Reject request' });
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    await screen.findByText(
      'Provide at least 10 characters explaining the rejection',
    );
    expect(
      screen.queryByRole('dialog', { name: 'Reject this request?' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message shared with requester'), {
      target: { value: 'Please provide more institutional context.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    await screen.findByRole('dialog', { name: 'Reject this request?' });
  });
  it('validates a college form before sending a creation request', async () => {
    const fetch = vi.fn().mockResolvedValue(response(paged([])));
    vi.stubGlobal('fetch', fetch);
    wrap(<CollegeManagement />);
    fireEvent.click(screen.getByRole('button', { name: 'Add college' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a college' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create college' }),
    );
    await waitFor(() =>
      expect(within(dialog).getAllByRole('alert').length).toBeGreaterThan(0),
    );
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    );
  });
  it('paginates college records through backend query parameters', async () => {
    const fetch = vi.fn(async (url: string) =>
      response(
        paged(
          [
            {
              ...college,
              name: url.includes('page=2') ? 'Second Institute' : college.name,
            },
          ],
          { total: 11, totalPages: 2, page: url.includes('page=2') ? 2 : 1 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    wrap(<CollegeManagement />);
    await screen.findByText(college.name);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Second Institute');
    expect(
      fetch.mock.calls.some((call) => String(call[0]).includes('page=2')),
    ).toBe(true);
  });
  it('confirms suspension and uses the latest admin revision', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/auth/csrf'))
        return response({ csrfToken: 'test-csrf' });
      if (options?.method === 'PATCH') return response({ updated: true });
      if (url.includes('/admins/' + user.id))
        return response({
          user: {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            username: 'ad-alicemorgan',
            role: 'ADMIN',
            accountStatus: 'ACTIVE',
            revision: 3,
          },
          assignments: [],
        });
      if (url.includes('/admins?'))
        return response(
          paged([
            {
              id: user.id,
              displayName: user.displayName,
              email: user.email,
              username: 'ad-alicemorgan',
              role: 'ADMIN',
              accountStatus: 'ACTIVE',
              revision: 3,
            },
          ]),
        );
      if (url.includes('/colleges?')) return response(paged([college]));
      if (url.endsWith('/permissions')) return response({ permissions: [] });
      return response(null, 503);
    });
    vi.stubGlobal('fetch', fetch);
    wrap(<AdminManagement />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage Alice Morgan' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Suspend admin' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Suspend this administrator?',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(
        true,
      ),
    );
    const call = fetch.mock.calls.find((call) => call[1]?.method === 'PATCH')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      status: 'SUSPENDED',
      expectedRevision: 3,
    });
  });
});
