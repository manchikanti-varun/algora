import { env } from '../../config/env';
import { LeetcodeRequestStat } from '../../models';
import { log } from '../../lib/logger';
export type RequestOutcome = 'ok' | 'rateLimited' | 'accessDenied' | 'failed';
const minuteKey = (d: Date) => d.toISOString().slice(0, 16).replace(/[-T:]/g, '');
/**
 * Count one request that actually left this server (any provider: they share one upstream). One upserted counter document per
 * UTC minute keeps write volume at one small update per request. Never throws: metrics must not break synchronization.
 */
export async function recordUpstreamRequest(outcome: RequestOutcome, latencyMs: number, at = new Date()): Promise<void> {
  const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  const inc: Record<string, number> = { requests: 1, latencyMs: Math.max(0, Math.round(latencyMs)) };
  inc[outcome === 'ok' ? 'ok' : outcome === 'failed' ? 'failed' : outcome] = 1;
  try { await LeetcodeRequestStat.updateOne({ _id: minuteKey(at) }, { $setOnInsert: { at: minute }, $inc: inc }, { upsert: true }); }
  catch (e) { log.warn('request stat write failed', { error: e }); }
}
export interface RequestStatsSummary { lastMinute: number; lastHour: number; today: number; ok: number; rateLimited: number; accessDenied: number; failed: number; avgLatencyMs: number | null }
/** Totals for the dashboard. "Today" is the current day in the bootcamp timezone. */
export async function requestStats(now = new Date()): Promise<RequestStatsSummary> {
  const tz = env.LEETCODE_TZ_OFFSET_MIN * 60_000;
  const dayStart = new Date(Math.floor((now.getTime() + tz) / 86_400_000) * 86_400_000 - tz);
  const rows = await LeetcodeRequestStat.find({ at: { $gte: dayStart } }).lean();
  const sum = (from: Date) => rows.filter((r) => r.at >= from).reduce((a, r) => a + (r.requests ?? 0), 0);
  const total = rows.reduce((a, r) => ({ ok: a.ok + (r.ok ?? 0), rl: a.rl + (r.rateLimited ?? 0), ad: a.ad + (r.accessDenied ?? 0), f: a.f + (r.failed ?? 0), lat: a.lat + (r.latencyMs ?? 0), n: a.n + (r.requests ?? 0) }), { ok: 0, rl: 0, ad: 0, f: 0, lat: 0, n: 0 });
  // Counters are per whole UTC minute: "last minute" sums buckets that started within the last 60 s (current partial minute included).
  return {
    lastMinute: sum(new Date(now.getTime() - 60_000)), lastHour: sum(new Date(now.getTime() - 3_600_000)), today: total.n,
    ok: total.ok, rateLimited: total.rl, accessDenied: total.ad, failed: total.f, avgLatencyMs: total.n ? Math.round(total.lat / total.n) : null,
  };
}
