'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, cx, timeAgo, useToast } from '@/components/ui';

export interface LinkView { state: 'LINKED' | 'UNLINKED'; username: string | null; current: { username: string; linkedAt: string | null } | null; countsEvidence: boolean; consentedAt?: string | null }
export interface JobInfo { id: string; status: 'QUEUED' | 'RUNNING'; trigger: string; attempts: number; enqueuedAt: string; runAfter: string; startedAt: string | null; delayed: boolean }
export interface SyncView {
  serverTime: string; syncEnabled: boolean; paused?: boolean; coverage?: 'FULL' | 'REDUCED' | null;
  /** Display status computed by the server: QUEUED, DELAYED and UPDATING come from the job queue, the rest from the last result. */
  status: string; statusDetail?: string | null;
  lastSuccessAt: string | null; lastAttemptAt: string | null; lastManualRequestAt: string | null;
  nextAutoSyncAt: string | null; autoIntervalMin: number; nextManualAt: string | null; cooldownRemainingSec: number; canRequest: boolean;
  job: JobInfo | null; lastJob: { status: string; trigger: string; finishedAt: string | null; newlyVerified: number; outcome: string | null } | null;
  possibleGap: boolean; hasUsername: boolean; link: LinkView;
}
interface Ctx {
  view: SyncView | null;
  /** Seconds until the next manual update, counted down to the SERVER's timestamp (corrected for clock skew). */
  cooldown: number;
  /** True while a job is queued or running (database state, not a local flag). */
  busy: boolean; requesting: boolean;
  version: number;
  request: () => Promise<void>; refresh: () => Promise<void>;
}
const SyncCtx = createContext<Ctx | null>(null);
export const useSync = () => { const c = useContext(SyncCtx); if (!c) throw new Error('useSync outside SyncProvider'); return c; };

const POLL_ACTIVE_MS = 4_000;   // while a job is queued or running (reads MongoDB through our API only)
const POLL_IDLE_MS = 60_000;    // keeps "next automatic update" and results fresh
export const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SyncView | null>(null);
  const [skew, setSkew] = useState(0);            // serverTime - browser time at the last response
  const [now, setNow] = useState(() => Date.now());
  const [requesting, setRequesting] = useState(false);
  const [version, setVersion] = useState(0);
  const toast = useToast();
  const prev = useRef<{ active: boolean; success: string | null } | null>(null);
  const requestedByMe = useRef(false);

  const apply = useCallback((v: SyncView) => {
    setView(v); setSkew(new Date(v.serverTime).getTime() - Date.now());
    const before = prev.current;
    if (before?.active && !v.job) {
      // The job finished since the last poll: report what really happened, from the database.
      const ok = v.lastJob?.status === 'SUCCEEDED';
      if (requestedByMe.current || (v.lastSuccessAt && v.lastSuccessAt !== before.success)) {
        if (ok && (v.lastJob?.newlyVerified ?? 0) > 0) toast.success(`Progress updated successfully. ${v.lastJob!.newlyVerified} new problem${v.lastJob!.newlyVerified === 1 ? '' : 's'} verified.`);
        else if (ok) toast.info('Progress updated. No new accepted submissions observed.');
        else if (requestedByMe.current) toast.error('Update could not be completed. It will be retried automatically.');
      }
      requestedByMe.current = false;
      setVersion((n) => n + 1); // refetch progress and leaderboards from the backend
    }
    prev.current = { active: !!v.job, success: v.lastSuccessAt };
  }, [toast]);

  const refresh = useCallback(async () => {
    try { apply(await api<SyncView>('/leetcode/sync-status')); } catch { /* pages show their own errors */ }
  }, [apply]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const busy = !!view?.job;
  // Read-only status polling. It never asks the backend to contact LeetCode.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const t = setInterval(tick, busy ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); }; // a status read, not a sync
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [busy, refresh]);

  const cooldown = view?.nextManualAt ? Math.max(0, Math.ceil((new Date(view.nextManualAt).getTime() - (now + skew)) / 1000)) : 0;

  const request = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const r = await api<{ accepted: boolean; created?: boolean; sync: SyncView; outcome?: { message?: string } }>('/leetcode/request-sync', { method: 'POST', body: {} });
      requestedByMe.current = true;
      apply(r.sync);
      if (r.accepted === false) { requestedByMe.current = false; toast.info(r.outcome?.message ?? 'Updates are not available right now'); }
      else toast.info(r.created === false ? 'An update is already queued for you.' : 'Update queued. Your progress will refresh when it completes.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const d = e.details as { sync?: SyncView; retryAfterSec?: number } | undefined;
        if (d?.sync) apply(d.sync);
        toast.info(`You can request another update in ${mmss(d?.retryAfterSec ?? 60)}.`);
      } else toast.error('Could not queue the update. Try again later.');
    } finally { setRequesting(false); }
  }, [apply, requesting, toast]);

  return <SyncCtx.Provider value={{ view, cooldown, busy, requesting, version, request, refresh }}>{children}</SyncCtx.Provider>;
}

