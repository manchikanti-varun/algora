# LeetCode integration: decision record

Evidence labels: [SRC] read in source, [SIM] simulation with assumed behaviour (not measured), [UNTESTED] no live data exists yet.

## 1. Provider comparison for accepted-submission tracking

| | `leetcode-query` | Self-hosted Alfa | Thin in-repo client (recommended) |
|---|---|---|---|
| Query used | `recentSubmissionList`, **all statuses** [SRC] | `recentAcSubmissionList`, **accepted only** [SRC] | `recentAcSubmissionList`, accepted only |
| Failed attempts consume the window? | **Yes** | No | No |
| Reaches the accepted-only query? | Only through its raw `graphql()` method, where you write the query yourself. Its built-in `recent_submissions` is all-status [SRC] | Built in | Same query |
| Extra moving parts | npm dependency. Its constructor makes a network call to fetch a CSRF cookie when no credential is passed, sends an empty `LEETCODE_SESSION` cookie, and uses a browser-like User-Agent [SRC] | A separate Docker service on Railway, a 5-minute response cache that adds up to 5 minutes of lag, a 120/h per-IP limiter that must be raised [SRC] | About 40 lines inside the Express app, honest identifying User-Agent, our own timeout, backoff and breaker (already built) |
| Submission id | No | No | No (nullable) |
| Authorization | None | None | None |

**Decision:** use the accepted-only query. The choice that matters is the query, not the wrapper. `leetcode-query` as shipped uses the polluted all-status list, so using it means bypassing its main method anyway. Self-hosted Alfa adds a service and cache lag for no capability we lack. I recommend the thin client behind the provider interface (`src/modules/leetcode/providers`), and will implement it only after the live PoC, so that what ships is exactly what was measured. All three call the same unofficial endpoint, so none of them is authorized by itself.

**Why accepted-only matters** [SIM]: with 12 attempts/hour and a 25% accept rate, an hourly in-hours sweep captures 91.8% of first accepted problems through the all-status window and 100% through the accepted-only window. Once a day: 31.8% vs 93.5%. The simulation uses assumed behaviour. It is not measured, and the live PoC is what confirms it.

## 2. Submission ids

Nullable everywhere. Identity is `(student, canonical slug, LeetCode username)`. Repeats never add points: evidence is one row per slug, keeping the earliest timestamp.

## 3. Bootcamp coverage (5 days, 200 students) [SIM]

Assumptions (not measured): 2 to 4 sessions a day of 1 to 2.5 h inside 09:00 to 17:00, 4 attempts an hour, 40% acceptance, a window of 20. The heavy case uses 12 attempts an hour and 25% acceptance. `scripts/provider-poc/bootcamp-sim.ts` models the **implemented** policy (row 3) next to simpler alternatives.

| Schedule | Captured (accepted-only), normal / heavy | Provider requests over 5 days, normal / heavy | Average per bootcamp hour |
|---|---|---|---|
| Once a day | 99.9% / 93.5% | 1,000 | 25 |
| Hourly in bootcamp hours | 100% / 100% | 10,000 | 250 |
| **Implemented**: 15 min active / 60 min idle, tab-return with 300 s cooldown, 240 min off-hours for recently active students | 100% / 100% | 27,764 / 36,638 | about 694 / 916 |

Both fit the default global cap of `LEETCODE_GLOBAL_RATE_PER_MIN=20` (1,200 an hour). The real cap must come from LeetCode's answer. Requests above the cap become `RATE_LIMITED` and are retried later; they are never lost evidence unless more than 20 accepted submissions pass between syncs.

## 4. Synchronization

Implemented as described in `ARCHITECTURE.md` §6 and §7: per-student leases shared by manual and scheduled syncs, fenced transactional writes, MongoDB global rate bucket, atomic cooldowns, breaker, backoff. It is **mock-tested only** and is **off by default**.

## 5. Estimated cost (estimates; Railway and Atlas prices not verified here)

| Students | Requests per hour in bootcamp hours (schedule above) | Pass time at 20/min | Infrastructure |
|---|---|---|---|
| 200 | 250 to 500 | about 10 to 25 min of rate budget per hour | Same Railway API service. No extra service. Atlas free tier |
| 500 | 625 to 1,250 | exceeds 1,200/h at the peak | Raise the rate cap only if LeetCode permits, or lengthen idle intervals |
| 1,000+ | 1,250+ | | Separate worker service (same repo), more careful rate agreement with LeetCode |

Storage: evidence about 250 bytes a row. 200 students x 150 problems = 30,000 rows, about 8 MB. Sync logs expire after 60 days.

## 6. Answers

1. **Most suitable provider:** the accepted-only query via a thin in-repo client. Among the libraries: self-hosted Alfa over `leetcode-query`, because `leetcode-query` is all-status. Neither is authorized.
2. **Can we track newly accepted submissions in a bootcamp?** In principle yes: [SIM] near-complete with hourly sweeps. Unproven live. Not verified that a new solve appears or how fast.
3. **Limitations:** 20-submission window (only solves made while Algora watches are reliably captured, earlier solves are not); no submission ids; unofficial endpoint that can change or block; permission not granted; Alfa adds up to 5 minutes lag if used.
4. **Cost:** no extra infrastructure at 200 students.
5. **What I need now:** send `LEETCODE_PERMISSION_REQUEST.md` (fill the brackets), and prepare the PoC inputs listed in `LIVE_POC_RUNBOOK.md`.
6. **What blocks the live PoC:** no written permission file, and no consenting tester usernames. The runner enforces both.
7. **Fastest authorized path:** send the request today. When LeetCode replies, run the PoC (about 90 minutes), then I implement and enable the production provider. If LeetCode declines or does not answer, there is no authorized automatic option, and the decision is yours.
