import { ButtonLink } from '@/components/ui';

import { PageTitle } from '@/components/PageTitle';
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6">
      <PageTitle title="Page not found" />
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-accent-fg">404</p>
        <h1 className="mt-1 text-xl font-semibold text-fg">Page not found</h1>
        <p className="mt-2 text-sm text-fg-muted">This page does not exist, or you do not have access to it.</p>
        <div className="mt-5"><ButtonLink href="/">Go home</ButtonLink></div>
      </div>
    </main>
  );
}
