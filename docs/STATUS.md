# Status

Legend: **Live** = exercised against real external services. **Browser** = driven in Chromium against the real Next.js build and Express app (Google and LeetCode stubbed). **Mock** = automated tests with the mock provider or stubbed Google. Nothing in this repository is **Live** yet.

## Test results (latest run)

| Suite | Command | Result |
|---|---|---|
| Backend unit and integration (vitest, replica-set MongoDB in memory) | `npm test` in `algora-backend` | **189 passed, 0 failed**, 15 files |
| Multi-provider failover scenarios (all 22 requested + adapter, admin and consent tests) | `tests/failover.test.ts`, `tests/classifier.test.ts` | 33 + 4 passed |
| Multi-process coordination with failover (3 processes, one replica set, flaky primary) | part of `npm test` | passed: 22 provider calls (15 Direct, 7 Alfa), 7 failovers, circuit opened and closed, no per-student overlap, no overlapping passes, shared rate held, no duplicate evidence |
| Browser: core flows | `node tests/browser/run.mjs` | **23 passed, 0 failed** |
| Browser: verification experience, integration dashboard, pause, consent withdrawal (mock provider) | `node tests/browser/sync.mjs` | **10 passed, 0 failed** |
| Load with failover: 200 / 500 / 1,000 students | `LOAD_STUDENTS=n node tests/load/run.mjs` | see below |
| Type check, build, lint, dependency audit | `tsc`, `npm run build` (both apps), `eslint`, `npm audit --omit=dev` | clean; 0 vulnerabilities |
| Production-mode smoke of the compiled backend | `node dist/server.js` with `NODE_ENV=production` | start-up refusals, `/health`, `/ready`, CORS, CSRF, real Google verifier rejection, JSON logs, graceful SIGTERM all verified (`PRODUCTION.md` §3) |
| Backup and restore | `npm run backup`, `mongorestore` | verified against a local replica set |

Per-file backend counts:
- `analytics` 11, `auth` 19, `classifier` 4, `failover` 33, `lease` 13, `links` 9, `multiproc` 1
- `phases3to6` 21, `progress` 13, `provider-poc` 5, `security` 6, `sync-policy` 8, `sync-service` 28, `urlcsv` 12

## Load test with provider failover (simulated)

**Setup:**
- Real Direct, Alfa and LeetCode-Query adapters against an in-process fake LeetCode with 250 ms latency. No LeetCode or third-party traffic.
- One backend process, in-memory replica set, Apple Silicon laptop.
- Shared budget 600/min. Student cooldown 20 s (load setting) so sync demand continues through the outage. Recovery interval 20 s.
- Students loop through dashboard, chapter, leaderboard (50%) and tab-return sync with 1–3 s think time. Direct is cut off (connection refused) from 30% to 60% of the 90 s run.

| | 200 students | 500 students | 1,000 students |
|---|---|---|---|
| HTTP throughput | 342 req/s, 0 errors | 830 req/s, 0 errors | 900 req/s, 0 errors |
| Dashboard p50 / p95 | 2 / 5 ms | 2 / 8 ms (p99 876 ms) | 597 / 1,426 ms |
| Successful sync p50 / p95: before, during, after outage | 311/324, 300/315, 302/311 ms | 362/1,253, 299/306, 301/309 ms | 2,158/2,778, 973/1,135, 1,076/1,624 ms |
| Sync outcomes | 998 success, no user-visible failures during the outage | 1,499 success; 7,192 `RATE_LIMITED` (demand > budget) | 1,519 success; 15,491 `RATE_LIMITED` |
| Provider requests (transport) | 1,003 (Direct 803, Alfa 200) | 1,508 (Direct 897, Alfa 611) | 1,528 (Direct 1,117, Alfa 411) |
| Outage → first failover / circuit open | 13.9 s / 14.1 s (next sync after the outage started) | 0.36 s / 0.71 s | 0.66 s / 0.82 s |
| Restore → Direct preferred again | 7.5 s | 34 s (circuit re-opened once: pause doubled) | 14 s |
| Students synced in 90 s | 200/200 | 500/500 | 922/1,000 (queue 1,000 → 78) |
| Evidence consistency | 0 wrong counts, 0 duplicates; 2,800 rows, all confirmed by both providers | 0 wrong, 0 duplicates | 0 wrong, 0 duplicates |
| MongoDB ops/s | ~4,150 | ~10,300 | ~12,200 |
| Server RSS (MB) | 322 → 371 | 405 → 472 | 468 → 706 |

