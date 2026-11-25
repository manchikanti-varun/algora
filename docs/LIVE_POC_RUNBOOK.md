# Controlled live proof of concept

Nothing in this runbook runs until LeetCode's written permission exists as a file. `scripts/provider-poc/run.ts` refuses to start without it. A general risk acknowledgement does not unlock it.

## What I need from you

| # | Item | Why |
|---|---|---|
| 1 | LeetCode's written reply (email/PDF) saved as a file, e.g. `~/algora-poc/permission.pdf` or `.txt` | Required by the runner. Its SHA-256 is recorded in the results. If LeetCode sets limits (requests per minute, User-Agent), tell me and I will set `POC_MIN_GAP_MS` and `POC_MAX_REQUESTS` to match |
| 2 | 3 to 5 **consenting** testers with LeetCode accounts, at least one with 25+ lifetime accepted solves and one with a brand-new or empty history | Window size and empty-history behaviour |
| 3 | A consent file, one entry per tester: `{"username","consentedOn":"YYYY-MM-DD","contact"}`. Consent must be given by the tester (an email or chat message is enough; keep it) | Required by the runner |
| 4 | An assigned-problems file: JSON array of 5 to 10 slugs, at least 3 the testers have **not** solved yet, plus 1 already solved | Tests slug matching and new-solve detection |
| 5 | A contact email for the User-Agent (`POC_CONTACT`) | LeetCode can reach us if our traffic causes a problem |
| 6 | 90 minutes with the testers available | For the watch phase |

## Environment variables (my machine or yours, never committed)

```
POC_PERMISSION_FILE=~/algora-poc/permission.pdf
POC_CONSENT_FILE=~/algora-poc/consent.json
POC_ASSIGNED_FILE=~/algora-poc/assigned.json
POC_CONTACT=you@yourorg.com
POC_MIN_GAP_MS=10000        # at least this long between requests (lower only if LeetCode allows)
POC_MAX_REQUESTS=120        # hard stop for the whole run
```

No Google, Mongo, Railway or Vercel variables are needed for the PoC. It is a standalone script.

## Steps

All commands run from `algora-backend/`. The runner is sequential, stops immediately on any 429 or 403, and never retries a block.

1. **Baseline** (about 10 requests per tester, about 2 minutes each):
   `npx tsx scripts/provider-poc/run.ts baseline`
   Measures for each tester: accepted-only list at limit 20/50/100, all-status list at limit 20/50, lifetime solved totals. Answers: *actual history limit*, *whether the accepted-only list is capped at 20*, *whether timestamps and slugs are present*, *whether ids are present*, *duplicates inside the window*, *slug match against assigned problems*.
2. **Invalid user control** (1 request): `npx tsx scripts/provider-poc/run.ts invalid`
3. **New-solve latency**, one tester at a time (about 15 requests each):
   `npx tsx scripts/provider-poc/run.ts watch <username> 15`
   - Script captures a baseline and then polls about once a minute.
   - Tester opens an assigned, not-yet-solved problem on leetcode.com, submits a correct solution, and **writes down the wall-clock time** LeetCode shows for the submission (the `Submitted` time in My Submissions).
   - Output lists each new row with `firstSeenAfterSec`. Delay = first-seen time minus the tester's noted submission time. Compare the returned `submissionTime` with the tester's note to validate timestamp reliability.
4. **Duplicates and failures** (same watch session, then again): tester (a) resubmits the same problem accepted a second time, (b) makes 3 deliberately wrong submissions on another problem. Check that the accepted-only list shows the duplicate as a separate row with the same slug (our evidence logic counts it once), and compare how the all-status list fills with the failed attempts. This is the evidence for choosing the accepted-only query.
5. Collect `docs/poc-results/live-*.json` (usernames are hashed). Share them with me.

## Pass criteria

| Question | Pass |
|---|---|
| Can accepted submissions be retrieved? | Baseline returns rows with `slug` and `timestamp` for testers with history |
| Does a new solve appear? | Seen in at least 4 of 5 watch trials |
| How long? | I report the median and the worst case. Suitable for a bootcamp if the worst case is 15 minutes or less. Each extra minute is lag in the dashboard, not a loss of evidence |
| History limit | `accepted_limit100.count` on a tester with 25+ solves shows the real cap. If it is 20, the design assumptions in the report hold |
| Slugs match | Every accepted row for an assigned problem has a slug exactly equal to the assigned slug |
| Duplicates | Duplicate accepted rows appear, and my evidence logic stores one row per slug |
| Timestamps | Returned time is within 2 minutes of the tester's noted time in at least 4 of 5 trials |
| Failure handling | `invalid` gives NOT_FOUND, and nothing returns 429/403 at the agreed rate |

If any request is blocked (429/403), the run stops. Stop all testing and contact LeetCode.

## After the PoC

If it passes I implement the production provider (`leetcode-ac`) with the same query that was measured, enable it with `LEETCODE_PROVIDER=leetcode-ac`, `LEETCODE_SYNC_ENABLED=true` and `LEETCODE_PERMISSION_REF=<path or id of the permission>`. Production refuses to start with a real provider and no `LEETCODE_PERMISSION_REF`.
