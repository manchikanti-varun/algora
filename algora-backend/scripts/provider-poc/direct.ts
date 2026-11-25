/**
 * Measurement client for the live PoC ONLY. It issues the two candidate queries so we can compare them on real data:
 *   recentAcSubmissionList  -> accepted only (what Alfa's /acSubmission uses)
 *   recentSubmissionList    -> all statuses  (what leetcode-query's recent_submissions uses)
 * It identifies itself honestly and is never imported by src/.
 */
import { z } from 'zod';

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

const AC = `query($u:String!,$l:Int){recentAcSubmissionList(username:$u,limit:$l){id title titleSlug timestamp}}`;
const ALL = `query($u:String!,$l:Int){recentSubmissionList(username:$u,limit:$l){title titleSlug timestamp statusDisplay lang}}`;
const PROFILE = `query($u:String!){matchedUser(username:$u){username submitStats:submitStatsGlobal{acSubmissionNum{difficulty count}}}}`;

export class PocError extends Error { constructor(public kind: 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'BAD_RESPONSE', msg: string, public retryAfter?: number) { super(msg); } }

const row = z.object({ title: z.string().optional(), titleSlug: z.string().regex(/^[a-z0-9-]+$/i), timestamp: z.union([z.string(), z.number()]), statusDisplay: z.string().optional(), id: z.union([z.string(), z.number()]).optional() });
export interface Row { slug: string; title?: string; at: Date | null; status?: string; id: string | null }

export class DirectClient {
  constructor(private doFetch: Fetch, private ua: string, private timeoutMs = 15_000) {}
  private async gql(query: string, variables: object): Promise<any> {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res;
    try { res = await this.doFetch('https://leetcode.com/graphql', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': this.ua }, body: JSON.stringify({ query, variables }), signal: ctl.signal }); }
    catch (e: any) { throw new PocError(e?.name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE', String(e?.message ?? e)); }
    finally { clearTimeout(t); }
    if (res.status === 429) throw new PocError('RATE_LIMITED', '429', Number(res.headers.get('retry-after')) || undefined);
    if (res.status >= 500) throw new PocError('UNAVAILABLE', `HTTP ${res.status}`);
    let j: any; try { j = JSON.parse(await res.text()); } catch { throw new PocError('BAD_RESPONSE', `non-JSON (HTTP ${res.status})`); }
    if (res.status === 403) throw new PocError('RATE_LIMITED', 'HTTP 403 (blocked)');
    if (j?.errors) throw new PocError(/not exist|not found/i.test(JSON.stringify(j.errors)) ? 'NOT_FOUND' : 'BAD_RESPONSE', JSON.stringify(j.errors).slice(0, 200));
    return j.data;
  }
  private norm(list: unknown[]): Row[] {
    const out: Row[] = [];
    for (const r of list ?? []) { const p = row.safeParse(r); if (!p.success) continue; const s = Number(p.data.timestamp); out.push({ slug: p.data.titleSlug.toLowerCase(), title: p.data.title, at: Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null, status: p.data.statusDisplay, id: p.data.id != null ? String(p.data.id) : null }); }
    return out;
  }
  async acceptedOnly(u: string, limit: number) { return this.norm((await this.gql(AC, { u, l: limit }))?.recentAcSubmissionList); }
  async allStatuses(u: string, limit: number) { return this.norm((await this.gql(ALL, { u, l: limit }))?.recentSubmissionList); }
  async solvedTotals(u: string) {
    const m = (await this.gql(PROFILE, { u }))?.matchedUser; if (!m) throw new PocError('NOT_FOUND', 'no matchedUser');
    return Object.fromEntries((m.submitStats?.acSubmissionNum ?? []).map((d: any) => [d.difficulty, d.count])) as Record<string, number>;
  }
}
