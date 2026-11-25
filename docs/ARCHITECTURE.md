# Algora architecture (as implemented)

## 1. Topology

```
Browser ──► Vercel: algora-frontend (Next.js 16, React 19, Tailwind 4)
              │  next.config.ts rewrites /api/v1/* (BACKEND_URL, read at build time)
              ▼
          Railway: algora-backend (Express 5, TypeScript, modular monolith)
              ├─ REST /api/v1 (auth, courses, batches, student, analytics, reports, admin, leetcode)
              ├─ in-process scheduler (jobs/leetcode-sync.job.ts), lease-coordinated; optional separate worker (src/worker.ts)
              └─► MongoDB Atlas (one database, replica set, transactions)
Google Identity Services issues ID tokens to the browser; the backend verifies them.
```

The session cookie is first-party to the Vercel origin because the browser only talks to Vercel. Next.js contains no business logic.

## 2. Authentication and authorization

- The browser gets a Google ID token. `POST /auth/google` verifies it with `google-auth-library` (signature, issuer, audience, expiry) and requires `email_verified`. Identity is Google's `sub`. Roles come only from the database.
- **Session:** an HMAC-signed HttpOnly cookie `{uid, sessionVersion, exp}` (7 days, `SameSite=Lax`, `Secure` in production). Every request reloads the user and checks three things:
  - the account is `ACTIVE`;
  - `sessionVersion` matches the cookie;
  - for a Super Admin, the email still equals `SUPER_ADMIN_EMAIL`.

  Suspension, revocation and logout all bump `sessionVersion`, so every copy of the cookie stops working.
- **CSRF:** every unsafe request must carry `Origin == FRONTEND_URL`. Authenticated requests also need `X-CSRF-Token`, an HMAC of the session cookie, which `/auth/google` and `/auth/me` return.
- **Single Super Admin:**
  - Missing or invalid `SUPER_ADMIN_EMAIL` means the backend does not start.
  - The account is created on first login.
  - The same email under a different Google `sub` is refused (`IDENTITY_CONFLICT`), and existing accounts are never auto-promoted (`ACCOUNT_CONFLICT`).
  - A changed env email revokes the old admin on boot and on every request.
  - A partial unique index allows only one active `SUPER_ADMIN`.
- **Trainers:** access request (`PENDING_APPROVAL`) → atomic approve, creating ID `tr_<name>` with a numeric suffix if needed, or reject. Super Admin can suspend, reactivate, and toggle course editing (`canManageCourses`).
- **Resource-level authorization:** trainers only see batches in `trainer_batch_assignments` (a trainer who creates a batch is auto-assigned). Unauthorized and missing resources return the same 404. Students only see contexts made of an active enrollment, an active batch, an active batch-course and a published course, and only visible chapters.
- **Rate limiting:** global 300 req/min and auth 20 req/min, keyed by signed-in user or else by client IP (`TRUST_PROXY_HOPS`). Exports: 20/min.

## 3. Data model: 25 collections

