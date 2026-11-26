'use client';
import Link from 'next/link';
import { Clock, Info, Link2, RefreshCw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, ButtonLink, fmtTime, Notice, Popover, Spinner, timeAgo, useToast } from '@/components/ui';

/*
 * Student progress updates. The backend owns every rule (30-minute automatic updates, 10-minute manual cooldown, queue,
 * verification). This file only displays state and sends the one "request an update" call. Reloading or switching pages
 * never contacts LeetCode: polling reads Algora's own database through /leetcode/sync-status.
 */
export interface LinkView { state: 'LINKED' | 'UNLINKED'; username: string | null; current: { username: string; linkedAt: string | null } | null; countsEvidence: boolean; consentedAt?: string | null }
export interface JobInfo { id: string; status: 'QUEUED' | 'RUNNING'; trigger: string; attempts: number; enqueuedAt: string; runAfter: string; startedAt: string | null; delayed: boolean }
export interface SyncView {
  serverTime: string; syncEnabled: boolean; paused?: boolean; coverage?: 'FULL' | 'REDUCED' | null;
  status: string; statusDetail?: string | null;
  lastSuccessAt: string | null; lastAttemptAt: string | null; lastManualRequestAt: string | null;
  nextAutoSyncAt: string | null; autoIntervalMin: number; nextManualAt: string | null; cooldownRemainingSec: number; canRequest: boolean;
  job: JobInfo | null; lastJob: { status: string; trigger: string; finishedAt: string | null; newlyVerified: number; outcome: string | null } | null;
  possibleGap: boolean; hasUsername: boolean; link: LinkView;
}
interface Ctx {
  view: SyncView | null;
  /** Seconds until the next manual update, counted down to the server's timestamp (corrected for clock skew). */
  cooldown: number;
  busy: boolean; requesting: boolean; version: number;
  request: () => Promise<void>; refresh: () => Promise<void>;
}
const SyncCtx = createContext<Ctx | null>(null);
export const useSync = () => { const c = useContext(SyncCtx); if (!c) throw new Error('useSync outside SyncProvider'); return c; };

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 60_000;
export const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
const verifiedText = (n: number) => (n > 0 ? `${n} new ${n === 1 ? 'problem' : 'problems'} verified` : 'No new verified problems');

export function SyncProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SyncView | null>(null);
  const [skew, setSkew] = useState(0);
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
      const ok = v.lastJob?.status === 'SUCCEEDED';
      if (requestedByMe.current || (v.lastSuccessAt && v.lastSuccessAt !== before.success)) {
        if (ok) toast.success(`Progress updated. ${verifiedText(v.lastJob?.newlyVerified ?? 0)}.`);
        else if (requestedByMe.current) toast.error('Unable to update progress. Please try again later.');
      }
      requestedByMe.current = false;
      setVersion((n) => n + 1);
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
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void refresh(); };
    const t = setInterval(tick, busy ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); }; // a status read, not an update request
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
      if (r.accepted === false) { requestedByMe.current = false; toast.info('Progress updates are unavailable right now.'); }
      else toast.info(r.created === false ? 'An update is already queued.' : 'Update queued. Your progress will refresh when it finishes.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const d = e.details as { sync?: SyncView; retryAfterSec?: number } | undefined;
        if (d?.sync) apply(d.sync);
        toast.info(`Next update available in ${mmss(d?.retryAfterSec ?? 60)}.`);
      } else toast.error('Unable to update progress. Please try again later.');
    } finally { setRequesting(false); }
  }, [apply, requesting, toast]);

  return <SyncCtx.Provider value={{ view, cooldown, busy, requesting, version, request, refresh }}>{children}</SyncCtx.Provider>;
}

/** What the single Update progress control shows. */
function controlState(view: SyncView, cooldown: number, requesting: boolean) {
  if (requesting) return { label: 'Requesting…', short: 'Requesting…', disabled: true, spin: true };
  if (view.job?.status === 'RUNNING') return { label: 'Updating progress…', short: 'Updating…', disabled: true, spin: true };
  if (view.job) return { label: view.job.delayed ? 'Update delayed' : 'Update queued', short: view.job.delayed ? 'Delayed' : 'Queued', disabled: true, spin: false };
  if (cooldown > 0) return { label: `Next update in ${mmss(cooldown)}`, short: mmss(cooldown), disabled: true, spin: false, clock: true };
  return { label: 'Update progress', short: 'Update', disabled: false, spin: false };
}

/**
 * The one Update progress control (in the student header on every page). Next to it, an info button shows the details:
 * connected account, last update, next automatic update. Unavailable states are shown as plain text, not as errors.
 */
