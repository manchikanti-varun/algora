'use client'; // Error boundaries must be Client Components
import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui';

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid min-h-[60vh] place-items-center bg-canvas p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-fg">Something went wrong</h1>
        <p className="mt-2 text-sm text-fg-muted">The page could not be displayed. Your data is safe. Try again, or go back home.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <ButtonLink href="/" variant="secondary">Home</ButtonLink>
        </div>
      </div>
    </main>
  );
}
