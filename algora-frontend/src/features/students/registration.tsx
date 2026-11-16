'use client';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { apiGet } from '@/lib/api/client';
import { useAuth } from '@/features/auth/provider';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  Field,
  QueryState,
  Confirmation,
  Pagination,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { StudentShell } from './shell';
import {
  optionsSchema,
  registrationSchema,
  rollSchema,
  type RegistrationInput,
} from './contracts';
const labels = {
  fullName: 'Full name',
  rollNumber: 'Roll number',
  phoneNumber: 'Phone number',
  leetCodeUsername: 'LeetCode username',
  codeforcesUsername: 'Codeforces username',
  codechefUsername: 'CodeChef username',
} as const;
export function Registration() {
  const auth = useAuth(),
    router = useRouter(),
    client = useQueryClient();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [review, setReview] = useState<RegistrationInput | null>(null),
    [confirm, setConfirm] = useState(false),
    [debounced, setDebounced] = useState('');
  const options = useAdministration(
    '/students/registration-options?page=' +
      page +
      '&search=' +
      encodeURIComponent(search),
    optionsSchema,
    !!auth.user && !auth.error,
    true,
  );
  const command = useCommand();
  const form = useForm<RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      fullName: '',
      rollNumber: '',
      phoneNumber: '',
      collegeId: '',
      department: '',
      yearOfStudy: undefined,
      leetCodeUsername: '',
      codeforcesUsername: '',
      codechefUsername: '',
    },
  });
  const roll = useWatch({ control: form.control, name: 'rollNumber' });
  useEffect(() => {
    const t = setTimeout(() => setDebounced(roll), 450);
    return () => clearTimeout(t);
  }, [roll]);
  const validRoll = rollSchema.safeParse(debounced);
  const availability = useQuery({
    queryKey: ['roll-availability', debounced],
    queryFn: ({ signal }) =>
      apiGet(
        '/students/roll-number-availability?rollNumber=' +
          encodeURIComponent(debounced),
        z.object({ available: z.boolean(), rollNumber: z.string() }),
        signal,
      ),
    enabled: validRoll.success && !!auth.user && !auth.error,
    retry: false,
  });
  const [chosenCollege, setChosenCollege] = useState<{
    id: string;
    name: string;
  } | null>(null);
  async function submit() {
    if (!review) return;
    try {
      await command.mutateAsync({
        path: '/students/register',
        body: { ...review, confirmed: true },
      });
      await client.invalidateQueries({ queryKey: ['auth'] });
      router.replace('/student/profile');
      router.refresh();
    } catch {
      setConfirm(false);
    }
  }
  return (
    <StudentShell
      title="Make it yours."
      description="One student identity. A permanent username. Your next chapter starts here."
    >
      <QueryState
        pending={options.isPending}
        error={options.error}
        onRetry={() => void options.refetch()}
      >
        <div className="student-notice">
          Registration records your details; your college identity remains
          pending until an authorized reviewer verifies it. Phone and coding
          account ownership are not verified.
        </div>
        <form
          onSubmit={form.handleSubmit((v) => setReview(v))}
          className="student-form"
        >
          <section className="student-card">
            <span className="eyebrow">01 / PERSONAL INFORMATION</span>
            <h2>A name behind the ambition</h2>
            <div className="student-grid">
              {(['fullName', 'rollNumber', 'phoneNumber'] as const).map(
                (key) => (
                  <Field
                    key={key}
                    label={labels[key]}
                    error={form.formState.errors[key]?.message}
                  >
                    <input
                      aria-label={labels[key]}
                      autoComplete={
                        key === 'fullName'
                          ? 'name'
                          : key === 'phoneNumber'
                            ? 'tel'
                            : 'off'
                      }
                      type={key === 'phoneNumber' ? 'tel' : 'text'}
                      {...form.register(key)}
                      onBlur={
                        key === 'rollNumber'
                          ? () =>
                              form.setValue(
                                'rollNumber',
                                roll.trim().toUpperCase(),
                                { shouldValidate: true },
                              )
                          : undefined
                      }
                      placeholder={
                        key === 'phoneNumber'
                          ? '+1 202 555 0123'
                          : key === 'rollNumber'
                            ? '23A91A05B2'
                            : undefined
                      }
                    />
                  </Field>
                ),
              )}
              <Field label="Verified Google email">
                <input
                  aria-label="Verified Google email"
                  readOnly
                  value={auth.user?.email ?? ''}
                />
              </Field>
            </div>
            <p role="status">
              {availability.isFetching
                ? 'Checking roll number…'
                : availability.data
                  ? availability.data.available
                    ? 'Roll number is currently available; submission checks again.'
                    : 'This roll number is unavailable.'
                  : availability.error
                    ? 'Availability check unavailable; submission still validates uniqueness.'
                    : 'Exactly 10 ASCII letters or digits. Lowercase becomes uppercase.'}
            </p>
          </section>
          <section className="student-card">
            <span className="eyebrow">02 / ACADEMIC INFORMATION</span>
            <h2>Your learning community</h2>
            <Field label="Find your college">
              <input
                aria-label="Find your college"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            {options.isFetching && (
              <p role="status">Loading ACTIVE Colleges…</p>
            )}
            <div className="student-grid">
              <Field
                label="College"
                error={form.formState.errors.collegeId?.message}
              >
                <select
                  aria-label="College"
                  disabled={options.isFetching}
                  {...form.register('collegeId')}
                  onChange={(e) => {
                    form.setValue('collegeId', e.target.value, {
                      shouldValidate: true,
                    });
                    setChosenCollege(
                      options.data?.colleges.items.find(
                        (c) => c.id === e.target.value,
                      ) ?? null,
                    );
                  }}
                >
                  <option value="">Select an active college</option>
                  {chosenCollege &&
                    !options.data?.colleges.items.some(
                      (c) => c.id === chosenCollege.id,
                    ) && (
                      <option value={chosenCollege.id}>
                        {chosenCollege.name}
                      </option>
                    )}
                  {options.data?.colleges.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </Field>
              {!options.data?.colleges.items.length && (
                <p role="status">
                  No ACTIVE Colleges match your search. Try another search or
                  ask your institution to contact the platform administrator.
                </p>
              )}
              <Field
                label="Department"
                error={form.formState.errors.department?.message}
              >
                <input
                  aria-label="Department"
                  list="departments"
                  {...form.register('department')}
                />
                <datalist id="departments">
                  {options.data?.departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              <Field
                label="Year of study"
                error={form.formState.errors.yearOfStudy?.message}
              >
                <select
                  aria-label="Year of study"
                  {...form.register('yearOfStudy', { valueAsNumber: true })}
                >
                  <option value="">Select Year of Study</option>
                  {[1, 2, 3, 4].map((y) => (
                    <option key={y} value={y}>
                      {['1st Year', '2nd Year', '3rd Year', '4th Year'][y - 1]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {options.data && (
              <Pagination
                page={page}
                total={options.data.colleges.total}
                totalPages={options.data.colleges.totalPages}
                onChange={setPage}
              />
            )}
          </section>
          <section className="student-card">
            <span className="eyebrow">03 / CODING PROFILES</span>
            <h2>Connect your practice</h2>
            <p>
              All three handles are required. No external account access or
              ownership verification is performed.
            </p>
            <div className="student-grid">
              {(
                [
                  'leetCodeUsername',
                  'codeforcesUsername',
                  'codechefUsername',
                ] as const
              ).map((key) => (
                <Field
                  key={key}
                  label={labels[key]}
                  error={form.formState.errors[key]?.message}
                >
                  <input
                    aria-label={labels[key]}
                    autoComplete="off"
                    {...form.register(key)}
                  />
                </Field>
              ))}
            </div>
          </section>
          <Button type="submit" disabled={command.isPending}>
            Review registration
          </Button>
        </form>
        {review && (
          <section className="student-card" aria-label="Registration review">
            <h2>Review & submit</h2>
            <dl className="student-grid">
              {Object.entries({
                ...review,
                collegeId: chosenCollege?.name ?? review.collegeId,
                email: auth.user?.email,
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
            <p>
              Your student username will be permanent. Roll numbers are globally
              unique and later identity changes require review.
            </p>
            <Button
              onClick={() => setConfirm(true)}
              disabled={command.isPending}
            >
              Submit registration
            </Button>
          </section>
        )}
        <Confirmation
          open={confirm}
          title="Create your permanent student identity?"
          description="Confirm your name, roll number and college. Registration does not automatically verify your institutional identity."
          busy={command.isPending}
          onClose={() => setConfirm(false)}
          onConfirm={() => void submit()}
        />
        {command.error && <p role="alert">{command.error.message}</p>}
      </QueryState>
    </StudentShell>
  );
}
