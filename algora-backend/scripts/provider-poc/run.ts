/**
 * CONTROLLED LIVE PROOF OF CONCEPT. See docs/LIVE_POC_RUNBOOK.md.
 *
 * It will not start unless ALL of these are true (a generic "I accept the risk" is NOT accepted):
 *   POC_PERMISSION_FILE   path to a saved copy of LeetCode's written permission (non-empty file; its sha256 is recorded)
 *   POC_CONSENT_FILE      JSON: [{ "username": "...", "consentedOn": "YYYY-MM-DD", "contact": "..." }]  (each person agreed)
 *   POC_ASSIGNED_FILE     JSON: ["two-sum", ...] the Algora problem slugs under test
 *   POC_CONTACT           contact string sent in the User-Agent so LeetCode can reach us
 * Optional: POC_MIN_GAP_MS (default 10000), POC_MAX_REQUESTS (default 120, hard cap for the whole run).
 *
 * Usage: npx tsx scripts/provider-poc/run.ts baseline
 *        npx tsx scripts/provider-poc/run.ts watch <username> [minutes]     # tester solves a problem while this polls
 *        npx tsx scripts/provider-poc/run.ts invalid
 * Output: redacted JSON in ../docs/poc-results/ (usernames replaced by stable hashes).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DirectClient, PocError, type Row } from './direct';

function need(k: string) { const v = process.env[k]; if (!v) { console.error(`ABORT: ${k} is not set. See docs/LIVE_POC_RUNBOOK.md.`); process.exit(2); } return v; }
const permFile = need('POC_PERMISSION_FILE');
if (!fs.existsSync(permFile) || fs.statSync(permFile).size < 50) { console.error('ABORT: POC_PERMISSION_FILE is missing or too small to be a real permission document.'); process.exit(2); }
const permSha = crypto.createHash('sha256').update(fs.readFileSync(permFile)).digest('hex');
const consent: { username: string; consentedOn: string; contact: string }[] = JSON.parse(fs.readFileSync(need('POC_CONSENT_FILE'), 'utf8'));
if (!consent.length || consent.some((c) => !c.username || !/^\d{4}-\d{2}-\d{2}$/.test(c.consentedOn) || !c.contact)) { console.error('ABORT: every consent entry needs username, consentedOn (YYYY-MM-DD) and contact.'); process.exit(2); }
const assigned = new Set<string>((JSON.parse(fs.readFileSync(need('POC_ASSIGNED_FILE'), 'utf8')) as string[]).map((s) => s.toLowerCase()));
const gap = Number(process.env.POC_MIN_GAP_MS ?? 10_000);
const maxReq = Number(process.env.POC_MAX_REQUESTS ?? 120);
let used = 0;
const client = new DirectClient(((u: string, i: any) => fetch(u, i)) as any, `AlgoraPoC/0.1 (+${need('POC_CONTACT')})`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alias = (u: string) => 'user_' + crypto.createHash('sha256').update(u.toLowerCase()).digest('hex').slice(0, 6);
const consented = (u: string) => consent.some((c) => c.username.toLowerCase() === u.toLowerCase());

async function call<T>(label: string, fn: () => Promise<T>) {
  if (++used > maxReq) { console.error('ABORT: request budget exhausted'); process.exit(3); }
  const t = Date.now();
  try { const v = await fn(); await sleep(gap); return { label, ok: true as const, ms: Date.now() - t, v }; }
  catch (e) {
    const kind = e instanceof PocError ? e.kind : 'ERROR';
    console.error(`${label}: ${kind}`);
    if (kind === 'RATE_LIMITED') { console.error('ABORT: rate limited or blocked. Stop and tell LeetCode/your contact; do not retry.'); save({ aborted: kind }); process.exit(4); }
    await sleep(gap); return { label, ok: false as const, ms: Date.now() - t, error: kind };
  }
}
const summarise = (rows: Row[]) => ({ count: rows.length, distinctSlugs: new Set(rows.map((r) => r.slug)).size, duplicatesInWindow: rows.length - new Set(rows.map((r) => r.slug)).size,
  newest: rows[0]?.at?.toISOString() ?? null, oldest: rows.at(-1)?.at?.toISOString() ?? null, nullTimestamps: rows.filter((r) => !r.at).length, idsPresent: rows.some((r) => r.id !== null),
  statuses: Object.fromEntries([...new Set(rows.map((r) => r.status ?? 'n/a'))].map((s) => [s, rows.filter((r) => (r.status ?? 'n/a') === s).length])),
  matchesAssigned: [...new Set(rows.map((r) => r.slug))].filter((s) => assigned.has(s)), sampleSlugs: rows.slice(0, 3).map((r) => r.slug) });
const results: any = { startedAt: new Date().toISOString(), permissionSha256: permSha, entries: [] };
function save(extra: object = {}) { fs.mkdirSync('../docs/poc-results', { recursive: true }); const f = `../docs/poc-results/live-${results.startedAt.replace(/[:.]/g, '-')}.json`; fs.writeFileSync(f, JSON.stringify({ ...results, ...extra, requestsUsed: used }, null, 2)); console.log('written', f); }

(async () => {
  const [mode, who, mins] = process.argv.slice(2);
  if (mode === 'baseline') {
    for (const c of consent) {
      const e: any = { user: alias(c.username) };
      // History limit: ask for more than 20 and see what comes back, for both lists.
      for (const limit of [20, 50, 100]) { const r = await call(`ac${limit}`, () => client.acceptedOnly(c.username, limit)); e[`accepted_limit${limit}`] = r.ok ? { ms: r.ms, ...summarise(r.v) } : { error: r.error }; }
      for (const limit of [20, 50]) { const r = await call(`all${limit}`, () => client.allStatuses(c.username, limit)); e[`allstatus_limit${limit}`] = r.ok ? { ms: r.ms, ...summarise(r.v) } : { error: r.error }; }
      const t = await call('totals', () => client.solvedTotals(c.username)); e.profileTotals = t.ok ? t.v : { error: t.error };
      results.entries.push(e);
    }
  } else if (mode === 'watch') {
    if (!who || !consented(who)) { console.error('ABORT: username is not in the consent file'); process.exit(2); }
    const base = await call('baseline', () => client.acceptedOnly(who, 20));
    if (!base.ok) { save({ error: base.error }); return; }
    const known = new Map(base.v.map((r) => [`${r.slug}|${r.at?.getTime() ?? 'na'}`, r]));
    console.log(`Baseline captured (${base.v.length} rows). Tester: solve a problem NOW and note the wall-clock time shown on LeetCode.`);
    const startedAt = Date.now(); const e: any = { user: alias(who), polls: [], newSeen: [] };
    while (Date.now() - startedAt < Number(mins ?? 15) * 60_000) {
      await sleep(Math.max(0, 60_000 - gap)); // about one poll per minute
      const r = await call('poll', () => client.acceptedOnly(who, 20));
      e.polls.push({ tSec: Math.round((Date.now() - startedAt) / 1000), ok: r.ok, ms: r.ok ? r.ms : undefined });
      if (r.ok) for (const row of r.v) { const k = `${row.slug}|${row.at?.getTime() ?? 'na'}`; if (!known.has(k)) { known.set(k, row); e.newSeen.push({ slug: row.slug, submissionTime: row.at?.toISOString() ?? null, firstSeenAfterSec: Math.round((Date.now() - startedAt) / 1000), firstSeenAt: new Date().toISOString(), inAssigned: assigned.has(row.slug) }); console.log('NEW', row.slug, row.at?.toISOString()); } }
    }
    results.entries.push(e);
  } else if (mode === 'invalid') {
    const r = await call('invalid-user', () => client.acceptedOnly('algora-poc-nonexistent-user-zzq9x', 20));
    results.entries.push({ control: 'invalid username', result: r.ok ? { returnedRows: r.v.length } : { error: r.error } });
  } else { console.error('mode must be baseline | watch | invalid'); process.exit(2); }
  save();
})();
