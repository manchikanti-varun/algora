'use client';
import { z } from 'zod';
import { ShieldCheck, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/states';
import { QueryState, Status } from '@/components/shared/admin-ui';
import { useAdministration } from '@/features/administration/queries';
import {
  adminSchema,
  collegeSchema,
  permissionSchema,
} from '@/features/administration/contracts';
const scopeSchema = z.object({
  items: z.array(
    collegeSchema.extend({
      permissions: z.array(permissionSchema),
      accessStatus: z.string(),
    }),
  ),
  unavailableAssignments: z.number(),
});
export function OwnAdminScope() {
  const profile = useAdministration(
    '/admin/me',
    z.object({ user: adminSchema }),
  );
  const scope = useAdministration('/admin/colleges', scopeSchema);
  return (
    <QueryState
      pending={profile.isPending || scope.isPending}
      error={profile.error ?? scope.error}
      onRetry={() => {
        void profile.refetch();
        void scope.refetch();
      }}
    >
      {profile.data && scope.data && (
        <>
          <Card className="scope-profile">
            <ShieldCheck size={28} />
            <div>
              <span className="eyebrow">YOUR VERIFIED ADMIN ACCOUNT</span>
              <h2>{profile.data.user.displayName}</h2>
              <p>
                {profile.data.user.username} · {profile.data.user.email}
              </p>
            </div>
            <Status value={profile.data.user.accountStatus} />
          </Card>
          <div className="section-actions">
            <h2 className="small-heading">Your college access</h2>
            <span>{scope.data.items.length} available colleges</span>
          </div>
          {scope.data.items.length ? (
            <div className="college-card-grid">
              {scope.data.items.map((college) => (
                <Card key={college.id}>
                  <Building2 size={25} />
                  <div className="college-card-title">
                    <h3>{college.name}</h3>
                    <Status value={college.accessStatus} />
                  </div>
                  <p>
                    {college.code} ·{' '}
                    {[college.city, college.state].filter(Boolean).join(', ')}
                  </p>
                  <span className="eyebrow">YOUR PERMISSIONS</span>
                  <div className="permission-tags">
                    {college.permissions.map((permission) => (
                      <span key={permission}>{permission}</span>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                title="No available college access"
                description="Only active colleges with an active assignment and college.view permission appear here. Contact the Super Admin to review your scope."
              />
            </Card>
          )}
          {scope.data.unavailableAssignments > 0 && (
            <div className="notice">
              <strong>
                {scope.data.unavailableAssignments} assignment(s) currently
                unavailable.
              </strong>
              <p>
                Revoked assignments and inactive colleges do not grant access.
                Other colleges are not disclosed.
              </p>
            </div>
          )}
          <p className="field-help future-note">
            Course, batch, enrollment and attendance operations are reserved for
            later phases.
          </p>
        </>
      )}
    </QueryState>
  );
}
