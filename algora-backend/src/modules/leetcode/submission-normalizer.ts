import { z } from 'zod';
import type { AcceptedSubmission } from './leetcode.types';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const row = z.object({
  id: z.union([z.string(), z.number()]).optional().nullable(),
  title: z.string().max(300).optional().nullable(),
  titleSlug: z.string().max(120),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  statusDisplay: z.string().optional().nullable(),
});

export interface NormalizeStats { raw: number; accepted: number; dropped: number; futureTimestamps: number; duplicates: number; oldestRawAt: Date | null }

/** Seconds since epoch (string or number). Values that look like milliseconds are converted. Invalid -> null. */
export function parseTimestamp(v: unknown): Date | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Turn provider rows into AcceptedSubmission[].
 * - Only rows that are accepted: `assumeAccepted` for accepted-only endpoints, otherwise statusDisplay must be "Accepted".
 * - Invalid slugs are dropped, never guessed. Timestamps in the future (beyond 5 min skew) are dropped to null and counted.
 * - Exact duplicates (same id, or same slug+timestamp when there is no id) are collapsed.
 */
export function normalizeRows(rows: unknown[], ctx: { username: string; provider: string; assumeAccepted: boolean; now?: Date }): { submissions: AcceptedSubmission[]; stats: NormalizeStats } {
  const now = (ctx.now ?? new Date()).getTime();
  const stats: NormalizeStats = { raw: Array.isArray(rows) ? rows.length : 0, accepted: 0, dropped: 0, futureTimestamps: 0, duplicates: 0, oldestRawAt: null };
  const out: AcceptedSubmission[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = row.safeParse(r);
    if (!p.success) { stats.dropped++; continue; }
    let at = parseTimestamp(p.data.timestamp);
    if (at && (!stats.oldestRawAt || at < stats.oldestRawAt)) stats.oldestRawAt = at;
    const accepted = ctx.assumeAccepted ? (p.data.statusDisplay == null || p.data.statusDisplay === 'Accepted') : p.data.statusDisplay === 'Accepted';
    if (!accepted) continue;
    const slug = p.data.titleSlug.trim().toLowerCase();
    if (!SLUG.test(slug)) { stats.dropped++; continue; }
    if (at && at.getTime() > now + FUTURE_TOLERANCE_MS) { stats.futureTimestamps++; at = null; }
    const id = p.data.id != null && String(p.data.id).trim() !== '' ? String(p.data.id) : null;
    const key = id ? `id:${id}` : `s:${slug}|${at?.getTime() ?? 'na'}`;
    if (seen.has(key)) { stats.duplicates++; continue; }
    seen.add(key);
    stats.accepted++;
    out.push({ submissionId: id, username: ctx.username, problemTitle: (p.data.title ?? slug).trim() || slug, problemSlug: slug, status: 'ACCEPTED', submittedAt: at, provider: ctx.provider });
  }
  return { submissions: out, stats };
}