export function UpdateProgress() {
  const { view, cooldown, requesting, request } = useSync();
  if (!view) return null;
  if (!view.syncEnabled) return <span className="hidden text-xs text-fg-subtle sm:inline">Progress updates unavailable</span>;
  if (view.link.state !== 'LINKED') return <ButtonLink href="/student/profile#connected-accounts" variant="secondary" size="sm" icon={<Link2 size={14} aria-hidden />}>Connect LeetCode</ButtonLink>;
  if (view.paused) return <span className="text-xs text-fg-subtle">Updates paused</span>;
  const s = controlState(view, cooldown, requesting);
  return (
    <div className="flex items-center">
      <Button variant="secondary" size="sm" disabled={s.disabled} onClick={() => void request()} aria-live="polite"
        icon={s.spin ? <Spinner /> : s.clock ? <Clock size={14} aria-hidden /> : <RefreshCw size={14} aria-hidden />}
        className="rounded-r-none" title={s.label}>
        <span className="hidden sm:inline">{s.label}</span><span className="sm:hidden">{s.short}</span>
      </Button>
      <Popover label="Progress update details" button={<Info size={15} aria-hidden />} variant="secondary" size="sm" className="-ml-px w-8 rounded-l-none px-0">
        <ProgressDetails view={view} cooldown={cooldown} />
      </Popover>
    </div>
  );
}

function ProgressDetails({ view, cooldown }: { view: SyncView; cooldown: number }) {
  return (
    <div className="space-y-3">
      <p className="font-medium text-fg">Progress updates</p>
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3"><dt className="text-fg-muted">LeetCode account</dt><dd className="truncate font-medium text-fg">{view.link.username}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-muted">Last updated</dt><dd className="text-fg">{timeAgo(view.lastSuccessAt)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-muted">Next automatic update</dt><dd className="text-fg">{view.job ? 'In progress' : view.nextAutoSyncAt ? fmtTime(view.nextAutoSyncAt) : 'Not scheduled'}</dd></div>
        {cooldown > 0 && <div className="flex justify-between gap-3"><dt className="text-fg-muted">Next update available in</dt><dd className="tabular-nums text-fg">{mmss(cooldown)}</dd></div>}
      </dl>
      <p className="text-xs text-fg-subtle">Your progress updates automatically about every {view.autoIntervalMin} minutes. You can also request an update every 10 minutes.</p>
      <Link href="/student/profile#connected-accounts" className="text-xs font-medium text-accent-fg hover:underline">Manage connected account</Link>
    </div>
  );
}

/** One quiet line for the home page. Not a second control: it only describes the current state. */
export function ProgressStatusLine() {
  const { view } = useSync();
  if (!view || !view.syncEnabled || view.paused || view.link.state !== 'LINKED') return null;
  const parts = [
    view.job ? (view.job.status === 'RUNNING' ? 'Updating your progress…' : 'Update queued') : `Progress last updated ${timeAgo(view.lastSuccessAt)}`,
    !view.job && view.nextAutoSyncAt ? `next automatic update at ${fmtTime(view.nextAutoSyncAt)}` : null,
  ].filter(Boolean);
  return <p className="text-[13px] text-fg-subtle" aria-live="polite">{parts.join(' · ')}</p>;
}

/**
 * Situations the student must know about. Warnings are never hidden: account not found, incomplete history, limited
 * visibility, updates unavailable or paused, or no connected account.
 */
export function ProgressNotices() {
  const { view } = useSync();
  if (!view) return null;
  const out: ReactNode[] = [];
  if (!view.syncEnabled) out.push(<Notice key="off" tone="info" title="Progress updates are not available yet">Keep solving your assigned problems on LeetCode. They will be verified once updates are turned on. Problems that are not verified yet are not marked as unsolved.</Notice>);
  else if (view.link.state !== 'LINKED') out.push(<Notice key="link" tone="warn" title="Connect your LeetCode account" action={<ButtonLink href="/student/profile#connected-accounts" size="sm">Connect</ButtonLink>}>Algora verifies problems from the accepted submissions on your LeetCode account.</Notice>);
  else if (view.paused) out.push(<Notice key="paused" tone="info" title="Progress updates are paused">Your verified progress is unchanged. New solves will be checked when updates resume.</Notice>);
  else {
    if (view.status === 'ACCOUNT_NOT_FOUND') out.push(<Notice key="nf" tone="error" title={`LeetCode could not find “${view.link.username}”`} action={<ButtonLink href="/student/profile#connected-accounts" size="sm" variant="secondary">Fix username</ButtonLink>}>Check the spelling of your LeetCode username.</Notice>);
    if (view.status === 'SUBMISSIONS_UNAVAILABLE') out.push(<Notice key="sv" tone="warn" title="Your submissions are not visible">LeetCode shows activity on this account, but the latest check returned no accepted submissions. Your verified progress is unchanged.</Notice>);
    if (view.status === 'PROVIDER_UNAVAILABLE' || view.status === 'RATE_LIMITED' || view.status === 'SYNC_FAILED') out.push(<Notice key="pu" tone="warn" title="Unable to update progress right now">Algora will try again automatically. Your verified progress is unchanged.</Notice>);
    if (view.possibleGap) out.push(<Notice key="gap" tone="warn" title="Some submissions may not have been seen">LeetCode only shares your most recent accepted submissions, and the latest check did not overlap with earlier ones. Previously verified problems still count. Ask your trainer if a problem you solved is missing.</Notice>);
    if (view.coverage === 'REDUCED') out.push(<Notice key="cov" tone="info" title="Limited view of your submissions">The last check could only see your most recent submissions of every kind, so a few accepted solves may appear later.</Notice>);
  }
  return out.length ? <div className="space-y-3">{out}</div> : null;
}