**Findings:**
- **200 students:** failover is invisible to students. Sync latency is unchanged during the outage and there are no errors.
- **500 students and up:** demand exceeds the 600/min shared budget, and the excess is correctly refused as `RATE_LIMITED`. Before a fix made in this phase, failed attempts to an unreachable provider consumed shared tokens and starved failover at 500 students (no successful failover). Requests that never leave the server now refund their token.
- **1,000 very active students:** one Node process saturates at about 900 req/s, and dashboard p95 reaches 1.4 s. Running two Railway instances is safe (leases, shared buckets and shared breakers) and is the next step at that scale. Analytics would also need materialised aggregates.
- **Caveat:** no Atlas network latency and no Vercel hop. Re-measure in staging.

## Browser-tested (Chromium, stubbed Google ID token)

- **Super Admin:** first and repeat login; HttpOnly, SameSite=Lax cookie not readable by JS; CSRF rejection (403) without a token and success with one.
- **Trainer access:** request → pending → approval in the UI (`tr_rahulsharma`) → trainer login; admin-only navigation hidden and admin API forbidden; unassigned batch returns 404.
- **Course editor:** chapters; problem with canonical-slug preview; duplicate-in-chapter blocked; reorder; publish.
- **Batch setup:** batch created with zero courses, course assigned (chapters hidden), one chapter unlocked.
- **Enrollment and registration:**
  - pending enrollment shows a one-time claim code;
  - registration refused without the code, enrolled with it;
  - registration with a reserved email claims the seat;
  - a duplicate roll number is rejected.
- **Student content:** sees only the unlocked chapter; problem links open `leetcode.com` in a new tab with `noopener`; difficulty filter; a hidden chapter URL is refused; roll number is read-only.
- **Verification unavailable:** the pending LeetCode link shows its challenge, Verify is disabled, and the dashboard and leaderboard state that verification is unavailable.
- **Routing and sessions:** a student opening `/manage` is redirected; suspending a trainer signs them out on the next navigation; a tampered cookie is treated as expired; logout ends the session server-side.
- **Mock provider:**
  - challenge verification succeeds, and wrong profile text is refused;
  - manual sync verifies new problems and shows a cooldown countdown;
  - the chapter shows verification checkmarks and timestamps;
  - tab return after 15 s+ away makes exactly one provider call, and a short switch makes none;
  - leaderboard and analytics agree (30 points);
  - unlinking stops counting while evidence is kept.
- **Pages rendered:** analytics, reports (CSV download contents checked), integration health, audit log. Mobile layout (390 px) with the collapsible sidebar.

- **Integration dashboard (mock provider):** provider shown as serving; Pause → the student dashboard says synchronization is paused by the administrator; Resume works. Withdrawing consent from the profile deletes the student's LeetCode evidence.

Screenshots: `docs/screenshots/` (`12-integration.png` is the integration dashboard).

**Not browser-tested:** real Google sign-in (button rendering, FedCM, consent screen), Secure cookies over HTTPS, the Vercel→Railway proxy, Atlas. These need the staging deployment (`DEPLOYMENT.md` §5).

## Feature status

| Area | Status |
|---|---|
| Google auth, single Super Admin, trainer approval and suspension, student registration, pending enrollment claims | Done. Mock + browser |
| Courses, chapters, problems (CRUD, ordering, archive, slug validation, duplicates, preview, counts) | Done. Mock + browser |
| Batches, trainers, enrollment (single, CSV, pending, claim-code rotation and cancel), batch-course assignment, chapter visibility | Done. Mock + browser |
| LeetCode account ownership lifecycle | Done. Mock + browser. Verification itself needs an authorised provider |
| Evidence integrity, leases, fencing, global rate limit, cooldowns, crash recovery | Done. Mock + multi-process |
| Multi-provider verification (Direct, Alfa, LeetCode Query), provider manager, failover, shared upstream handling, shared circuit breakers, budgets, conflicts | Done. Mock + multi-process + load. **Not live-tested, not production-enabled** (`LEETCODE_PROVIDERS.md`) |
| Super Admin integration dashboard (health, priority, enable/disable, limits, intervals, pause, health check, failover history, conflicts) | Done. API + browser |
| Consent at linking; withdrawal with data deletion | Done. API + browser |
| Student dashboard, courses, chapters, progress, leaderboard, profile, sync button, tab-return hook | Done. Mock + browser |
| Leaderboards (batch-course, course-wide, combined) | Done. Mock + browser |
| Analytics (overview, student table with filters and sorting, chapters, problems, batch, course, student detail) and five CSV reports | Done. Mock + browser |
| Super Admin: trainers, colleges, students (suspend, revalidate, revoke), scoring, audit log, integration health | Done. Mock + browser (trainers, audit, integration) |
| Live access to LeetCode through any provider | **Not enabled** (blocked on authorisation and live PoC) |
| Rank history (`leaderboard_snapshots`) | **Not implemented.** UI says so; no invented history |
| `problem_progress` materialisation | Not used. Progress is computed live; schema retained |
| Production hardening (env guards, probes, structured logs, request ids, secret rotation, CSP and security headers, error pages, noindex, CI, backups) | Done (`PRODUCTION.md`) |
| Staging deployment | **Not done.** Needs your accounts (`PRODUCTION.md` §6) |

