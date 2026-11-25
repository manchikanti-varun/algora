# LeetCode verification: multi-provider architecture

Status labels used below: **Implemented** (code exists), **Mock-tested** (automated tests with mock transports or mock providers), **Live-tested** (against real LeetCode or a real Alfa deployment), **Production-enabled**.

| Capability | Implemented | Mock-tested | Live-tested | Production-enabled |
|---|---|---|---|---|
| Direct provider (thin GraphQL client) | yes | yes (real adapter, fake LeetCode transport) | **no** | **no** |
| Alfa provider (relay adapter) | yes | yes (real adapter, fake Alfa transport) | **no** | **no** |
| LeetCode Query provider (`leetcode-query` package) | yes | yes (real adapter, fake client) | **no** | **no** |
| Provider manager, failover, shared upstream handling, health, circuit breakers, budgets | yes | yes (unit, integration, 3-process, load) | no | **no** (sync disabled) |
| Super Admin integration dashboard and controls | yes | yes (API tests + browser) | n/a | yes (shows "disabled") |

Nothing is production-enabled. With `LEETCODE_SYNC_ENABLED=false`, or without `LEETCODE_PERMISSION_REF`, no request can reach LeetCode or Alfa. Unauthorised providers get a transport that refuses every request.

## 1. Adapters (`src/modules/leetcode/providers/`)

| | Direct | Alfa | LeetCode Query |
|---|---|---|---|
| Source of data | `leetcode.com/graphql` from this server | Alfa server, which calls `leetcode.com/graphql` | `leetcode.com/graphql` from this server, via the npm library |
| Query | `recentAcSubmissionList` (accepted only) with `id` | `GET /:username/acSubmission?limit=N`, which runs `recentAcSubmissionList` (verified in Alfa source) | default `accepted` mode: the same accepted-only query through the library's `graphql()`; `all-status` mode: the library's `recent_submissions()`, filtered locally |
| Submission ids | yes | **no** (Alfa does not select `id`) | accepted mode yes; all-status no |
| Window | 20 | 20 | 20 (all-status: 20 rows of any status, so **reduced coverage**) |
| Cache | none | Alfa's own response cache, default 5 min (`LEETCODE_ALFA_CACHE_SEC`, reported as `dataAsOf`) | none |
| Own limits | none | Alfa limiter 120/h per IP by default (`LEETCODE_ALFA_RATE_PER_MIN=2`) | library limiter (20 per 10 s, concurrency 2, per instance) |
| Profile text (ownership proof) | `matchedUser.profile.aboutMe` | `GET /:username` → `about` | `user()` → `aboutMe` |
| Error format | HTTP status + GraphQL `errors` | HTTP 200 with GraphQL `errors` **or plain text**; its own 429 | thrown `Error("HTTP 429 …")` |

All adapters normalise to `AcceptedSubmission { submissionId | null, username, problemTitle, problemSlug, status: 'ACCEPTED', submittedAt | null, provider }` (`submission-normalizer.ts`):
- Invalid slugs are dropped, never guessed.
- Timestamps more than 5 minutes in the future become `null` and are recorded as a conflict.
- Exact duplicates are collapsed.
- Ids and timestamps are never invented.

**Adding a provider:**
1. Implement `SubmissionProvider` (`provider.interface.ts`).
2. Register it in `provider.registry.ts`, with its env flag and authorisation rule.
3. Add its id to the priority list.

The dashboard, progress, leaderboards, course and batch code read only `solve_evidence` and need no change.

## 2. Provider manager (`provider-manager.ts`)

- **One request per sync**, through **one** eligible provider, in **strict priority order** (`LEETCODE_PROVIDER_PRIORITY`, reorderable by the Super Admin).
- **Eligible means** enabled in the environment, not disabled by the admin, authorised, circuit not open, and not inside the provider's own Retry-After window. Degraded providers keep their position. Demoting them would starve them of traffic, so they could never recover; repeated failures open their circuit instead.
- **Budgets:** each attempt takes one token from the **shared upstream bucket** (`upstream:leetcode-graphql`, all providers and all instances) and one from the **provider's own bucket**. Both are MongoDB buckets, so they hold across instances.
  - If the shared budget is empty, the request stops with `RATE_LIMITED` and no failover.
  - If the provider's own budget is empty, that provider is skipped and its shared token is refunded.
  - A request that provably never left the server (connection refused, DNS failure, config error) refunds its shared token.
- **Attempt cap:** at most `1 + LEETCODE_MAX_FAILOVER` attempts per call, so there are no retry loops.

## 3. Failover rules (`provider-error.classifier.ts`)

| Failure | Scope | Behaviour |
|---|---|---|
| Provider outage, connection failure, timeout, malformed response, client/library bug, misconfiguration | PROVIDER | record, maybe open circuit, **try next eligible provider** |
| Provider's own rate limit (e.g. Alfa's 429) | PROVIDER | provider sits out until Retry-After (not a breaker failure), next provider tried |
| LeetCode 429 | UPSTREAM | **block every LeetCode-backed provider** until Retry-After (else 120 s), no failover |
| LeetCode 401/403, CAPTCHA/challenge page, `cf-mitigated: challenge`, non-JSON 200 | UPSTREAM | block all for 30 min (or Retry-After), no failover |
| LeetCode 5xx | UPSTREAM | block all for the recovery interval, no failover |
| Alfa relaying a LeetCode HTML page (HTTP 200 + JSON parse error text) | UPSTREAM | treated as a LeetCode restriction (conservative) |
| Network failures from **two different** providers that both reach LeetCode directly within 2 min | UPSTREAM | LeetCode treated as unreachable, all blocked for the recovery interval |
| "User does not exist" | USER | stop; another provider would give the same answer |

