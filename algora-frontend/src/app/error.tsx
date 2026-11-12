'use client';
import { Button } from '@/components/ui/button';
export default function ErrorState({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="standalone" role="alert">
      <h1>A small detour.</h1>
      <p>Something went wrong. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
