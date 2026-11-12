'use client';
import { useState } from 'react';
import { z } from 'zod';
import {
  useAdministration,
  useCommand,
} from '@/features/administration/queries';
import { QueryState, Confirmation } from '@/components/shared/admin-ui';
import { Button } from '@/components/ui/button';
const schema = z.object({
  queues: z.array(
    z.object({
      kind: z.string(),
      pending: z.number(),
      failed: z.array(
        z.object({
          targetId: z.string(),
          attempts: z.number(),
          message: z.string(),
        }),
      ),
    }),
  ),
});
export function ReconciliationStatus() {
  const q = useAdministration('/learning/reconciliation', schema),
    command = useCommand(),
    [job, setJob] = useState<{ kind: string; targetId: string } | null>(null);
  return (
    <QueryState
      pending={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
    >
      <p>
        Durable identity, college, course and batch changes are reconciled in
        bounded pages. Effective access always checks live eligibility. Failed
        work remains visible until repaired or explicitly retried.
      </p>
      {q.data?.queues.map((queue) => (
        <section className="student-card" key={queue.kind}>
          <h2>{queue.kind.toLowerCase()} changes</h2>
          <p>{queue.pending} pending reconciliation markers</p>
          {queue.failed.map((f) => (
            <article key={f.targetId}>
              <p>
                {f.message} · {f.attempts} attempts · {f.targetId}
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  setJob({ kind: queue.kind, targetId: f.targetId })
                }
              >
                Retry after review
              </Button>
            </article>
          ))}
        </section>
      ))}
      <Confirmation
        open={!!job}
        title="Retry failed reconciliation?"
        description="Check the underlying database or identity issue first. Retrying is audited and does not bypass current eligibility."
        busy={command.isPending}
        onClose={() => setJob(null)}
        onConfirm={() => {
          if (job)
            void command
              .mutateAsync({
                path: '/learning/reconciliation/retry',
                body: { ...job, confirmed: true },
              })
              .then(() => setJob(null))
              .catch(() => setJob(null));
        }}
      />
    </QueryState>
  );
}
