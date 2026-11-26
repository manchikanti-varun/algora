'use client';
import { useState } from 'react';
import { cx, DataTable, EmptyState, ErrorState, Pagination, ProgressBar, StatusBadge, TableSkeleton, timeAgo } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import type { Board, BoardRow } from './types';
const MEDAL: Record<number, string> = { 1: 'bg-gold text-gold-fg', 2: 'bg-silver text-silver-fg', 3: 'bg-bronze text-bronze-fg' };
const medal = (rank: number) => MEDAL[rank] ?? 'bg-subtle text-fg-muted';
/**
 * Shared leaderboard table: `path` is the management endpoint or /student/leaderboard (rows then carry isMe).
 * `showRoll` adds the roll number, `showSync` adds the last progress update (management only).
 */
export function LeaderboardTable({ path, query = {}, showRoll, showSync }: { path: string; query?: Record<string, string | undefined>; showRoll?: boolean; showSync?: boolean }) {
  const [page, setPage] = useState(1);
  const b = useApi<Board & { me?: BoardRow | null; top3?: BoardRow[] }>(`${path}${qs({ ...query, page, pageSize: 25 })}`);
  if (b.error) return <ErrorState message={b.error} retry={b.reload} />;
  if (!b.data) return <TableSkeleton rows={8} />;
  const d = b.data;
  const scope = d.scope.type === 'COURSE' ? `Compared on the ${d.scope.problems} problems visible in all ${d.scope.batches} batches`
    : d.scope.type === 'BATCH' ? `Compared on all ${d.scope.problems} visible problems across the courses of this batch, each counted once`
      : `Compared on the ${d.scope.problems} visible problems in this course`;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-fg-muted">{scope}. Only verified problems count.</p>
      {d.top3 && d.top3.length > 0 && page === 1 && (
        <ol className="grid gap-3 sm:grid-cols-3" aria-label="Top three">
          {d.top3.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={cx('flex items-center gap-3 rounded-lg border p-3', r.isMe ? 'border-accent-line bg-accent-soft' : 'border-line bg-surface')}>
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold', medal(r.rank))}><span className="sr-only">Rank </span>{r.rank}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{r.name}{r.isMe && ' (you)'}</p>
                <p className="text-[13px] tabular-nums text-fg-muted">{r.points} points · {r.solved} verified</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {d.me && <p className="rounded-lg bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent-fg">Your position: #{d.me.rank} · {d.me.points} points</p>}
      <div className="overflow-hidden rounded-lg border border-line">
        <DataTable rows={d.items} rowKey={(r) => `${r.rank}-${r.name}-${r.rollNumber ?? ''}`} rowClassName={(r) => (r.isMe ? 'bg-accent-soft font-medium' : undefined)}
          columnsKey={showRoll || showSync ? 'leaderboard-manage' : 'leaderboard-student'} caption="Leaderboard"
          empty={<EmptyState compact title="No ranked students yet" body={d.scope.problems ? 'Nobody has a verified problem in this scope yet.' : 'There are no problems to compare in this scope yet.'} />}
          columns={[
            { key: 'rank', header: 'Rank', cell: (r) => <span className={cx('inline-grid h-7 w-7 place-items-center rounded-full text-xs font-semibold tabular-nums', medal(r.rank))}>{r.rank}</span> },
            { key: 'name', header: 'Student', cell: (r) => <span>{r.name}{r.isMe && <span className="ml-1 text-accent-fg">(you)</span>}</span> },
            ...(showRoll ? [{ key: 'roll', header: 'Roll number', cell: (r: BoardRow) => <span className="text-[13px] tabular-nums text-fg-muted">{r.rollNumber}</span> }] : []),
            { key: 'solved', header: 'Verified', cell: (r) => <span className="tabular-nums">{r.solved}</span> },
            { key: 'e', header: 'Easy', optional: true, defaultHidden: true, cell: (r) => <span className="tabular-nums">{r.easy}</span> },
            { key: 'm', header: 'Medium', optional: true, defaultHidden: true, cell: (r) => <span className="tabular-nums">{r.medium}</span> },
            { key: 'h', header: 'Hard', optional: true, defaultHidden: true, cell: (r) => <span className="tabular-nums">{r.hard}</span> },
            { key: 'pts', header: 'Points', cell: (r) => <span className="font-semibold tabular-nums">{r.points}</span> },
            { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" label="Completion" /> },
            ...(showSync ? [{ key: 'sync', header: 'Last update', cell: (r: BoardRow) => <span className="inline-flex items-center gap-2"><StatusBadge status={r.syncStatus} /><span className="text-xs text-fg-subtle">{timeAgo(r.lastSyncAt)}</span></span> }] : []),
          ]} />
      </div>
      <Pagination page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} className="px-0" />
    </div>
  );
}
