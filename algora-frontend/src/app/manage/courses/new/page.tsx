'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Input, Notice, PageHeader, Textarea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
export default function Page() {
  const router = useRouter(); const toast = useToast(); const { user } = useAuth();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  if (!user?.canManageCourses) return <Notice tone="warn">You do not have permission to create courses. Ask the Super Admin to enable course editing.</Notice>;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(undefined);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try { const c = await api<{ _id: string }>('/courses', { method: 'POST', body: f }); toast.success('Course created'); router.push(`/manage/courses/${c._id}`); }
    catch (e2) { setErr(errorMessage(e2)); setBusy(false); }
  }
  return (
    <div className="max-w-2xl">
      <PageHeader title="New course" breadcrumbs={[{ label: 'Courses', href: '/manage/courses' }, { label: 'New course' }]}
        subtitle="Courses start as drafts. Add chapters and problems, then publish to make the course available to batches." />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {err && <Notice tone="error">{err}</Notice>}
          <Input label="Title" name="title" required maxLength={150} placeholder="Java & DSA" autoFocus />
          <Textarea label="Description" name="description" maxLength={5000} rows={4} />
          <div className="flex gap-2"><Button loading={busy} type="submit">Create course</Button><Button variant="ghost" type="button" onClick={() => router.push('/manage/courses')}>Cancel</Button></div>
        </form>
      </Card>
    </div>
  );
}