function buttonState(view: SyncView, cooldown: number, busy: boolean, requesting: boolean) {
  if (requesting) return { label: 'Queuing…', disabled: true };
  if (view.job?.status === 'RUNNING') return { label: 'Updating progress…', disabled: true };
  if (view.job) return { label: view.job.delayed ? 'Update delayed' : 'Update queued', disabled: true };
  if (cooldown > 0) return { label: `Update available in ${mmss(cooldown)}`, disabled: true };
  return { label: 'Update Progress', disabled: busy };
}

/** Compact header control, shown on every student page. */
export function SyncButton() {
  const { view, cooldown, busy, requesting, request } = useSync();
  if (!view) return null;
  if (!view.syncEnabled) return <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-amber-200 sm:inline" title="Automatic LeetCode verification is not available yet">Verification unavailable</span>;
  if (view.link.state !== 'LINKED') return null;
  if (view.paused) return <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-amber-200 sm:inline">Updates paused</span>;
  const b = buttonState(view, cooldown, busy, requesting);
  return (
    <Button size="sm" variant="secondary" loading={requesting || view.job?.status === 'RUNNING'} disabled={b.disabled} onClick={() => void request()} title={`Last successful update ${timeAgo(view.lastSuccessAt)}`}>
      {b.label}
    </Button>
  );
}

