import Link from 'next/link';
import { ArrowLeft, Sprout, ArrowUpRight } from 'lucide-react';
import { Brand, ThemeToggle } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
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
          <Button disabled variant="outline" className="google-button">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.12H3.04v2.59A10 10 0 0 0 12 22ZM6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.49H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.51l3.35-2.59ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.35 2.59C7.18 7.72 9.39 5.96 12 5.96Z"
              />
            </svg>{' '}
            Continue with Google
          </Button>
          <div className="notice">
            <strong>Your doorway is taking shape.</strong>
            <p>
              Google sign-in will be available in a future phase. No account is
              created and no information is collected here.
            </p>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <div className="preview-links">
              <span>Development shell previews</span>
              {['student', 'admin', 'super-admin'].map((role) => (
                <Link key={role} href={'/preview/' + role}>
                  {role.replaceAll('-', ' ')} <ArrowUpRight size={14} />
                </Link>
              ))}
            </div>
          )}
          <HealthIndicator />
        </div>
        <small>Learn with intention. Grow with Algora.</small>
      </section>
    </main>
  );
}
