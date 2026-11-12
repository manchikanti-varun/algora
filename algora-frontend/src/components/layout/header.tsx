'use client';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Moon, Sun, ArrowUpRight, Sprout, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Algora home">
      <span className="brand-icon">
        <Sprout size={25} />
      </span>
      algora<span className="brand-period">.</span>
    </Link>
  );
}
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle color theme"
    >
      <Sun className="sun" size={19} />
      <Moon className="moon" size={19} />
    </Button>
  );
}
export function Header() {
  return (
    <header className="header wrap">
      <Brand />
      <nav className="desktop-nav" aria-label="Main navigation">
        <Link href="/#approach">Our approach</Link>
        <Link href="/#platform">The platform</Link>
        <Link href="/#start">For colleges</Link>
      </nav>
      <div className="header-actions">
        <ThemeToggle />
        <Button asChild variant="outline" size="sm">
          <Link href="/login">
            Enter platform <ArrowUpRight size={15} />
          </Link>
        </Button>
        <details className="mobile-menu">
          <summary aria-label="Open navigation">
            <Menu />
          </summary>
          <nav>
            <Link href="/#approach">Our approach</Link>
            <Link href="/#platform">The platform</Link>
            <Link href="/#start">For colleges</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
