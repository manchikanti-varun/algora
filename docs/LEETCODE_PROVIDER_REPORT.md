# LeetCode third-party provider investigation

> Historical investigation report. Decision and current numbers: `LEETCODE_DECISION.md`. The `selfReport`/`attestEvidence` functions mentioned in §9 have been removed.

Date of investigation: 24 Nov 2026. Evidence labels used throughout:

- **[SRC]** read in the provider's source code (cloned, inspected).
- **[DOC]** stated in provider documentation only.
- **[OBS]** observed by a real request I made.
- **[MOCK]** exercised only against a mock whose shape comes from [SRC].
- **[UNTESTED]** assumption, not verified.

## Verdict: BLOCKED

No provider with authorization to retrieve LeetCode data was found, and no live data was retrieved. Every provider is a pass-through to LeetCode's unofficial GraphQL endpoint, which `robots.txt` disallows and whose terms forbid scraping (see `LEETCODE_FINDINGS.md`). The technical capability exists but is limited, and it is not "WORKING" or "PARTIALLY WORKING" under your definitions, because no provider was tested successfully against real accounts.

## 1. Providers investigated

| Provider | Repo state [OBS: GitHub API] | Independent data source? [SRC] |
|---|---|---|
| Alfa LeetCode API v2.0.4 | MIT, 844 stars, last push 2 Aug 2026, 16 open issues | No. `fetch('https://leetcode.com/graphql')` in `src/Controllers/*` |
| LeetCode Query (`leetcode-query` 2.0.1) | MIT, 131 stars, last push 20 Nov 2026 (last commit on default branch 11 Jul 2025), 15 open issues | No. Same GraphQL endpoint; also fetches a CSRF cookie from `leetcode.com/graphql/` |
| LeetCode Stats API (hosted at leetcode-stats.tashif.codes) | MIT, 5 stars, pushed 24 Nov 2026 | No. `services/client.py` queries the same GraphQL endpoint |
| Others (search) | Sajantoor/LeetCode-API, Xunop/leetcode-api, Ruin9999/leetcode-api, husain3012/leetcode-public-api, faisal-shohag/leetcode_api, MehrshadFb/LC-API and others | All describe themselves as wrappers of LeetCode's GraphQL ("unofficial") [DOC]. Not inspected in depth, since the source of the data is the same |
| Official LeetCode API or partner program for tracking student submissions | Searched. Only found the student premium and campus ambassador programs, which are pricing programs | **None found** |

## 2. Capability comparison

| Question | Alfa | LeetCode Query | LeetCode Stats API |
|---|---|---|---|
| Operational | Hosted root returned 200 in 1.1 s [OBS, static endpoint only] | Library, nothing to host | Hosted root returned 200 in 1.9 s [OBS, static page only] |
| Individual accepted submissions | Yes: `/:u/acSubmission` [SRC] | **No accepted-only call.** `recent_submissions` returns all statuses, filter client-side [SRC] | No dedicated endpoint. Profile includes `recentSubmissions` (all statuses) [SRC] |
| Title and canonical slug | `title`, `titleSlug` [SRC] | `title`, `titleSlug` [SRC] | `titleSlug` mapped in `RecentSubmission` [SRC] |
| Submission ID | **No.** Query selects title, titleSlug, timestamp, statusDisplay, lang [SRC] | **No** on the anonymous path [SRC] | **No** [SRC] |
| Timestamp | Yes, unix seconds as string [SRC] | Yes [SRC] | Yes [SRC] |
| Max recent submissions | `limit` param is forwarded, but LeetCode caps it. Docs say "last 20" [DOC]. Real cap [UNTESTED] | `limit` default 20, doc says "Public, Max: 20" [DOC] | Hard-coded `limit: 20` in the query [SRC] |
| Pagination / full history | None on the public path | **Only with the student's `LEETCODE_SESSION` cookie** (`submissions()` with offset and `hasNext`). Forbidden by our requirements | None |
| Identify older solved problems | No. Only aggregate counts (`/solved`) and a calendar (counts per day, no problems) | Same | Same |
| Authentication | None on public endpoints | None for recent; session cookie for full list | None |
| Rate limits | Hosted: header `ratelimit: limit=120, remaining=104, w=3600` [OBS]. Source: 120/hour/IP, plus a 5-minute response cache [SRC] | None built in. LeetCode's own limits apply [UNTESTED] | Defaults 60/min per IP and 30/min per username, configurable when self-hosted [SRC]. Hosted values not published |
| Hosting | Docker image, or hosted on Render | npm library inside our Express app | Python FastAPI, or hosted |
| Pricing, commercial use | MIT code. No hosted SLA or pricing found | MIT | MIT. Hosted terms not found |
| Error behaviour | HTTP **200** with a GraphQL `errors` body, or plain text [SRC]. Status codes cannot be trusted | Throws | Maps to 404/429/500 [DOC] |
| Authorized by LeetCode to retrieve and redistribute | **No evidence** | **No evidence** | **No evidence** |