const STATE_COPY: Record<string, { tone: string; text: string }> = {
  IDLE: { tone: 'gray', text: 'Not updated yet' }, QUEUED: { tone: 'blue', text: 'Update queued' }, UPDATING: { tone: 'blue', text: 'Updating progress' },
  DELAYED: { tone: 'amber', text: 'Synchronization delayed' }, SYNC_PENDING: { tone: 'blue', text: 'Update queued' }, SYNCING: { tone: 'blue', text: 'Updating progress' },
  SYNC_SUCCESS: { tone: 'green', text: 'Progress up to date' }, POSSIBLE_EVIDENCE_GAP: { tone: 'amber', text: 'Updated · possible gap' },
  NO_SUBMISSIONS_OBSERVED: { tone: 'gray', text: 'No accepted submissions observed yet' }, SUBMISSIONS_UNAVAILABLE: { tone: 'amber', text: 'Submissions not visible' },
  ACCOUNT_NOT_FOUND: { tone: 'red', text: 'Username not found' }, SYNC_FAILED: { tone: 'red', text: 'Last update failed' },
  SYNC_PAUSED: { tone: 'amber', text: 'Paused by administrator' }, RATE_LIMITED: { tone: 'amber', text: 'Synchronization delayed' },
  PROVIDER_UNAVAILABLE: { tone: 'amber', text: 'Provider temporarily unavailable' }, VERIFICATION_UNAVAILABLE: { tone: 'amber', text: 'Verification unavailable' },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

/** Full status panel for the dashboard, progress page and profile. */
export function SyncPanel({ verified }: { verified?: { solved: number; total: number } | null }) {
  const { view, cooldown, busy, requesting, request } = useSync();
  if (!view) return null;
  const s = STATE_COPY[view.status] ?? STATE_COPY.IDLE;
  let body: ReactNode;
  if (!view.syncEnabled) body = <p>Automatic LeetCode verification is not available yet. Keep solving your assigned problems on LeetCode; once verification is enabled, accepted submissions Algora can see will be verified. Nothing is marked unsolved in the meantime, it is simply not verified.</p>;
  else if (view.paused) body = <p>Synchronization is paused by the administrator. Your verified progress is unchanged and new solves will be checked when it resumes.</p>;
  else if (view.link.state !== 'LINKED') body = <p>Link your LeetCode username on your <a className="font-medium underline" href="/student/profile">profile</a> to start counting progress.</p>;
  else if (view.status === 'ACCOUNT_NOT_FOUND') body = <p>LeetCode could not find <strong>{view.link.username}</strong>. Check the spelling on your <a className="font-medium underline" href="/student/profile">profile</a> and update it.</p>;
  else if (view.job?.status === 'RUNNING') body = <p>Checking <strong>{view.link.username}</strong> for new accepted submissions…</p>;
  else if (view.job) body = <p>{view.job.delayed ? 'Updates are taking longer than usual because many students are waiting. ' : ''}Your update is queued and will run when the shared request budget allows. This page refreshes by itself.</p>;
  else if (view.status === 'PROVIDER_UNAVAILABLE' || view.status === 'RATE_LIMITED') body = <p>Synchronization is temporarily unavailable. Your verified progress is unchanged and Algora will retry automatically.</p>;
  else if (view.status === 'SUBMISSIONS_UNAVAILABLE') body = <p>LeetCode reports activity on <strong>{view.link.username}</strong>, but the latest check returned no accepted submissions. Previously verified progress is still available.</p>;
  else if (view.status === 'NO_SUBMISSIONS_OBSERVED') body = <p>No accepted submissions are visible on <strong>{view.link.username}</strong> yet. Solve an assigned problem on LeetCode and Algora will pick it up.</p>;
  else body = <p>{view.lastJob?.status === 'SUCCEEDED' && view.lastJob.newlyVerified === 0 && view.lastJob.trigger === 'MANUAL' ? 'No new accepted submissions observed in the latest check. ' : ''}Tracking <strong>{view.link.username}</strong>.</p>;
  const b = buttonState(view, cooldown, busy, requesting);
  const canShow = view.syncEnabled && !view.paused && view.link.state === 'LINKED';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="sync-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">LeetCode progress
          <span data-testid="sync-status" className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1', { gray: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200' }[s.tone])}>{view.syncEnabled ? s.text : 'Unavailable'}</span></p>
        {canShow && <Button size="sm" loading={requesting || view.job?.status === 'RUNNING'} disabled={b.disabled} onClick={() => void request()}>{b.label}</Button>}
      </div>
      <div className="mt-2 text-sm text-slate-600">{body}</div>
      {canShow && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
          <div><dt className="inline">Account: </dt><dd className="inline font-medium text-slate-700">{view.link.username}</dd></div>
          <div><dt className="inline">Last successful update: </dt><dd className="inline font-medium text-slate-700">{view.lastSuccessAt ? timeAgo(view.lastSuccessAt) : 'never'}</dd></div>
          <div><dt className="inline">Next automatic update: </dt><dd className="inline font-medium text-slate-700">{view.job ? 'queued now' : when(view.nextAutoSyncAt)}</dd></div>
          {verified && <div><dt className="inline">Verified problems: </dt><dd className="inline font-medium text-slate-700">{verified.solved} of {verified.total}</dd></div>}
          {verified && verified.total > verified.solved && <div className="sm:col-span-2"><dt className="inline">Pending verification: </dt><dd className="inline font-medium text-slate-700">{verified.total - verified.solved} not yet verified. A problem you solved on LeetCode appears here after the next successful update.</dd></div>}
        </dl>
      )}
      {canShow && <p className="mt-2 text-xs text-slate-500">Progress updates automatically about every {view.autoIntervalMin} minutes, subject to queue delays and LeetCode availability. You can request an extra update once every 10 minutes. Reloading this page never contacts LeetCode.</p>}
      {view.coverage === 'REDUCED' && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">The last check could only see your most recent submissions of every kind, not just accepted ones, so failed attempts may have hidden a few accepted solves. Older accepted submissions may fall outside the next available window.</p>}
      {view.possibleGap && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">LeetCode only shows your most recent accepted submissions, and the latest check did not overlap with earlier ones. Some accepted submissions may not have been observed. Previously verified progress is unchanged. Ask your trainer if a problem you solved is missing.</p>}
    </div>
  );
}
