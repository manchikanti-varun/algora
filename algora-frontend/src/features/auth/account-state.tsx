import Link from 'next/link';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SignOutButtons } from './sign-out';
export function AccountState({
  title,
  description,
  signedIn = false,
}: {
  title: string;
  description: string;
  signedIn?: boolean;
}) {
  return (
    <main id="main" className="account-state wrap">
      <header>
        <Brand />
        <ThemeToggle />
      </header>
      <section className="card">
        <span className="account-state-icon">
          <ShieldCheck size={30} />
        </span>
        <span className="eyebrow">YOUR ALGORA ACCOUNT</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {signedIn ? (
          <SignOutButtons />
        ) : (
          <Button asChild>
            <Link href="/login">Back to sign-in</Link>
          </Button>
        )}
        <Link href="/" className="text-link">
          Back to Algora
        </Link>
      </section>
    </main>
  );
}