| Collection | Purpose | Key indexes / invariants |
|---|---|---|
| `users` | Super Admin, trainers, students; `sync` sub-document with per-student sync state | unique `googleSub`, `email`, `rollNumber` (10 chars, uppercase, global), `trainerId`; partial unique single active `SUPER_ADMIN` |
| `colleges` | normalised names (`nameKey`) | unique `nameKey` |
| `trainer_requests` | access requests | unique `googleSub` |
| `courses`, `chapters`, `problems` | reusable content; ordered; soft-archived | `problems` unique `(chapterId, slug)` among ACTIVE: no duplicate in one chapter, reuse across chapters allowed |
| `batches` | independent of courses | |
| `batch_courses` | many-to-many batch ↔ course, `ACTIVE`/`INACTIVE` | unique `(batchId, courseId)` |
| `trainer_batch_assignments` | trainer access to batches | unique `(trainerId, batchId)` |
| `enrollments` | student ↔ batch, `ACTIVE`/`REMOVED` (history kept) | unique `(studentId, batchId)` |
| `pending_enrollments` | reserved roll numbers; claim-code **hash**; optional reserved email | partial unique `(batchId, rollNumber)` while PENDING |
| `batch_chapter_access` | per batch-course visibility; missing row = hidden | unique `(batchCourseId, chapterId)` |
| `leetcode_links` | LeetCode account ownership lifecycle | partial unique: one active link per normalised username; one current and one pending link per student |
| `solve_evidence` | canonical verified accepted problems per student and link | unique `(studentId, slug, leetcodeUsername, source, linkId)`; indexes for scoring |
| `job_leases` | distributed leases with fencing tokens | `_id` = lease key |
| `provider_state` | shared provider health, circuit breakers, upstream blocks (all instances) | `_id` = `provider:<id>` / `upstream:<name>` |
| `provider_events` | failover history, provider errors, circuit changes, upstream blocks | TTL 30 days |
| `observed_submissions` | submission ids seen per verified link (when a provider returns ids) | unique `(linkId, submissionId)` |
| `evidence_conflicts` | cross-provider disagreements (never used to award verification) | `studentId`, `at` |
| `rate_buckets` | token buckets: shared `upstream:leetcode-graphql` and per-provider `provider:<id>` | `_id` = bucket key |
| `leetcode_sync_logs` | per-student and per-pass logs | TTL 60 days |
| `settings` | scoring weights (`scoring`), integration controls (`leetcode`) | `_id` |
| `audit_logs` | security-relevant actions | `createdAt`, actor, target |
| `problem_progress` | **schema only, not written.** Progress is computed live from evidence and visibility | |
| `leaderboard_snapshots` | **schema only, not written.** Rank history is not implemented (no invented history) | |

Soft deletion everywhere through status fields. Nothing in the application deletes evidence, enrollments or links.

## 4. LeetCode account ownership

`leetcode_links` statuses: `PENDING_VERIFICATION` → `VERIFIED` → (`REVALIDATION_REQUIRED` → `VERIFIED`) | `SUPERSEDED` | `REVOKED`. "Unlinked" is the absence of an active link.

- Registration creates a pending link with a challenge code `algora-verify-…`.
- Ownership is proven when the provider shows that code in the account's public profile summary (`provider.fetchProfileText`). This needs provider access, so today requests stay pending and `POST /student/leetcode/verify` returns 503 `VERIFICATION_UNAVAILABLE`. Attempts have a 60 s atomic cooldown.
- A username change creates a new pending link. The old link keeps counting until the new one is verified, then becomes `SUPERSEDED`. Changing back creates another new link, so old evidence is never silently restored.
- Two students cannot hold the same normalised username (index). Pending requests older than 14 days stop reserving the name.
- Revalidation (trainer or Super Admin) stops counting until the same link is proven again. Revocation (student or Super Admin) stops counting. Evidence is kept in both cases.
- **Evidence counts only when it belongs to the student's current `VERIFIED` link and comes from a counting source.**

## 5. Evidence

Multi-provider details (adapters, failover rules, budgets, activation): `LEETCODE_PROVIDERS.md`.


`solve_evidence` holds one row per (student, link, slug, source). It is reusable across every batch and course the student is in.

- **Sources:** `AUTOMATED_PROVIDER` (counts), `MOCK_DEV` (counts outside production; writes refused in production), `STUDENT_SELF_REPORT` and `TRAINER_ATTESTATION` (legacy values: nothing writes them, they never count, they are never deleted). `source` and `linkId` are in the unique key, so legacy or mock rows can never block real evidence.
- **Timestamps:** `earliestObservedSolvedAt` and `latestObservedSolvedAt` are the earliest and latest accepted submissions Algora has observed. They are not the first-ever solve. `observedAt[]` lists distinct observed submission times, for date-range reports. `firstVerifiedAt` and `lastVerifiedAt` are when Algora confirmed the row.
- **Writes** are one bulk write per sync, using `$min`/`$max`/`$addToSet`/`$setOnInsert`. They are idempotent and monotonic. A failed or short provider response never removes or downgrades evidence.
- `submissionId` is nullable and never fabricated.

## 6. Synchronization concurrency (MongoDB only, no Redis)

