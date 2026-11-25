'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, cx, timeAgo, useToast } from '@/components/ui';

export interface LinkView { state: 'LINKED' | 'UNLINKED'; username: string | null; current: { username: string; linkedAt: string | null } | null; countsEvidence: boolean; consentedAt?: string | null }
export interface SyncView { syncEnabled: boolean; paused?: boolean; coverage?: 'FULL' | 'REDUCED' | null; status: string; statusDetail?: string | null; lastSuccessAt: string | null; lastAttemptAt: string | null; possibleGap: boolean; cooldownRemainingSec: number; hasUsername: boolean; link: LinkView }
interface Outcome { status: string; message?: string; newlyVerified: number; possibleGap: boolean; retryAfterSec?: number }
interface Ctx { view: SyncView | null; syncing: boolean; cooldown: number; version: number; request: (reason: 'MANUAL' | 'TAB_RETURN') => Promise<void>; refresh: () => Promise<void> }
const SyncCtx = createContext<Ctx | null>(null);
export const useSync = () => { const c = useContext(SyncCtx); if (!c) throw new Error('useSync outside SyncProvider'); return c; };

const TAB_RETURN_MIN_AWAY_MS = 15_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SyncView | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [version, setVersion] = useState(0);
  const toast = useToast();
  const inFlight = useRef(false);
  const providerDownUntil = useRef(0);

  const refresh = useCallback(async () => {
    try { const v = await api<SyncView>('/leetcode/sync-status'); setView(v); setCooldown(v.cooldownRemainingSec); } catch { /* the page shows its own errors */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (cooldown <= 0) return; const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000); return () => clearInterval(t); }, [cooldown]);

  const canSync = !!view?.syncEnabled && !view.paused && view.link.state === 'LINKED';
  const request = useCallback(async (reason: 'MANUAL' | 'TAB_RETURN') => {
    if (inFlight.current) return;
    if (reason === 'TAB_RETURN' && (!canSync || cooldown > 0 || Date.now() < providerDownUntil.current)) return; // never nag an unavailable provider
    inFlight.current = true; setSyncing(true);
    try {
      const r = await api<{ outcome: Outcome; sync: SyncView }>('/leetcode/request-sync', { method: 'POST', body: { reason } });
      setView(r.sync); setCooldown(r.sync.cooldownRemainingSec);
      const o = r.outcome;
      if (o.status === 'SYNC_SUCCESS') {
        if (o.newlyVerified > 0) { toast.success(`${o.newlyVerified} new accepted problem${o.newlyVerified === 1 ? '' : 's'} verified`); setVersion((v) => v + 1); }
        else if (reason === 'MANUAL') toast.info('Up to date. No new accepted submissions found.');
      } else if (o.status === 'PROVIDER_UNAVAILABLE' || o.status === 'RATE_LIMITED') {
        providerDownUntil.current = Date.now() + (o.retryAfterSec ?? 120) * 1000;
        if (reason === 'MANUAL') toast.error(o.message ?? 'Verification is temporarily unavailable');
      } else if (reason === 'MANUAL' && o.message) toast.info(o.message);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const d = e.details as { retryAfterSec?: number; sync?: SyncView } | undefined;
        if (d?.sync) setView(d.sync);
        setCooldown(d?.retryAfterSec ?? 60);
        if (reason === 'MANUAL') toast.info(`You can sync again in ${d?.retryAfterSec ?? 60} s`);
      } else if (reason === 'MANUAL') toast.error('Sync failed. Try again later.');
    } finally { inFlight.current = false; setSyncing(false); }
  }, [canSync, cooldown, toast]);

  // Return from LeetCode: re-check when the tab becomes visible again after being away. This is NOT evidence of a solve.
  useEffect(() => {
    let hiddenAt = 0;
    const on = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= TAB_RETURN_MIN_AWAY_MS) void request('TAB_RETURN');
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [request]);

  return <SyncCtx.Provider value={{ view, syncing, cooldown, version, request, refresh }}>{children}</SyncCtx.Provider>;
}

/** Compact header control. */
export function SyncButton() {
  const { view, syncing, cooldown, request } = useSync();
  if (!view) return null;
  if (!view.syncEnabled) return <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-amber-200 sm:inline" title="Automatic LeetCode verification is not available yet">Verification unavailable</span>;
  if (view.link.state !== 'LINKED') return null;
  if (view.paused) return <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-amber-200 sm:inline">Sync paused</span>;
  return (
    <Button size="sm" variant="secondary" loading={syncing} disabled={cooldown > 0} onClick={() => request('MANUAL')} title={`Last synced ${timeAgo(view.lastSuccessAt)}`}>
      {syncing ? 'Syncing…' : cooldown > 0 ? `Sync in ${cooldown}s` : 'Sync progress'}
    </Button>
  );
}

