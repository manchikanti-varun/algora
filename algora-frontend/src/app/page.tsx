import Link from 'next/link';
export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-indigo-600 text-xl font-bold text-white">A</div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Algora</h1>
        <p className="mt-2 text-slate-600">Bootcamp courses, LeetCode practice and progress in one place.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-indigo-300" href="/login"><p className="font-semibold">I am a student</p><p className="text-sm text-slate-500">Courses, problems, progress</p></Link>
          <Link className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-indigo-300" href="/trainer/login"><p className="font-semibold">Trainer or admin</p><p className="text-sm text-slate-500">Batches, courses, analytics</p></Link>
        </div>
      </div>
    </main>
  );
}
