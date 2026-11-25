'use client';
import { useState } from 'react';
import { cx, DataTable, EmptyState, ErrorState, Notice, Pagination, ProgressBar, StatusBadge, TableSkeleton, timeAgo } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import type { Board, BoardRow } from './types';

/** Shared leaderboard table for management (`path` = management endpoint) and students (rows carry isMe). */
export function LeaderboardTable({ path, query = {}, showRoll, showSync }: { path: string; query?: Record<string, string | undefined>; showRoll?: boolean; showSync?: boolean }) {
  const [page, setPage] = useState(1);
  const b = useApi<Board & { me?: BoardRow | null; top3?: BoardRow[]; note?: string }>(`${path}${qs({ ...query, page, pageSize: 25 })}`);
  if (b.error) return <ErrorState message={b.error} retry={b.reload} />;
  if (!b.data) return <TableSkeleton rows={8} />;
  const d = b.data;
  const medal = (r: number) => (r === 1 ? 'bg-amber-100 text-amber-800 ring-amber-300' : r === 2 ? 'bg-slate-100 text-slate-700 ring-slate-300' : r === 3 ? 'bg-orange-100 text-orange-800 ring-orange-300' : 'bg-white text-slate-600 ring-slate-200');
  return (
    <div className="space-y-4">
      <Notice tone="info">
        <strong>Scope:</strong> {d.scope.type === 'COURSE' ? `${d.scope.problems} problems unlocked in every one of ${d.scope.batches} batches.` : d.scope.type === 'BATCH' ? `all ${d.scope.problems} unlocked problems across this batch's courses, each counted once.` : `${d.scope.problems} unlocked problems in this batch-course.`}{' '}
        Ranks use verified accepted LeetCode submissions only; students whose account is not verified or not yet synced may rank lower than their real activity.
      </Notice>
      {d.top3 && d.top3.length > 0 && page === 1 && (
        <ol className="grid gap-3 sm:grid-cols-3" aria-label="Top three">
          {d.top3.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={cx('rounded-xl border p-4 shadow-sm', r.isMe ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white')}>
              <span className={cx('inline-grid h-8 w-8 place-items-center rounded-full text-sm font-bold ring-1', medal(r.rank))}>{r.rank}</span>
              <p className="mt-2 truncate font-semibold">{r.name}{r.isMe && ' (you)'}</p>
              <p className="text-sm text-slate-500">{r.points} pts · {r.solved} solved</p>
            </li>
          ))}
        </ol>
      )}
      {d.me && <p className="text-sm text-slate-600">Your position: <strong>#{d.me.rank}</strong> with {d.me.points} points.</p>}
      <DataTable rows={d.items} rowKey={(r) => `${r.rank}-${r.name}-${r.rollNumber ?? ''}`} rowClassName={(r) => (r.isMe ? 'bg-indigo-50/70 font-medium' : undefined)}
        empty={<EmptyState title="No ranked students" body={d.scope.problems ? 'Nobody has verified evidence in this scope yet.' : 'No problems are comparable in this scope yet.'} />}
        columns={[
          { key: 'rank', header: 'Rank', cell: (r) => <span className={cx('inline-grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ring-1', medal(r.rank))}>{r.rank}</span> },
          { key: 'name', header: 'Student', cell: (r) => <span>{r.name}{r.isMe && <span className="ml-1 text-indigo-600">(you)</span>}</span> },
          ...(showRoll ? [{ key: 'roll', header: 'Roll number', cell: (r: BoardRow) => <code className="text-xs">{r.rollNumber}</code> }] : []),
          { key: 'solved', header: 'Solved', cell: (r) => r.solved },
          { key: 'e', header: 'Easy', cell: (r) => r.easy }, { key: 'm', header: 'Medium', cell: (r) => r.medium }, { key: 'h', header: 'Hard', cell: (r) => r.hard },
          { key: 'pts', header: 'Points', cell: (r) => <strong>{r.points}</strong> },
          { key: 'pct', header: 'Completion', className: 'min-w-36', cell: (r) => <ProgressBar value={r.completionPct} size="sm" /> },
          ...(showSync ? [{ key: 'sync', header: 'Last sync', cell: (r: BoardRow) => <span className="inline-flex items-center gap-2"><StatusBadge status={r.syncStatus} /><span className="text-xs text-slate-500">{timeAgo(r.lastSyncAt)}</span></span> }] : []),
        ]} />
      <Pagination page={page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
    </div>
  );
}
