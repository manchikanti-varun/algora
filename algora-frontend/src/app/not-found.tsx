import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-indigo-600">404</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">This page does not exist or you do not have access to it.</p>
        <Link href="/" className="mt-5 inline-block rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">Go home</Link>
      </div>
    </main>
  );
}