MIT covers the provider's code, not LeetCode's data or LeetCode's access rules.

## 3. Proof of concept results

Superseded in part by `LEETCODE_DECISION.md`. Code: `algora-backend/scripts/provider-poc/` (`direct.ts`, `capacity.ts`, `bootcamp-sim.ts`, `run.ts`) and `tests/provider-poc.test.ts`. The earlier Alfa-specific client and mock were replaced by `direct.ts` (queries measured directly) and the production `MockProvider`.

| # | Scenario | Result |
|---|---|---|
| 1 | Retrieve profile | **Not run.** Needs consenting usernames, and a live call relays to `/graphql` |
| 2 | Individual accepted submissions | **Not run live.** Documented and read in source: yes, without IDs |
| 3 | Canonical slugs | [SRC] `titleSlug`. Normalisation lowercases and validates the slug [MOCK] |
| 4 | Timestamps and IDs | Timestamps [SRC]. IDs not available. `submissionId` is `null`, never invented |
| 5 | Match against assigned slugs | Existing slug model supports it. Not part of this PoC |
| 6 | Detect new submission | Not run. Detection would need a diff against stored evidence |
| 7 | Time to appear | **Unknown.** Alfa's source caches every response for 5 minutes, so the floor on Alfa is up to 5 minutes plus LeetCode's own delay [SRC]. LeetCode's delay [UNTESTED] |
| 8 | Older solved problems | Not accessible beyond the window [SRC/DOC]. Not measured live |
| 9 | Actual history limit | Stated 20 [DOC][SRC]. Not measured live. Mock confirms the client handles the cap |
| 10 | Duplicate submissions | The window can contain the same problem several times. Dedupe handled [MOCK] |
| 11 | Invalid username, empty history | Empty history is a valid empty result. Invalid user returns HTTP 200 with errors, mapped to `NOT_FOUND` [MOCK] |
| 12 | Errors, timeouts, rate limits | 429 (with Retry-After), 503, HTML 200, timeout and GraphQL-error-with-200 all map to distinct errors [MOCK] |

Test run: 76 backend tests pass, including 12 new provider tests. All provider behaviour in that table marked [MOCK] reflects my reading of the source, not live traffic. The runner `run.ts` is live-capable but refuses to start without `POC_BASE_URL`, `POC_CONSENTED_USERNAMES` and `LEETCODE_ACCESS_ACK`. It makes at most 6 requests per username, spaced 31 s apart, and writes redacted output (hashed username aliases) to `docs/poc-results/`.

I did not query LeetCode or the hosted providers' data endpoints. The only live requests were the static root pages of the two hosted services, one request each.

### Sample normalized output (from the mock, not live)

```json
{
  "submissionId": null,
  "username": "asha",
  "problemTitle": "two sum",
  "problemSlug": "two-sum",
  "status": "ACCEPTED",
  "submittedAt": "2023-11-14T22:13:20.000Z",
  "dedupeKey": "asha|two-sum|1700000000000"
}
```

`dedupeKey` is a derived key for idempotency. It is not a LeetCode submission ID and must not be shown as one. Your target structure has `submissionId: string`. The data needed to fill it is not available from any anonymous source, so it has to be nullable.

## 4. History limitation

Any anonymous provider sees the last 20 submissions of the account (accepted-only list, 20 maximum [DOC]). Consequences:

- A student who solved problems before enrolling cannot be credited for them if they are outside the window. Only solves made while Algora is watching can be verified.
- If a student makes more than 20 accepted submissions between two syncs, the oldest are lost permanently. Resubmissions of the same problem consume window slots.
- Aggregate solved counts exist (`/solved`). A gap check is possible: if the total solved count rose by more than the number of new distinct slugs we saw, we know evidence is missing and can mark the sync `VERIFICATION_UNAVAILABLE` for that student rather than guess.

## 5. Latency, rate limits and capacity

Hosted Alfa advertises 120 requests per hour [OBS]. If keyed by the proxy IP it is shared across every user of that hosted instance, which I cannot confirm [UNTESTED].

Requests per hour at one provider call per student per sync (arithmetic, `scripts/provider-poc/capacity.ts`):

