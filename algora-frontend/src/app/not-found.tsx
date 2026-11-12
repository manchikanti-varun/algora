import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function NotFound() {
  return (
    <main id="main" className="standalone">
      <span className="eyebrow">404 / A DIFFERENT PATH</span>
      <h1>Let’s find your way back.</h1>
      <p>This page isn’t available.</p>
      <Button asChild>
        <Link href="/">Back to Algora</Link>
      </Button>
    </main>
  );
}