Blocks only extend (`$max`), never shorten. **Switching providers is never used to get round LeetCode's limits or restrictions.**

**Recovery:**
- A circuit opens after `LEETCODE_PROVIDER_FAILURE_THRESHOLD` consecutive provider failures.
- After `LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC` it half-opens, and **one** probe runs per cluster (atomic claim).
- If the probe succeeds the circuit closes, and the preferred provider is used again automatically (strict priority).
- If the probe fails the circuit re-opens, with the pause doubling up to 15 min.

Admin health checks use a **consenting** account (`LEETCODE_HEALTHCHECK_USERNAME`) and respect every block and budget.

## 4. Evidence across providers

`solve_evidence` has one row per (student, verified link, slug, source). The same problem seen through Direct, then Alfa, is **one row** with `providers: ['direct', 'alfa']`.
- **Switching providers** never duplicates points.
- **Observed timestamps** only move outward.
- **Provider failures** never delete or downgrade evidence.
- **Conflicts** (only detectable when ids are returned; stored in `evidence_conflicts`):
  - Same submission id with a different slug: the row is **not** used (no unsupported verification).
  - Same id with a timestamp more than 2 min apart: the problem stays verified but that timestamp is not used.
  - Future timestamps are recorded.
- **Consent:** linking requires explicit consent (`consentedAt`); evidence counts and syncs run only for consented, verified links. `DELETE /student/leetcode/data` revokes the links and deletes the student's evidence, observed submissions and conflicts (audited).

## 5. Activation steps per provider

Common to all:
1. Obtain LeetCode's written permission (`LEETCODE_PERMISSION_REQUEST.md`) and save it.
2. Run the live PoC (`LIVE_POC_RUNBOOK.md`) with consenting testers. Set ceilings from the measured and agreed limits.
3. On Railway set `LEETCODE_PERMISSION_REF=<reference>`, `LEETCODE_GLOBAL_RATE_PER_MIN=<agreed>`, `LEETCODE_CONTACT=<email>`, `LEETCODE_HEALTHCHECK_USERNAME=<consenting account>`.
4. Enable the provider(s) below, then `LEETCODE_SYNC_ENABLED=true`. Redeploy. Run **Run health check** on the Integration page and confirm each enabled provider shows `OK`.

**Direct:** `LEETCODE_DIRECT_ENABLED=true`. Nothing else is needed.

**Alfa:**
1. Do not use the shared public instance in production: it allows 120 requests an hour per IP and has no SLA.
2. Deploy your own instance (Docker image `alfaarghya/alfa-leetcode-api`) only if you want an independent relay. That is an extra Railway service.
3. Set `LEETCODE_ALFA_ENABLED=true`, `LEETCODE_ALFA_BASE_URL=https://<your-alfa>`, `LEETCODE_ALFA_PERMISSION_REF=self-hosted` (or the hosted operator's terms reference), and `LEETCODE_ALFA_RATE_PER_MIN` to that deployment's limiter.
4. Note that Alfa calls the same LeetCode upstream, so it adds resilience against client bugs and our own network issues, **not** against LeetCode limits.

**LeetCode Query:**
1. Set `LEETCODE_QUERY_ENABLED=true`, and `LEETCODE_QUERY_MODE=accepted` (recommended) or `all-status`.
2. The library is loaded lazily the first time an authorised request needs it. Its constructor contacts `leetcode.com` to obtain a CSRF cookie.

## 6. Incremental cost of multiple providers (estimates)

- **Compute:** none. All adapters run inside the existing Express process. `leetcode-query` is loaded lazily.
- **MongoDB:** `provider_state` (a few documents); `provider_events` (TTL 30 days); `observed_submissions` (one row per accepted submission with an id, about 200 B; 200 students × 150 problems ≈ 6 MB); `evidence_conflicts` (normally empty). This is well inside the Atlas free tier at 200 students.
- **LeetCode request volume:** failover does not add volume beyond the shared budget. Failed attempts that reached a server count against it.
- **Optional self-hosted Alfa:** one small extra Railway service. Railway pricing was not verified here. Skip it unless an independent relay is required.

## 7. Known limitations

- None of the three providers has been tested against real LeetCode or a real Alfa deployment.
- All three depend on the same upstream (LeetCode GraphQL). The architecture protects against client, relay and local-network failures, not against LeetCode refusing access, and it deliberately does not try to.
- Alfa returns no submission ids, so cross-provider conflict detection only works between Direct and LeetCode Query (accepted mode).
- Alfa's cache can delay new solves by up to `LEETCODE_ALFA_CACHE_SEC`.
- The LeetCode Query library also rate-limits per process (20 per 10 s); with several instances its effective limit multiplies, but our shared budget still caps the total.
- Circuit pauses double on each failed probe, so after a long outage the preferred provider can take up to 15 min to be used again (measured: 7.5 s at 200 students, 14 s at 1,000, with a 20 s recovery interval).