## Bugs found and fixed while building multi-provider failover

1. Sorting degraded providers behind healthy ones made failover sticky: the primary never received traffic again, so its breaker could never open or recover. Now strict priority is used and the breaker removes bad providers.
2. A sync arriving while LeetCode was already blocked lost the block reason, so a rate limit showed as "provider unavailable".
3. Saving one integration setting (e.g. pause) reset the others. Saves now merge.
4. During a pause, students were told verification was "not available yet" instead of "paused".
5. A rate-limited request kept the student's 5-minute cooldown, because the attempt timestamp was overwritten before the revert.
6. Failed attempts that never reached LeetCode consumed shared budget and starved failover under load. They now refund their token.
7. The scheduler sized passes from the `leetcode-graphql` budget even when the serving provider used a different upstream.

## Security issues found and fixed in the previous phase

1. **Stale workers could write evidence:** fencing only rejected writes to rows a newer worker had touched. Fixed with transactional fenced writes against the lease (tests: insert-after-expiry, update-untouched, 15-round takeover race).
2. **Manual syncs bypassed fencing and per-student locking.** All syncs now share the per-student lease and fenced writes.
3. **Rate limit was per instance.** It is now a MongoDB bucket shared by all instances (multi-process test).
4. **Cooldown check-then-act race:** 12 concurrent requests could pass. The cooldown is now claimed atomically (test: exactly 1 provider call).
5. **Lease timing used the instance clock.** It now uses the database clock (`$$NOW`).
6. **Legacy or mock evidence could occupy the unique key and block real evidence.** `source` and `linkId` are now in the key (test with all three on the same student, username and slug).
7. **LeetCode username was freely editable and evidence followed the username string.** Replaced with the ownership lifecycle; counting is by verified link; changing back does not restore.
8. **Registration was not atomic:** a failure after user creation could leave orphans, and claims were not state-checked. Now one transaction with atomic `PENDING→CLAIMED` (test: two concurrent registrations with one code, one wins).
9. **Logout only cleared the cookie.** It now bumps `sessionVersion`, so replayed cookies fail.
10. **Rate limiting keyed by IP behind the Vercel proxy** would throttle everyone together. Now keyed by signed-in user, with configurable `TRUST_PROXY_HOPS`. Trainer requests share the auth limiter.
11. **Enrollment list exposed student emails to trainers.** Removed. No contact data in tables or CSVs.
12. **A rate-limited attempt consumed the 5-minute cooldown.** The cooldown is now returned.
13. **Students saw "#1" with zero verified problems.** They now show as unranked until a problem is verified.

Also reviewed with no change needed:
- IDOR: 404 for unauthorised resources (tests across batches, students, analytics, leaderboards, pending).
- Input validation: Zod on every route; operator injection via query brackets and JSON values (tests).
- Regex search is escaped. CSV injection is escaped. Trainer approval is atomic.
- Graceful shutdown with a 15 s hard stop. Health checks the DB.

## Remaining blockers and issues

1. **LeetCode authorisation (external):** no permission yet. `robots.txt` disallows `/graphql` and the terms forbid scraping. Automatic verification and ownership verification stay unavailable. See `LEETCODE_PERMISSION_REQUEST.md` and `LIVE_POC_RUNBOOK.md`.
2. **Real Google OAuth not exercised:** needs a Google OAuth client and a staging URL (`DEPLOYMENT.md` §1).
3. **No staging deployment yet:** Atlas latency, the Vercel proxy, `Secure` cookies and `TRUST_PROXY_HOPS` are unverified.
4. **Ownership proof method is an assumption:** "challenge in profile summary" assumes the authorised provider exposes the profile summary. If it does not, the method must change before enabling.
5. **All providers share one upstream:** failover protects against client, relay and network failures, not against LeetCode refusing access (by design).
6. **Leaderboard memoisation is per instance (10 s):** another instance may show a board up to 10 s old.
7. **Analytics compute on demand:** fine for 200 students (measured). At thousands of students, materialised aggregates will be needed.
8. **Rank history and leaderboard snapshots are not implemented.**
9. **Vercel preview deployments** have different origins and will fail CSRF/CORS unless pointed at a matching staging backend.
