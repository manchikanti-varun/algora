import Link from 'next/link';
import { ArrowLeft, Sprout } from 'lucide-react';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { Suspense } from 'react';
import { LoginEntry } from '@/features/auth/login-entry';
import { HealthIndicator } from '@/components/shared/health-indicator';
export const metadata = { title: 'Welcome' };
export default function Login() {
  return (
    <main id="main" className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <Sprout size={60} />
          <h1>
            A little curiosity.
            <br />
            Limitless growth.
          </h1>
          <p>Your learning journey deserves a thoughtful home.</p>
        </div>
        <span>ALGORA / WHERE LOGIC GROWS</span>
      </section>
      <section className="login-panel">
        <div className="login-top">
          <Link href="/" className="text-link">
            <ArrowLeft size={17} /> Back home
          </Link>
          <ThemeToggle />
        </div>
        <div className="login-form">
          <span className="eyebrow">WELCOME TO ALGORA</span>
          <h2>Room to grow.</h2>
          <p>A single doorway for students and educators.</p>
          <Suspense
            fallback={
              <div role="status" className="auth-loading">
                Preparing secure sign-in…
              </div>
            }
          >
            <LoginEntry />
          </Suspense>
          <HealthIndicator />
        </div>
        <small>Learn with intention. Grow with Algora.</small>
      </section>
    </main>
  );
}