- **Lease:** `acquireLease` makes sure the document exists, then takes it with one conditional update that matches only an expired lease, using the database clock (`$$NOW`). `fence` increases on every acquisition. Renewal (every ttl/3) matches owner, fence and an unexpired lease. A failed renewal marks the lease `lost` and workers stop.
- **Fenced write:** all of a sync's writes (evidence, user sync state, log) run in one transaction. The transaction first updates the lease document, matching owner, fence and an unexpired lease. A worker whose lease expired or was taken over writes nothing, not even inserts. A concurrent takeover conflicts on the lease document, so exactly one side wins. The link is re-checked inside the transaction, so a link changed mid-sync discards the result.
- **One lease per student** (`leetcode-student:<id>`, 90 s), used by manual, tab-return and scheduled syncs alike. No two processes can sync one student at once. Manual syncs do not bypass fencing.
- **One scheduler pass at a time** (`leetcode-sync-pass`, 120 s, renewed).
- **Provider manager:** one eligible provider per sync, strict priority, failover only for provider-specific failures. LeetCode-level restrictions block every provider that depends on LeetCode (`LEETCODE_PROVIDERS.md` §3).
- **Rate limits:** a shared upstream bucket for all providers and instances, plus one bucket per provider. Both are MongoDB buckets updated atomically with DB time.
- **Circuit breakers** are stored in `provider_state`, so every instance sees the same state. A half-open probe is claimed atomically, so only one runs per cluster.
- **Per-student cooldown** (300 s) is claimed with one atomic update. A request refused before reaching the provider (rate limit, open breaker, another worker busy) gives the cooldown back.
- **Circuit breaker** (shared): opens after `LEETCODE_PROVIDER_FAILURE_THRESHOLD` failures; probes after `LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC`, doubling to 15 min. Per-student exponential backoff runs from 60 s to 30 min, with jitter, and honours Retry-After.
- **Pause:** the Super Admin can pause globally. Students see "paused"; nothing is contacted.
- **Crash recovery:** leases expire. A student stuck in `SYNCING` for more than 2 min is rescheduled and shown as failed.
- **Production guard:** with sync enabled, the server refuses to start on MongoDB without transactions.

## 7. Implemented sync schedule (`sync.policy.ts`)

- Bootcamp defaults: 09:30–16:30, Monday to Friday, IST. All intervals except the calendar can be adjusted by the Super Admin within bounds.
- Scheduler ticks every minute (`LEETCODE_SCHEDULER_ENABLED`). It considers students with a verified link enrolled in an ACTIVE batch.
- **In bootcamp hours** (`LEETCODE_BOOTCAMP_HOURS`/`DAYS`/`TZ_OFFSET_MIN`):
  - students active in the last 60 min every 15 min;
  - others every `LEETCODE_SYNC_INTERVAL_MINUTES` (default 60).
- **Outside hours:** students active in the last 24 h every 240 min. Everyone else is not scheduled until they return.
- "Active" means `sync.lastActiveAt`, set by the student dashboard (throttled to 5 min) and by sync requests.
- **Priority:** possible-gap students (resynced after 5 min) first, then active students, then least recently synced. Each pass is capped by the tokens available in the global bucket. Concurrency is `LEETCODE_CONCURRENCY` (3).
- **Student triggers:** the manual button and a tab-return hook. The hook fires on `visibilitychange` after at least 15 s away, only when sync is enabled, the link is verified, the cooldown is over and the provider was not recently down. Returning to the tab is never evidence of a solve.

## 8. Progress, leaderboards, analytics

- **Scope** = distinct active problem slugs in visible chapters of an active batch-course. Hidden chapters leave the denominator and the numerator; evidence is kept.
- **Points:** `EASY×w + MEDIUM×w + HARD×w`, weights from `settings` (Super Admin). Each slug counts once per scope.
- **Batch-course board:** the batch-course scope.
- **Course-wide board:** the intersection of problems visible in every participating batch.
- **Combined batch board:** the union of a batch's active courses, each slug once.
- **Ranking:** competition ranking (1, 1, 3). Ties are ordered by solved count desc, then roll number. Students see no ids or roll numbers. Students with zero points show as "unranked" on the dashboard.
- **Caching:** boards are memoised per instance for 10 s and cleared when a sync on that instance adds evidence.
- **Analytics** are computed per request from evidence and visibility, with filters for college, batch, course, chapter, difficulty, roll number or name, verification status, completion and date range (first verified, or observed submission).
- **CSV exports** cover student, batch, course, chapter and problem reports. They are scoped to the caller, contain no contact data, escape formula injection and are audited.