const STATE_COPY: Record<string, { tone: string; text: string }> = {
  IDLE: { tone: 'gray', text: 'Not synced yet' }, SYNCING: { tone: 'blue', text: 'Syncing…' }, SYNC_PENDING: { tone: 'blue', text: 'Waiting for a running check' }, SYNC_SUCCESS: { tone: 'green', text: 'Synced' },
  POSSIBLE_EVIDENCE_GAP: { tone: 'amber', text: 'Synced · possible gap' }, NO_SUBMISSIONS_OBSERVED: { tone: 'gray', text: 'No accepted submissions seen yet' },
  SUBMISSIONS_UNAVAILABLE: { tone: 'amber', text: 'Submissions not visible' }, ACCOUNT_NOT_FOUND: { tone: 'red', text: 'Username not found' },
  SYNC_FAILED: { tone: 'red', text: 'Last sync failed' }, SYNC_PAUSED: { tone: 'amber', text: 'Paused by administrator' }, RATE_LIMITED: { tone: 'amber', text: 'Rate limited, retrying later' },
  PROVIDER_UNAVAILABLE: { tone: 'red', text: 'Temporarily unavailable' }, VERIFICATION_UNAVAILABLE: { tone: 'amber', text: 'Verification unavailable' },
};
/** Full status panel for the dashboard and profile. */
export function SyncPanel() {
  const { view, syncing, cooldown, request } = useSync();
  if (!view) return null;
  const s = STATE_COPY[syncing ? 'SYNCING' : view.status] ?? STATE_COPY.IDLE;
  let body: ReactNode;
  if (!view.syncEnabled) body = <p>Automatic LeetCode verification is not available yet. Keep solving your assigned problems on LeetCode; once verification is enabled, accepted submissions Algora can see will be verified. Nothing is marked unsolved in the meantime, it is simply not verified.</p>;
  else if (view.paused) body = <p>Synchronization is paused by the administrator. Your verified progress is unchanged and new solves will be checked when it resumes.</p>;
  else if (view.status === 'PROVIDER_UNAVAILABLE' || view.status === 'RATE_LIMITED') body = <p>Synchronization is temporarily unavailable. Your verified progress below is unchanged; Algora will retry automatically. Last successful sync: <strong>{timeAgo(view.lastSuccessAt)}</strong>.</p>;
  else if (view.link.state !== 'LINKED') body = <p>Link your LeetCode username on your <a className="font-medium underline" href="/student/profile">profile</a> to start counting progress.</p>;
  else if (view.status === 'ACCOUNT_NOT_FOUND') body = <p>LeetCode could not find <strong>{view.link.username}</strong>. Check the spelling on your <a className="font-medium underline" href="/student/profile">profile</a> and update it.</p>;
  else if (view.status === 'SUBMISSIONS_UNAVAILABLE') body = <p>LeetCode reports activity on <strong>{view.link.username}</strong>. The latest check returned no accepted submissions. Previously verified progress is still available.</p>;
  else if (view.status === 'NO_SUBMISSIONS_OBSERVED') body = <p>No accepted submissions are visible on <strong>{view.link.username}</strong> yet. Solve an assigned problem on LeetCode and Algora will pick it up automatically.</p>;
  else body = <p>Last successful sync: <strong>{timeAgo(view.lastSuccessAt)}</strong>. Algora also re-checks when you come back from LeetCode.</p>;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">LeetCode verification
          <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1', { gray: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200' }[s.tone])}>{view.syncEnabled ? s.text : 'Unavailable'}</span></p>
        {view.syncEnabled && !view.paused && view.link.state === 'LINKED' && <Button size="sm" loading={syncing} disabled={cooldown > 0} onClick={() => request('MANUAL')}>{cooldown > 0 ? `Sync again in ${cooldown}s` : 'Sync now'}</Button>}
      </div>
      <div className="mt-2 text-sm text-slate-600">{body}</div>
      {view.coverage === 'REDUCED' && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">The last check could only see your most recent submissions of every kind, not just accepted ones, so failed attempts may have hidden a few accepted solves. Older accepted submissions may fall outside the next available window.</p>}
      {view.possibleGap && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">LeetCode only shows your most recent accepted submissions. The latest window may omit earlier accepted submissions. Previously verified progress is still available.</p>}
    </div>
  );
}