| Students | 5 min | 15 min | 30 min | 45 min | Shortest interval that fits 120/h |
|---|---|---|---|---|---|
| 200 | 2,400 | 800 | 400 | 267 | 100 min |
| 500 | 6,000 | 2,000 | 1,000 | 667 | 250 min |
| 1,000 | 12,000 | 4,000 | 2,000 | 1,334 | 500 min |
| 5,000 | 60,000 | 20,000 | 10,000 | 6,667 | 2,500 min |
| 10,000 | 120,000 | 40,000 | 20,000 | 13,334 | 5,000 min |

The hosted Alfa instance cannot serve even 200 students at the 30 to 60 minute target. It could do a full pass roughly every 100 minutes, with nothing left for student-triggered syncs. It also runs on Render and had a 1.1 s round trip on its static page; a free-tier cold start is likely [UNTESTED].

Self-hosting removes the 120/h limit but not LeetCode's own limits, which are not published. The real ceiling is [UNTESTED].

At a safe, unverified 1 request per second sustained, a 200-student pass takes about 3.5 minutes, 1,000 about 17 minutes, 10,000 about 2.8 hours. Those are estimates and must be replaced by measured values.

## 6. Cost estimate (estimates, not quotes)

| Students | Provider | Railway | Atlas storage |
|---|---|---|---|
| 200 | Hosted free tier cannot meet the load. Self-host: small container beside the API | One small service (0.5 vCPU, 512 MB) is enough for API and sync | about 10 to 20 MB of evidence (about 60k rows at 200 bytes) |
| 1,000 | Self-host | Likely a separate worker service | about 100 MB |
| 10,000 | Self-host plus IP-block risk | Separate worker service, more memory | about 1 GB |

I did not verify Render, Railway or Atlas pricing in this session, so I give no dollar figures. Atlas free tier (512 MB) covers the first 200 students.

## 7. Recommendation

1. **Do not integrate any provider yet.** The restriction on LeetCode's side is unresolved, and a third party calling it for us does not resolve it.
2. If you obtain written permission from LeetCode, use **`leetcode-query` as a library** in the Express backend, or Alfa self-hosted. I'd prefer the library, with a thin provider interface: it adds no extra service, and the recent-submissions query is the same. Note it returns all statuses (filter for `Accepted` ourselves). Alfa self-hosted adds a service and a 5-minute cache with no benefit. The hosted Alfa and Stats API instances are not suitable for production: shared rate limits, no SLA, third-party dependency.
3. If you decide to proceed without permission, that is a risk decision for you: LeetCode may block the Railway IP or act on the terms. I'll implement it only if you explicitly confirm.

## 8. Proposed production architecture (if unblocked)

- `providers/provider.interface.ts`, `leetcode-query.provider.ts` and `mock.provider.ts`. Providers return `AcceptedSubmission[]` with nullable `submissionId`.
- Evidence written to `solve_evidence` with fenced writes (existing lease). Evidence is never deleted when a sync returns less. Gap check via aggregate count sets `VERIFICATION_UNAVAILABLE`.
- Sync priority: student-triggered (30 to 60 s cooldown) > recently active students > rest. One global token bucket sized from measured limits. Interval chosen from measured limits, not guessed.
- Tab-return trigger calls the same endpoint and is covered by the same cooldown.
- Sync states `SYNCING`, `SYNC_SUCCESS`, `SYNC_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `VERIFICATION_UNAVAILABLE` stored per student.

## 9. Conflict with the strict requirements

Your requirements now exclude self-reported and trainer-attested completion. The code I wrote earlier still contains `selfReport` and `attestEvidence` (`evidence.repository.ts`), and `source` enum values for both in `solve_evidence`. They are unused by any route, and I will remove them as part of the integration.

## 10. Known limitations and risks

- No live data was retrieved. Every claim about live behaviour is unverified.
- 20-submission window means incomplete coverage. Historical solves before enrollment cannot be credited.
- No submission IDs, so evidence cannot be audited against a LeetCode submission URL.
- Terms and robots.txt risk. The unofficial endpoint can change without notice.
- Leaderboards built on this data will be unfair to students who solve in bursts between syncs. UI must say so.

## 11. Decision needed

- (A) Seek written permission from LeetCode (support@leetcode.com) and pause the integration until the answer, or
- (B) Authorize a low-volume pilot with consenting students, to measure the window, latency and rate limits, accepting the terms risk, or
- (C) Provide a consenting username list and the written acknowledgement (`LEETCODE_ACCESS_ACK`) so I can run the PoC and replace [MOCK] and [UNTESTED] with measured values.
