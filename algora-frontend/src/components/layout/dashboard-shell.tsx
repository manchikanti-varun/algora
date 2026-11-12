'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  ArrowUpRight,
  Menu,
  X,
  PanelLeft,
  Construction,
} from 'lucide-react';
import { navigation, type PreviewRole } from '@/config/navigation';
import { Brand, ThemeToggle } from './header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { HealthIndicator } from '@/components/shared/health-indicator';
export function DashboardShell({ role }: { role: PreviewRole }) {
  const [active, setActive] = useState('Overview');
  const [open, setOpen] = useState(false);
  return (
    <div className="dashboard">
      <aside className={open ? 'sidebar sidebar-open' : 'sidebar'}>
        <div className="sidebar-brand">
          <Brand />
          <Button
            variant="ghost"
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </div>
        <span className="eyebrow">{role.replaceAll('-', ' ')} WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          {navigation[role].map((item) => (
            <button
              key={item}
              aria-current={active === item ? 'page' : undefined}
              className={active === item ? 'active' : ''}
              onClick={() => {
                setActive(item);
                setOpen(false);
              }}
            >
              <LayoutDashboard size={17} />
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Badge>Shell preview</Badge>
          <p>A foundation for what comes next.</p>
          <Link href="/">
            Back to Algora <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-header">
          <Button
            variant="ghost"
            className="mobile-close"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <span>
            <PanelLeft size={17} /> Workspace <span>/</span> {active}
          </span>
          <ThemeToggle />
        </header>
        <main id="main" className="dashboard-content">
          <div className="preview-banner">
            <Construction size={18} />
            <span>
              Development preview · No authentication, user data, or business
              operations are implemented.
            </span>
          </div>
          <div className="dashboard-title">
            <div>
              <span className="eyebrow">SPACE TO BUILD WHAT’S NEXT</span>
              <h1>
                {active === 'Overview' ? 'Your growth starts here.' : active}
              </h1>
              <p>
                {role === 'student'
                  ? 'A clearer view of your learning journey.'
                  : 'A thoughtful foundation for your learning community.'}
              </p>
            </div>
            <Badge>Phase 1</Badge>
          </div>
          {active === 'Overview' ? (
            <>
              <div className="dashboard-cards">
                {[
                  'A place to learn',
                  'A rhythm to follow',
                  'A view of your growth',
                ].map((title, i) => (
                  <Card key={title}>
                    <span className="eyebrow">0{i + 1} / FOUNDATION</span>
                    <h3>{title}</h3>
                    <p>
                      Designed for a future phase. No records or metrics are
                      available yet.
                    </p>
                    <Badge>Coming later</Badge>
                  </Card>
                ))}
              </div>
              <Card>
                <EmptyState
                  title="A fresh beginning"
                  description="This workspace is ready for future features. Real courses, activity, and progress will appear after those features are implemented."
                />
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState
                title={active + ' is on the horizon'}
                description="This navigation preview shows where the feature will live. Functionality will be added in a future phase."
              />
            </Card>
          )}
          <div className="dashboard-status">
            <HealthIndicator />
            <span>
              HTTP connectivity · database readiness is checked separately
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
