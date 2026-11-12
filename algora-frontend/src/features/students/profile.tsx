'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import {
  Field,
  QueryState,
  Status,
  Confirmation,
  Pagination,
} from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { StudentShell } from './shell';
import {
  meStudentSchema,
  contactFields,
  academicFields,
  correctionSchema,
  pageSchema,
  optionsSchema,
  type StudentProfile,
  type Correction,
} from './contracts';
export function ProfileFacts({
  profile: p,
  email,
  college,
}: {
  profile: StudentProfile;
  email?: string;
  college?: string;
}) {
  return (
    <dl className="student-grid">
      {Object.entries({
        'Full name': p.fullName,
        'Roll number': p.rollNumber,
        'Permanent student username': p.studentUsername,
        'Verified Google email': email ?? 'Not included in this view',
        Phone: p.phoneNumber,
        College: college ?? p.collegeId,
        Department: p.department,
        'Year of study': p.yearOfStudy,
        LeetCode: p.leetCodeUsername,
        Codeforces: p.codeforcesUsername,
        CodeChef: p.codechefUsername,
        'Verification method': p.verificationMethod ?? 'Not yet verified',
        'Reviewed at': p.verifiedAt
          ? new Date(p.verifiedAt).toLocaleString()
          : 'Not yet reviewed',
      }).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
const editForm = z.object(contactFields);
function ContactEditor({ profile: p }: { profile: StudentProfile }) {
  const command = useCommand();
  const f = useForm<z.infer<typeof editForm>>({
    resolver: zodResolver(editForm),
    defaultValues: {
      phoneNumber: p.phoneNumber,
      leetCodeUsername: p.leetCodeUsername,
      codeforcesUsername: p.codeforcesUsername,
      codechefUsername: p.codechefUsername,
    },
  });
  return (
    <form
      onSubmit={f.handleSubmit(async (body) => {
        try {
          await command.mutateAsync({
            path: '/students/me',
            method: 'PATCH',
            body: { ...body, expectedRevision: p.revision },
          });
        } catch {}
      })}
    >
      <h2>Contact & coding profiles</h2>
      <p>
        These fields can be updated directly. Phone and platform account
        ownership are not verified.
      </p>
      <div className="student-grid">
        {(Object.keys(contactFields) as (keyof typeof contactFields)[]).map(
          (key) => (
            <Field
              key={key}
              label={key}
              error={f.formState.errors[key]?.message}
            >
              <input aria-label={key} {...f.register(key)} />
            </Field>
          ),
        )}
      </div>
      <div className="student-actions">
        <Button disabled={command.isPending}>Save profile changes</Button>
      </div>
      {command.error && <p role="alert">{command.error.message}</p>}
    </form>
  );
}
const correctionForm = z.object({
  ...academicFields,
  reason: z.string().trim().min(15).max(1000),
});
function CorrectionEditor({ profile: p }: { profile: StudentProfile }) {
  const command = useCommand();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState('');
  const options = useAdministration(
    '/students/registration-options?page=' +
      page +
      '&search=' +
      encodeURIComponent(search),
    optionsSchema,
  );
  const f = useForm<z.infer<typeof correctionForm>>({
    resolver: zodResolver(correctionForm),
    defaultValues: {
      fullName: p.fullName,
      rollNumber: p.rollNumber,
      collegeId: p.collegeId,
      department: p.department,
      yearOfStudy: p.yearOfStudy,
      reason: '',
    },
  });
  return (
    <form
      onSubmit={f.handleSubmit(async (values) => {
        const requestedChanges = Object.fromEntries(
          Object.entries(values).filter(
            ([k, v]) => k !== 'reason' && p[k as keyof StudentProfile] !== v,
          ),
        );
        if (!Object.keys(requestedChanges).length) {
          f.setError('root', { message: 'Change at least one identity field' });
          return;
        }
        try {
          await command.mutateAsync({
            path: '/students/me/correction-requests',
            body: {
              requestedChanges,
              reason: values.reason,
              expectedRevision: p.revision,
            },
          });
          f.reset({ ...values, reason: '' });
        } catch {}
      })}
    >
      <h2>Request an identity correction</h2>
      <p>
        Name, roll number, college, department and year require review. Your
        username remains permanent. Approved corrections reset institutional
        verification. College transfers require Super Admin review.
      </p>
      <div className="student-grid">
        {(['fullName', 'rollNumber', 'department'] as const).map((key) => (
          <Field key={key} label={key} error={f.formState.errors[key]?.message}>
            <input aria-label={'Correct ' + key} {...f.register(key)} />
          </Field>
        ))}
        <Field label="Year of study">
          <select
            aria-label="Correct year of study"
            {...f.register('yearOfStudy', { valueAsNumber: true })}
          >
            {[1, 2, 3, 4].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Find college">
          <input
            aria-label="Find correction college"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="College" error={f.formState.errors.collegeId?.message}>
          <select aria-label="Correct college" {...f.register('collegeId')}>
            <option value={p.collegeId}>Current college</option>
            {options.data?.colleges.items
              .filter((c) => c.id !== p.collegeId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {options.data && (
        <Pagination
          page={page}
          totalPages={options.data.colleges.totalPages}
          total={options.data.colleges.total}
          onChange={setPage}
        />
      )}
      <Field
        label="Correction reason"
        error={f.formState.errors.reason?.message}
      >
        <textarea aria-label="Correction reason" {...f.register('reason')} />
      </Field>
      {options.error && (
        <p role="alert">College options unavailable: {options.error.message}</p>
      )}
      <Button disabled={command.isPending}>Request correction</Button>
      {f.formState.errors.root && (
        <p role="alert">{f.formState.errors.root.message}</p>
      )}
      {command.error && <p role="alert">{command.error.message}</p>}
    </form>
  );
}
function CorrectionHistory() {
  const [page, setPage] = useState(1),
    [cancel, setCancel] = useState<Correction | null>(null);
  const q = useAdministration(
    '/students/me/correction-requests?page=' + page,
    pageSchema(correctionSchema),
  );
  const command = useCommand();
  return (
    <section className="student-card">
      <h2>Correction history</h2>
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data?.items.length === 0 && <p>No correction requests yet.</p>}
        {q.data?.items.map((c) => (
          <article className="student-correction" key={c.id}>
            <Status value={c.status} />
            <p>{c.reason}</p>
            <dl>
              {Object.entries(c.requestedChanges).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {c.reviewNote && <p>Reviewer response: {c.reviewNote}</p>}
            {c.status === 'PENDING' && (
              <Button variant="outline" onClick={() => setCancel(c)}>
                Cancel correction
              </Button>
            )}
          </article>
        ))}
        {q.data && (
          <Pagination
            page={page}
            total={q.data.total}
            totalPages={q.data.totalPages}
            onChange={setPage}
          />
        )}
      </QueryState>
      <Confirmation
        open={!!cancel}
        title="Cancel correction request?"
        description="You can submit a new request after cancellation."
        busy={command.isPending}
        onClose={() => setCancel(null)}
        onConfirm={() => {
          if (cancel)
            void command
              .mutateAsync({
                path:
                  '/students/me/correction-requests/' + cancel.id + '/cancel',
              })
              .then(() => setCancel(null))
              .catch(() => {});
        }}
      />
    </section>
  );
}
export function StudentProfilePage() {
  const q = useAdministration('/students/me', meStudentSchema);
  return (
    <StudentShell
      title="Your student profile."
      description="A clear view of your identity, verification and practice profiles."
    >
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        {q.data && (
          <>
            <section className="student-card">
              <Status value={q.data.profile.verificationStatus} />
              <h2>{q.data.profile.fullName}</h2>
              <ProfileFacts
                profile={q.data.profile}
                email={q.data.email}
                college={q.data.college?.name}
              />
              {q.data.profile.verificationNote && (
                <p>Reviewer response: {q.data.profile.verificationNote}</p>
              )}
              <div className="student-notice">
                {q.data.profile.verificationStatus === 'VERIFIED'
                  ? 'Institutional identity verified. Enrollment and batch access are separate future workflows.'
                  : 'Your registration is complete. Institutional verification is required before verified learning access.'}
              </div>
              <Link href="/student/my-qr">View your permanent QR</Link>
            </section>
            <section className="student-card">
              <ContactEditor
                key={q.data.profile.revision}
                profile={q.data.profile}
              />
            </section>
            <section className="student-card">
              <CorrectionEditor
                key={q.data.profile.revision}
                profile={q.data.profile}
              />
            </section>
            <CorrectionHistory />
          </>
        )}
      </QueryState>
    </StudentShell>
  );
}
