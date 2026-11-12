'use client';
import Link from 'next/link';
import { Building2, CheckCheck, Users, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { QueryState, Status } from '@/components/shared/admin-ui';
import { useAdministration } from '@/features/administration/queries';
import { overviewSchema } from '@/features/administration/contracts';
export function SuperAdminOverview() {
  const query = useAdministration('/super-admin/overview', overviewSchema);
  return (
    <QueryState
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <>
          <div className="metric-grid">
            {[
              {
                label: 'Total colleges',
                value: query.data.totalColleges,
                icon: Building2,
              },
              {
                label: 'Active colleges',
                value: query.data.activeColleges,
                icon: Building2,
              },
              {
                label: 'Total admins',
                value: query.data.totalAdmins,
                icon: Users,
              },
              {
                label: 'Active admins',
                value: query.data.activeAdmins,
                icon: Users,
              },
              {
                label: 'Pending requests',
                value: query.data.pendingRequests,
                icon: CheckCheck,
              },
            ].map((metric) => (
              <Card className="metric-card" key={metric.label}>
                <div>
                  <span>{metric.label}</span>
                  <metric.icon size={19} />
                </div>
                <strong>{metric.value}</strong>
              </Card>
            ))}
          </div>
          <div className="admin-grid-two">
            <Card>
              <div className="panel-heading">
                <h2>Recent activity</h2>
                <Link href="/super-admin/audit" className="text-link">
                  View audit trail <ArrowUpRight size={15} />
                </Link>
              </div>
              {query.data.recentActivity.length ? (
                <ol className="audit-timeline">
                  {query.data.recentActivity.map((event) => (
                    <li key={event.id}>
                      <span className="timeline-marker" />
                      <div>
                        <strong>
                          {event.action.toLowerCase().replaceAll('_', ' ')}
                        </strong>
                        <p>
                          {event.actorName} ·{' '}
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  title="A clear starting point"
                  description="Administrative activity will appear here after audited changes are made."
                />
              )}
            </Card>
            <Card className="next-action-card">
              <Status value="ACTIVE" />
              <h2>
                Thoughtful decisions.
                <br />
                Stronger communities.
              </h2>
              <p>
                Review access requests, keep college records current, and grant
                only the permissions each administrator needs.
              </p>
              <Link
                href="/super-admin/approvals"
                className="button button-primary"
              >
                Review admin requests <ArrowUpRight size={17} />
              </Link>
            </Card>
          </div>
        </>
      )}
    </QueryState>
  );
}
