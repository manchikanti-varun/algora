'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Confirmation,
  Field,
  Pagination,
  QueryState,
  Status,
} from '@/components/shared/admin-ui';
import { CollegeSelection } from '@/features/colleges/selection';
import {
  requestFormSchema,
  requestSchema,
  pageSchema,
  type RequestForm,
} from '@/features/administration/contracts';
import {
  listPath,
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { useAuth } from '@/features/auth/provider';
import { SignOutButtons } from '@/features/auth/sign-out';
import type { PublicUser } from '@/features/auth/contracts';
import { ApiError } from '@/lib/api/client';
export function AdminAccessPage({ user }: { user: PublicUser }) {
  const auth = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [cancel, setCancel] = useState<string | null>(null);
  const command = useCommand();
  const query = useAdministration(
    listPath('/admin-access-requests/me', { page }),
    pageSchema(requestSchema).extend({ pending: z.boolean() }),
    !auth.error && !auth.loading && !!auth.user,
  );
  const form = useForm<RequestForm>({
    resolver: zodResolver(requestFormSchema),
    defaultValues: { fullName: user.displayName, collegeIds: [], reason: '' },
  });
  const selected = useWatch({ control: form.control, name: 'collegeIds' });
  const hasPending = query.data?.pending ?? false;
  useEffect(() => {
    if (!auth.loading && auth.error)
      router.replace(
        auth.error instanceof ApiError &&
          auth.error.code === 'ACCOUNT_SUSPENDED'
          ? '/account-suspended'
          : auth.error instanceof ApiError && auth.error.status === 401
            ? '/login?reason=session-expired'
            : '/login?error=unavailable',
      );
  }, [auth.loading, auth.error, router]);
  async function submit(data: RequestForm) {
    try {
      await command.mutateAsync({ path: '/admin-access-requests', body: data });
      form.reset({ ...data, collegeIds: [], reason: '' });
      setPage(1);
    } catch {}
  }
  if (auth.loading || !auth.user || auth.error)
    return (
      <div className="auth-loading" role="status">
        Verifying your Google session…
      </div>
    );
  return (
    <main id="main" className="request-access-page wrap">
      <header>
        <Brand />
        <div>
          <ThemeToggle />
          <SignOutButtons />
        </div>
      </header>
      <div className="request-access-heading">
        <span className="eyebrow">BRING YOUR LEARNING COMMUNITY TO ALGORA</span>
        <h1>
          A little initiative.
          <br />A wider impact.
        </h1>
        <p>
          Request administrator access using your verified Google account.
          Student registration and a roll number are not required.
        </p>
        <Link href="/registration-required" className="text-link">
          Back to your account
        </Link>
      </div>
      <div className="admin-grid-two">
        <Card>
          <h2 className="small-heading">Request admin access</h2>
          <p className="field-help">
            A Super Admin reviews your colleges, reason and permission scope
            before access is granted.
          </p>
          <QueryState
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          >
            {hasPending ? (
              <div className="notice">
                <strong>Your request is awaiting review.</strong>
                <p>
                  You may cancel the pending request below. Duplicate pending
                  submissions are not allowed.
                </p>
              </div>
            ) : (
              query.data && (
                <form
                  className="admin-form"
                  onSubmit={form.handleSubmit(submit)}
                >
                  <fieldset disabled={command.isPending}>
                    <Field
                      label="Full name"
                      error={form.formState.errors.fullName?.message}
                    >
                      <input
                        aria-label="Full name"
                        {...form.register('fullName')}
                        aria-invalid={!!form.formState.errors.fullName}
                      />
                    </Field>
                    <Field label="Verified Google email">
                      <input
                        aria-label="Verified Google email"
                        type="email"
                        readOnly
                        value={user.email}
                      />
                      <small>
                        The backend uses your verified identity, not this input
                        value.
                      </small>
                    </Field>
                    <Field
                      label="Colleges"
                      error={form.formState.errors.collegeIds?.message}
                    >
                      <CollegeSelection
                        eligible
                        value={selected}
                        onChange={(ids) =>
                          form.setValue('collegeIds', ids, {
                            shouldValidate: true,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label="Reason for requesting access"
                      error={form.formState.errors.reason?.message}
                    >
                      <textarea
                        rows={5}
                        aria-label="Reason for requesting access"
                        {...form.register('reason')}
                        aria-invalid={!!form.formState.errors.reason}
                      />
                      <small>
                        20–2000 characters. Do not include secrets or
                        credentials.
                      </small>
                    </Field>
                    <Button type="submit" disabled={command.isPending}>
                      {command.isPending
                        ? 'Submitting…'
                        : 'Submit access request'}
                    </Button>
                  </fieldset>
                </form>
              )
            )}
          </QueryState>
        </Card>
        <Card>
          <h2 className="small-heading">Your request history</h2>
          <p className="field-help">
            Only shared review feedback is displayed. Rejected or cancelled
            requests may be resubmitted; submissions are limited to three per
            hour.
          </p>
          <QueryState
            pending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
          >
            {query.data && (
              <>
                <div className="request-history">
                  {query.data.items.length ? (
                    query.data.items.map((record) => (
                      <article key={record.id}>
                        <div>
                          <Status value={record.status} />
                          <time dateTime={record.createdAt}>
                            {new Date(record.createdAt).toLocaleString()}
                          </time>
                        </div>
                        <h3>{record.fullName}</h3>
                        <p>{record.reason}</p>
                        {record.reviewNote && (
                          <div className="shared-review-note">
                            <strong>Review feedback</strong>
                            <p>{record.reviewNote}</p>
                          </div>
                        )}
                        {record.status === 'PENDING' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={command.isPending}
                            onClick={() => setCancel(record.id)}
                          >
                            Cancel pending request
                          </Button>
                        )}
                        {record.status === 'APPROVED' && (
                          <p>
                            Access was approved. Sign out and sign in with
                            Google again to refresh your role.
                          </p>
                        )}
                      </article>
                    ))
                  ) : (
                    <p>No access requests have been submitted.</p>
                  )}
                </div>
                <Pagination {...query.data} onChange={setPage} />
              </>
            )}
          </QueryState>
        </Card>
      </div>
      <Confirmation
        open={!!cancel}
        title="Cancel this access request?"
        description="A cancelled request cannot be approved. You may submit a new request later within the submission limit."
        busy={command.isPending}
        onClose={() => setCancel(null)}
        onConfirm={() => {
          if (cancel)
            void command
              .mutateAsync({
                path: '/admin-access-requests/' + cancel + '/cancel',
              })
              .then(() => setCancel(null))
              .catch(() => {});
        }}
      />
    </main>
  );
}
