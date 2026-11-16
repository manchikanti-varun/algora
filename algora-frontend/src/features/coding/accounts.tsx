'use client';
import { useState } from 'react';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { StudentShell } from '@/features/students/shell';
import { QueryState, Status } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
import { accountsSchema, platforms, type accountSchema } from './contracts';
export function CodingAccounts() {
  const q = useAdministration('/coding/accounts', accountsSchema),
    command = useCommand();
  return (
    <StudentShell
      title="Your coding accounts."
      description="Connect a platform account and prove ownership before any solve can count."
    >
      <p className="student-notice">
        Profile usernames are declarations. Only a successful official ownership
        flow can authorize verified progress. LeetCode and CodeChef verification
        is currently unavailable.
      </p>
      {q.data?.syncEnabled === false && (
        <p className="student-notice">
          Background synchronization is disabled by the operator. Queued jobs
          will wait until it is enabled.
        </p>
      )}
      <QueryState
        pending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="learning-card-grid">
          {platforms.map((platform) => (
            <AccountCard
              key={platform}
              platform={platform}
              account={q.data?.accounts.find((a) => a.platform === platform)}
              capability={q.data?.capabilities.find(
                (a) => a.platform === platform,
              )}
              command={command}
            />
          ))}
        </div>
      </QueryState>
    </StudentShell>
  );
}
function AccountCard({
  platform,
  account,
  capability,
  command,
}: {
  platform: (typeof platforms)[number];
  account?: z.infer<typeof accountSchema>;
  capability?: z.infer<typeof accountsSchema>['capabilities'][number];
  command: ReturnType<typeof useCommand>;
}) {
  const [handle, setHandle] = useState(''),
    [notice, setNotice] = useState('');
  return (
    <article className="student-card">
      <span className="eyebrow">{platform}</span>
      <h2>{account?.handle ?? 'No account linked'}</h2>
      <Status value={account?.status ?? 'UNLINKED'} />
      <p>{capability?.ownershipReason}</p>
      <p>{capability?.reason}</p>
      {account?.status === 'VERIFIED' && account.proofExpired && (
        <p role="status">
          Ownership proof expired. Reverify to resume attribution.
        </p>
      )}
      {account && (
        <dl>
          <dt>Last check</dt>
          <dd>
            {account.lastCheckedAt
              ? new Date(account.lastCheckedAt).toLocaleString()
              : 'Never checked'}
          </dd>
          <dt>Sync health</dt>
          <dd>
            <Status value={account.syncStatus} />
            {account.lastError && (
              <p>{account.lastError.replaceAll('_', ' ')}</p>
            )}
          </dd>
          <dt>Ownership expires</dt>
          <dd>
            {account.proofExpiresAt
              ? new Date(account.proofExpiresAt).toLocaleString()
              : 'No verified proof'}
          </dd>
        </dl>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setNotice('');
          try {
            await command.mutateAsync({
              path: '/coding/accounts',
              body: {
                platform,
                handle,
                expectedRevision: account?.revision ?? null,
                confirmed: true,
              },
            });
            setHandle('');
            setNotice(
              'Account saved. Complete ownership verification to enable attribution.',
            );
          } catch {
            setNotice(
              'Account could not be saved. Review the error and try again.',
            );
          }
        }}
      >
        <label htmlFor={'handle-' + platform}>
          {account
            ? 'Replace handle (invalidates current proof)'
            : 'Platform handle'}
        </label>
        <input
          id={'handle-' + platform}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_.-]+"
          autoComplete="off"
        />
        <p>
          Changing the handle suspends current attribution. Historical evidence
          is retained.
        </p>
        <Button disabled={command.isPending} type="submit">
          {account ? 'Save replacement handle' : 'Link handle'}
        </Button>
      </form>
      {account?.active && (
        <div className="admin-actions">
          {platform === 'CODEFORCES' && capability?.ownership && (
            <Button
              disabled={command.isPending}
              onClick={async () => {
                setNotice('');
                try {
                  const value = await command.mutateAsync({
                    path: '/coding/accounts/' + account.id + '/verify',
                    body: {
                      expectedRevision: account.revision,
                      confirmed: true,
                    },
                  });
                  const { authorizationUrl } = z
                    .object({
                      authorizationUrl: z.url().refine((v) => {
                        const u = new URL(v);
                        return (
                          u.origin === 'https://codeforces.com' &&
                          !u.username &&
                          !u.password &&
                          !u.searchParams.has('client_secret') &&
                          u.pathname === '/oauth/authorize'
                        );
                      }),
                    })
                    .parse(value);
                  window.location.assign(authorizationUrl);
                } catch {
                  setNotice('Ownership verification could not start.');
                }
              }}
            >
              Verify with Codeforces
            </Button>
          )}
          <Button
            variant="outline"
            disabled={command.isPending}
            onClick={async () => {
              if (
                !window.confirm(
                  'Disconnect this account and suspend its current progress attribution?',
                )
              )
                return;
              try {
                await command.mutateAsync({
                  path: '/coding/accounts/' + account.id + '/disconnect',
                  body: { expectedRevision: account.revision, confirmed: true },
                });
                setNotice(
                  'Account disconnected. Historical evidence is retained.',
                );
              } catch {
                setNotice('Disconnect failed. Please retry.');
              }
            }}
          >
            Disconnect
          </Button>
        </div>
      )}
      <p role="status">{notice}</p>
    </article>
  );
}
