/**
 * Standalone LeetCode access PoC. NOT part of the app.
 *
 * Step 1 (always): read https://leetcode.com/robots.txt and test the GraphQL path.
 * Step 2 (only if allowed): query consenting usernames at low rate.
 *
 * It refuses to proceed while robots.txt disallows /graphql, unless LEETCODE_WRITTEN_PERMISSION
 * is set to a reference (e.g. email thread id) proving LeetCode allowed this use in writing.
 *
 * Usage: npx tsx scripts/leetcode-poc.ts <consenting_username> [more...]
 */
const ORIGIN = 'https://leetcode.com';

function disallowed(robots: string, path: string): string | null {
  let applies = false;
  let best: string | null = null;
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    const [k, ...v] = line.split(':');
    const val = v.join(':').trim();
    if (/^user-agent$/i.test(k)) applies = val === '*';
    else if (applies && /^disallow$/i.test(k) && val && path.startsWith(val.replace(/\*.*$/, ''))) {
      if (!best || val.length > best.length) best = val;
    }
  }
  return best;
}

async function gql(query: string, variables: object) {
  const r = await fetch(`${ORIGIN}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'AlgoraPoC/0.1 (contact: set-me)' },
    body: JSON.stringify({ query, variables }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function main() {
  const usernames = process.argv.slice(2);
  const robots = await (await fetch(`${ORIGIN}/robots.txt`)).text();
  const rule = disallowed(robots, '/graphql');
  console.log(`robots.txt rule matching /graphql: ${rule ?? 'none'}`);
  if (rule && !process.env.LEETCODE_WRITTEN_PERMISSION) {
    console.error('ABORT: /graphql is disallowed for automated clients and no written permission is configured.');
    console.error('Not contacting LeetCode. See docs/LEETCODE_FINDINGS.md.');
    process.exit(2);
  }
  if (!usernames.length) throw new Error('Provide at least one consenting username');
  for (const u of usernames) {
    const profile = await gql(
      `query($u:String!){matchedUser(username:$u){username submitStatsGlobal{acSubmissionNum{difficulty count}}}}`, { u });
    const recent = await gql(
      `query($u:String!,$l:Int){recentAcSubmissionList(username:$u,limit:$l){id title titleSlug timestamp}}`, { u, l: 50 });
    const list = recent.body?.data?.recentAcSubmissionList ?? [];
    console.log(JSON.stringify({
      username: u, profileStatus: profile.status, recentStatus: recent.status,
      totals: profile.body?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum,
      recentCount: list.length, // observes the real window cap
      oldest: list.at(-1)?.timestamp, newest: list[0]?.timestamp,
      slugsLowercaseKebab: list.every((s: any) => /^[a-z0-9-]+$/.test(s.titleSlug)),
    }, null, 2));
    await new Promise((r) => setTimeout(r, 3000)); // slow, sequential
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
