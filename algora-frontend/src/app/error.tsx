'use client'; // Error boundaries must be Client Components
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">The page could not be displayed. Your data is safe. Try again, or go back to your dashboard.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={() => retry()} className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">Try again</button>
          <Link href="/" className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">Home</Link>
        </div>
      </div>
    </main>
  );
}
