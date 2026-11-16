# Algora — Where Logic Grows

Algora is a multi-college DSA bootcamp and course management platform under development. This README is the cumulative implementation record and is updated after every phase.

## Publication policy

**README.md is the only Markdown document published to GitHub.** The repository includes frontend and backend source, tests, package manifests and lockfiles, sanitized environment templates, CI and deployment configuration. Other Markdown documents remain local and ignored. Dependencies, build output, screenshots, real environment files and credentials are excluded.

No credentials, authentication tokens, private keys, personal email addresses or local machine paths belong in this document. Environment variable names and generic localhost examples are documentation only.

## Current status

Phase 9 is the validated handoff baseline. Earlier implementation snapshots and handoff counts are historical records. Earlier login-only visual checks do not establish authenticated Phase 9 browser acceptance.

| Phase | Scope | Implementation and verification |
| --- | --- | --- |
| Phase 1 | Project foundation and branded UI | Implemented; 22 tests passed at handoff; lint, types and builds passed. Real Atlas/browser verification remained blocked. |
| Phase 2 | Google OAuth, sessions, lifecycle and authorization | Implemented; 104 tests passed (67 backend, 37 frontend); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. |
| Phase 3 | Super Admin, colleges and Admin approval | Implemented locally; 196 tests passed (139 backend, 57 frontend); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. Live integration remains blocked. |
| Phase 4 | Student registration, verification, profiles, corrections and permanent QR | Implemented locally; 275 tests passed (200 backend, 75 frontend including separate real API health test); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. Live integration remains blocked. |
| Phase 5 | Course/Batch management, roll-only enrollment and reconciliation | Implemented locally; 368 tests passed (270 backend, 98 frontend including separate live API health); lint, types and production builds passed; both audits reported zero vulnerabilities. Live Google/Atlas verification remains blocked. |
| Phase 6 | Immutable curricula, Learning Days, problem/editorial authoring and Student learning | Implemented locally; 488 tests passed (356 backend, 132 frontend including separate live API health); formatting, lint, types and production builds passed; both audits reported zero vulnerabilities. Live Atlas/Google and authenticated visual verification remain blocked. |
| Phase 7 | QR attendance, durable rosters, finalization, corrections and exports | Implemented and pushed as commit 2894b05; 616 tests passed (445 backend, 171 frontend including separate live API health); both builds/format/lint/types passed and audits found zero vulnerabilities. Live Atlas/Google, authenticated visual and real-camera acceptance remain blocked. |
| Phase 8 | Verified coding progress, complete reports and registration enhancements | Implemented and validated for the Phase 8 delivery commit: 842 distinct tests (620 backend, 222 frontend including local health). Source, tests, lockfiles and sanitized configuration are included. Live provider/database acceptance remains BLOCKED. See the delivery record below. |
| Phase 9 | Operational dashboards, learning analytics and Student follow-up | Implemented locally; 918 distinct tests passed (673 backend, 245 frontend including local health); both builds and checks passed; audits found zero vulnerabilities. Live acceptance remains LIMITED/BLOCKED. Validated for the authorized Phase 9 handoff; see its delivery record. |

Real Google consent/login, Atlas persistence/index creation, deployed cookie transport and authenticated dashboard browser flows remain unverified. The real login entry was visually checked on desktop in light theme and mobile in dark theme. Automated fixtures do not establish a live Google/Atlas integration.

## Contents

- [Phase 1 — Project foundation](#phase-1--project-foundation)
- [Phase 2 — Authentication and authorization](#phase-2--authentication-and-authorization)
- [Phase 3 — Super Admin and college administration](#phase-3--super-admin-and-college-administration)
- [Phase 4 — Student identity, verification and permanent QR](#phase-4--student-identity-verification-and-permanent-qr)
- [Phase 5 — Courses, batches and roll-based enrollment](#phase-5--courses-batches-and-roll-based-enrollment)
- [Phase 6 — Learning Days and immutable curriculum](#phase-6--learning-days-and-immutable-curriculum)
- [Phase 7 — QR-based attendance management](#phase-7--qr-based-attendance-management)
- [Phase 8 — Verified coding progress tracking](#phase-8--verified-coding-progress-tracking)
- [Phase 8 enhancements — Complete reports and registration](#phase-8-enhancements--complete-reports-and-registration)
- [Phase 8 delivery — Validated publication](#phase-8-delivery--validated-publication)
- [Phase 9 — Operational dashboards and learning analytics](#phase-9--operational-dashboards-and-learning-analytics)
- [Current local setup](#current-local-setup)
- [Authentication configuration and contracts](#authentication-configuration-and-contracts)
- [Updating this record](#updating-this-record)

## Repository layout

- `algora-frontend/`: Next.js application, role screens, authentication client and UI tests.
- `algora-backend/`: Express API, MongoDB models, authorization, administration services and tests.
- `.github/workflows/ci.yml`: frontend/backend verification.
- `.env.example` within each application: sanitized configuration templates.

Older phase sections below are historical handoff snapshots. Their references to the former README-only publication policy have been superseded by the publication policy above.

## Phase 1 — Project foundation

This section records the Phase 1 snapshot. Later phases extend its behavior; use the latest phase and current setup sections for today's configuration.

### A. What We Built

Two independent applications in the requested workspace, without nested Git repositories or deployment.

Frontend: responsive branded landing page, accessible navigation and skip link, custom learning-path illustration, honest future-feature descriptions, student and educator entry points, footer with live backend liveness status, disabled Google sign-in with an explicit authentication notice, and three interactive development-only dashboard navigation shells. No fabricated users, metrics, testimonials, or partnerships.

Shared infrastructure: semantic light/dark color tokens, self-hosted Manrope typography, theme toggle, TanStack Query provider, Sonner toast provider, shadcn-style Radix Slot/CVA buttons, cards, badges, skeletons, reusable empty and error states, typed and schema-validated API client, normalized network/API errors, bounded request timeout, environment validation, loading and 404 pages. Inputs, data tables, dialogs and forms were not added because this phase has no data entry or business operations; React Hook Form and its Zod resolver are installed for subsequent phases.

Backend: standalone Express 5, separate application and startup modules, environment validation, reusable Mongoose connection pool and ping, safe database retry logging, Helmet, exact CORS allowlist, 32 KiB JSON limit, generated request IDs, structured Pino request logging, rate limiting, Zod body validation helper, sanitized error and not-found middleware, liveness/readiness endpoints, Railway port binding and shutdown handling.

Developer experience: strict TypeScript, independent npm scripts/environment examples, ESLint, Prettier configuration, root ignores, Node 22 version file, Railway configuration, setup/deployment documentation, and a Node 22 CI workflow. No authentication, registration, accounts, course management, attendance logic or business models are implemented.

### B. Frontend Structure

```text
algora-frontend/
  .env.example
  .prettierignore / AGENTS.md
  components.json
  eslint.config.mjs
  next.config.ts
  package.json / package-lock.json
  postcss.config.mjs
  tsconfig.json / vitest.config.ts
  src/
    app/
      (public)/page.tsx
      (auth)/login/page.tsx
      (student)/
      (admin)/
      (super-admin)/
      preview/[role]/page.tsx
      globals.css / layout.tsx / loading.tsx / error.tsx / not-found.tsx
    components/
      ui/button.tsx / card.tsx / badge.tsx
      layout/header.tsx / dashboard-shell.tsx
      shared/health-indicator.tsx / states.tsx
    config/env.ts / navigation.ts
    features/
    hooks/
    lib/
      api/client.ts
      validations/
      utils/index.ts
    providers/index.tsx
    proxy.ts
    types/
    tests/setup.ts / foundation.test.tsx / preview.test.ts / connectivity.test.ts
```

Empty directories reserve requested boundaries; they contain only `.gitkeep`.

### C. Backend Structure

```text
algora-backend/
  .env.example
  eslint.config.mjs
  package.json / package-lock.json
  railway.json
  tsconfig.json / vitest.config.ts
  src/
    app.ts / server.ts
    config/env.ts / database.ts
    controllers/health.ts
    routes/index.ts
    services/
    models/
    middleware/errors.ts / validate.ts
    validators/
    integrations/
    jobs/
    utils/logger.ts
    tests/app.test.ts
```

### D. Installed Packages

Actual versions from installed lockfiles:

| Frontend package | Version |
| --- | --- |
| Next.js / eslint-config-next | 16.4.6 |
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| Tailwind CSS / PostCSS plugin | 4.3.5 |
| TanStack Query | 5.107.1 |
| React Hook Form / resolvers | 7.92.0 / 5.9.2 |
| Zod | 4.6.7 |
| Lucide React | 0.468.0 |
| next-themes / Sonner | 0.4.6 / 2.0.8 |
| Radix Slot / CVA | 1.5.0 / 0.7.1 |
| clsx / tailwind-merge | 2.1.1 / 3.7.0 |
| Manrope font | 5.3.0 |
| ESLint | 9.39.5 |
| Vitest / jsdom | 5.1.0 / 26.1.0 |
| Testing Library React / jest-dom | 16.3.3 / 6.9.1 |
| Prettier | 3.10.1 |

| Backend package | Version |
| --- | --- |
| Express | 5.3.0 |
| Mongoose | 8.24.8 |
| Zod | 4.6.7 |
| Pino | 9.14.0 |
| Helmet / CORS | 8.3.0 / 2.8.6 |
| express-rate-limit / dotenv | 8.7.4 / 17.4.2 |
| TypeScript / tsx | 5.9.3 / 4.23.15 |
| ESLint / typescript-eslint | 10.14.0 / 8.72.2 |
| Vitest / Supertest | 5.1.0 / 7.3.2 |
| Prettier | 3.10.1 |

shadcn/ui components are source-owned components configured in components.json, rather than a runtime package. Both apps use a scoped minimatch override for vulnerable versions >=7 and <11.0.1. Lint passed with that override; final full audits reported zero vulnerabilities. Vitest was upgraded from 3.2.7 to 5.1.0 to remove critical test-tool advisories. Lockfiles contain the complete resolved graph.

### E. API Endpoints

| Endpoint | Behavior |
| --- | --- |
| GET /api/v1/health | HTTP 200, success=true, service=algora-backend, status=ok; independent of MongoDB. |
| GET /api/v1/ready | HTTP 200 only when MongoDB is connected and ping succeeds; HTTP 503 and NOT_READY otherwise. |
| All unmatched routes | HTTP 404, NOT_FOUND error envelope with request ID. |

Malformed JSON returns 400; oversized JSON returns 413; disallowed browser origins return 403; throttled requests return 429; unexpected errors return sanitized 500 responses. Liveness/readiness are exempt from the general limiter for infrastructure probes. CORS restrictions still apply to health requests with an Origin header.

### F. Environment Variables

Frontend: `NEXT_PUBLIC_API_BASE_URL` (public URL, required for production), `ENABLE_PREVIEW_ROUTES` (server-only, default false, effective only in development).

Backend: `MONGODB_URI` (required secret), `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `LOG_LEVEL`. All are documented in README and `.env.example`; no secret value is included in this report. Configure exact production origins and verified proxy hops when deploying.

### G. Database Connectivity

**BLOCKED:** no Atlas credentials or configured MongoDB service were provided. Database-ready outcomes can be tested with injected dependencies; those tests do not establish a real Atlas connection. An actual configured Atlas connection and successful readiness ping remain required before claiming that acceptance criterion.

### H. Test Results

| App / command | Result |
| --- | --- |
| Backend: npm run lint | PASS |
| Backend: npm run typecheck | PASS |
| Backend: npm test | PASS, 10 tests; required loopback access outside the sandbox. |
| Backend: npm run build | PASS, TypeScript production output. |
| Frontend: npm run lint | PASS after internal links were corrected. |
| Frontend: npm run typecheck | PASS after updating Vitest config. |
| Frontend: npm test | PASS, 8 foundation tests. |
| Frontend: $env:RUN_CONNECTIVITY_TEST='true'; npm test | PASS, 9 tests including the real API-client/backend connection; final preview-boundary suite recorded below. |
| Frontend: $env:NEXT_PUBLIC_API_BASE_URL='http://localhost:5000/api/v1'; npm run build | PASS, production build; final proxy build recorded below. |
| Both: npm audit --json | PASS, zero vulnerabilities in both full dependency graphs. |
| Both: npm run format | Executed; explicit .prettierignore files exclude generated output and dependencies. |
| Backend: $env:MONGODB_URI='mongodb://127.0.0.1:27017/algora'; npm start | Started successfully on port 5000; no local database was available. |
| Frontend: $env:ENABLE_PREVIEW_ROUTES='true'; npm run dev | Started successfully on port 3000. |
| Invoke-RestMethod http://localhost:5000/api/v1/health | HTTP 200 with required service/status response. |
| Invoke-WebRequest http://localhost:5000/api/v1/ready | HTTP 503 with database unavailable. |
| Invoke-WebRequest frontend /, /login, all three known /preview roles | HTTP 200 for each. |
| Invoke-WebRequest frontend /preview/unknown after proxy fix | HTTP 404; student preview remained HTTP 200. |

Initial sandbox npm metadata requests failed with DNS ENOTFOUND; approved installs succeeded. Early compiler attempts ran during incomplete installation and were superseded by passing checks. Initial backend tests hit sandbox loopback EACCES; the approved rerun passed. Frontend tests found a missing jsdom matchMedia mock and obsolete Vitest option, both fixed. A sandbox Next.js build stalled; an approved build passed. An intermediate formatting pass included generated output; explicit ignores were added, frontend generated output was cleared, and a clean build was run. No failed attempt is counted as a passing check.

The browser preview tool timed out during initialization twice. No browser rendering, responsive interaction or dark-mode visual result has been observed.

Final automated verification: frontend `npm run lint`, `npm run typecheck`, clean `npm run build`, and `RUN_CONNECTIVITY_TEST=true npm test` all passed, including **12 frontend tests across 3 files**. Backend lint, type checking, production build and **10 tests** passed. Total: **22 passing tests**, including a real frontend-client-to-backend request. Normal `npm test` skips the optional live connectivity test unless RUN_CONNECTIVITY_TEST=true; CI therefore does not require a running API. Preview tests prove production returns 404 even when the development switch is true.

Final production smoke check: `npm start` launched the built frontend successfully. HTTP requests returned **200** for `/` and `/login`, and **404** for `/preview/student`, `/preview/admin`, and `/preview/super-admin` even with ENABLE_PREVIEW_ROUTES=true. Verification servers were stopped after checks; no background service is required to remain running.

### I. Known Issues

- Atlas connectivity requires user configuration and remains blocked.
- Visual responsive/dark-mode verification requires an available browser session.
- Local execution host is Node 26.13.1/npm 11.20.0; the project recommends Node 22 LTS and CI targets Node 22. CI has not been run remotely.
- Google sign-in is deliberately disabled; production dashboard previews are deliberately unavailable.
- Reverse-proxy hop count must be configured for the actual Railway topology.
- No deployment has been attempted, as requested.
- Frontend ESLint 9.39.5 emits an upstream deprecation warning. It is retained for compatibility with Next.js lint plugins whose peer ranges exclude ESLint 10. The full audit is clean; migrate when compatible plugin versions are available.
- npm reports an unapproved optional esbuild postinstall under this host's install-script policy. Builds/tests executed successfully without changing that policy.

### J. How to Run

From `algora`, use two PowerShell terminals:

```powershell
cd algora-backend
npm ci
Copy-Item .env.example .env
# Configure MONGODB_URI in .env.
npm run dev
```

```powershell
cd algora-frontend
npm ci
Copy-Item .env.example .env.local
# Optionally set ENABLE_PREVIEW_ROUTES=true in .env.local.
npm run dev
```

Open http://localhost:3000. Backend runs on http://localhost:5000. Preview routes: `/preview/student`, `/preview/admin`, `/preview/super-admin` when enabled in development. Shell navigation switches content locally without implementing business operations.

### K. Acceptance Criteria

| # | Acceptance criterion | Status | Evidence / limit |
| --- | --- | --- | --- |
| 1 | Frontend starts locally | PASS | next dev ready; landing/login HTTP 200. |
| 2 | Backend starts locally | PASS | Built server listening on port 5000. |
| 3 | MongoDB works when configured | BLOCKED | No Atlas credentials or available local database. |
| 4 | Health returns 200 | PASS | Real HTTP request and endpoint test. |
| 5 | Readiness reflects connectivity | PASS | Injected ready/unavailable tests; real unavailable database returned 503. Real Atlas-ready state remains blocked under criterion 3. |
| 6 | Frontend communicates with backend | PASS | Actual typed frontend API-client integration test. Browser indicator rendering remains unobserved. |
| 7 | Responsive UI works | BLOCKED | Responsive layouts implemented; browser tool timed out twice. |
| 8 | Light and dark modes work | BLOCKED | Theme infrastructure implemented; browser visual verification unavailable. |
| 9 | TypeScript checks | PASS | Both app checks passed; see section H. |
| 10 | Lint checks | PASS | Both app checks passed; see section H. |
| 11 | Tests | PASS | 10 backend + 12 frontend tests passed, including live connectivity and preview boundaries. |
| 12 | Production builds | PASS | Both final builds passed, including the preview proxy. |
| 13 | No secrets exposed | PASS | No credentials supplied/hardcoded; backend-only URI, ignored environment files, safe logging/errors. Source review, not external penetration testing. |
| 14 | No future-phase business logic | PASS | Preview shells only, no authentication/accounts/course/attendance operations or models. |

### L. Phase 1 Handoff

Phase 1 established the frontend/backend foundation. Its automated checks passed, while real MongoDB connectivity and browser verification remained blocked. Phase 2 has since added authentication; its implementation and verification record follow.

## Phase 2 — Authentication and authorization

This is the historical Phase 2 snapshot. Phase 3 below extends provisioning, approval, college scope and administration.

### A. What We Built

Implemented backend-controlled Google OAuth 2.0/OpenID Connect Authorization Code Flow with S256 PKCE, state and nonce, verified Google identity, canonical accounts, server-side hashed sessions, rotation, expiration, revocation, logout/logout-all, CSRF protection, role/account/registration gates and protected frontend routes. Preserved the Phase 1 apps, design tokens, query/theme/toast infrastructure, health endpoints, logging and error envelopes.

Added a responsive branded login entry with honest availability checking, loading and session-expired messages; session-verified registration-required/pending screens; safe suspended/unauthorized screens; and role workspace shells. No course, college, attendance, approval, student-registration, username-allocation or Super Admin provisioning workflows were added.

No credentials were invented. There is no in-memory production authentication, development impersonation, role selector, or privileged backdoor. No application deployment was performed. At this historical handoff, source and reports were local; source and safe configuration are now included under the current publication policy.

### B. Backend Changes

- `src/models/user.ts`: canonical User schema, enums, immutable subject/username, unique identity indexes and optional unique username.
- `src/models/session.ts`: MongoDB sessions storing token hashes, explicit expiration/revocation/version, TTL and lookup indexes.
- `src/models/oauth-transaction.ts`: short-lived browser-bound OAuth transactions with TTL and unique state hash.
- `src/auth/repository.ts`: production Mongoose repository, atomic subject upserts and single-use transaction consumption, duplicate-key handling, session rotation/revocation and index initialization.
- `src/auth/google.ts`: maintained openid-client integration, lazy discovery, explicit signature verification, fixed Google issuer, verified claims and minimal scopes.
- `src/auth/session-service.ts`: random tokens, SHA-256 storage, CSRF derivation, current-user/version checks and account blocking.
- `src/auth/middleware.ts`: requireAuth, requireRole, requireActiveAccount, requireCompletedRegistration, strict-origin/session-bound CSRF checks and environment-derived cookie policy.
- `src/auth/router.ts`: auth endpoints and sanitized errors/audit events; injectable dependencies for tests only.
- `src/auth/types.ts`, `lifecycle.ts`, `src/utils/usernames.ts`: shared enums/contracts, fixed destination policy, internal lifecycle validation and username utilities without allocation workflows.
- Existing app/config/database/logger modules now mount auth, allow explicit credentialed CORS, validate OAuth settings, gate readiness on required indexes and redact auth-sensitive fields.

New runtime packages: **openid-client 6.8.9**, **cookie 2.0.2**. Existing Express/Mongoose/security infrastructure is retained. No password/JWT issuance library or second auth framework was introduced.

### C. Frontend Changes

- `src/features/auth/provider.tsx`: authentication context/current-user hook using TanStack Query, real login navigation, logout/logout-all, rotation action, cache clearing, focus/periodic revalidation.
- `contracts.ts`: validated public-user contract and fixed role/lifecycle destinations.
- `backend-verification.ts`, `server.ts`: shared no-store Express verification transport, server-only page guards, cookie forwarding restricted to the session cookie, sanitized redirects.
- `route-guard.tsx`: loading/expired/unauthorized client protection without protected-content flashes; supplements server enforcement.
- `login-entry.tsx`: real Google entry enabled only when backend configuration/storage is ready, clear unavailable states and retry action.
- `workspace.tsx`, `account-state.tsx`, `sign-out.tsx`: role shell and lifecycle/error UI with logout actions and responsive styling.
- New pages: `/student`, `/admin`, `/super-admin`, `/registration-required`, `/account-pending`, `/account-suspended`, `/unauthorized`.
- Existing login page was revamped while retaining branding, theme toggle, responsive two-column layout and health indicator.
- `src/proxy.ts`: pre-render Express authorization checks issue HTTP redirects; original development-only preview restrictions remain enforced.
- `next.config.ts`: fixed same-origin `/backend/*` rewrite to Express, with server-only upstream configuration validation.
- API client now includes credentials and no-store, supports CSRF-bootstrapped POST requests and preserves standardized errors.
- Root providers include AuthProvider. CI environment defaults now match the same-origin transport.

New runtime package: **server-only 0.0.1**. No Next.js API auth implementation or browser token storage exists.

### D. Authentication Flow

1. Login requests public auth availability. With missing Google configuration or unavailable MongoDB/indexes, the UI disables sign-in and explains that setup/connectivity is required.
2. Google entry navigates to the frontend `/backend/auth/google` path. Next.js forwards this to Express `/api/v1/auth/google`.
3. Express rejects user-supplied redirect/role parameters, checks configuration/storage, generates library-managed state/nonce/PKCE, stores a ten-minute transaction and sets an opaque HttpOnly browser-binding cookie before redirecting to Google.
4. Google redirects to the exact frontend `/backend/auth/google/callback` URI. Express atomically consumes the matching state+browser transaction with an explicit expiry check, and requires the stored PKCE verifier and nonce.
5. openid-client exchanges the code with PKCE and verifies expected state/nonce, Google issuer, audience, RS256/JWKS signature and token time claims. A verified email and stable subject are required. Tokens are not retained.
6. The repository upserts by Google subject, updating only allowed profile fields. New accounts are STUDENT/PENDING/NOT_STARTED with no username. An email collision with another subject is rejected, never merged.
7. Suspended/archived accounts receive no new session. Otherwise a fresh random session is created, its hash stored, status/version rechecked and any previous browser session revoked. Only an HttpOnly cookie carries the raw token.
8. A fixed server policy redirects active approved/provisioned privileged accounts to their exact role workspace, incomplete students to registration-required, verification/activation-pending accounts to account-pending and blocked accounts to account-suspended.
9. Proxy checks Express before rendering. Server pages independently recheck Express before serializing any own-user profile. Client current-user state and guards hide content during revalidation and handle later expiration/revocation.
10. Logout bootstraps a session-bound CSRF token and sends a credentialed POST with exact Origin. Express revokes the session and clears its cookie. Logout-all increments the user's revocation version and revokes all rows; refresh atomically rotates the opaque token without extending absolute expiry. The frontend clears caches and refreshes routing after successful logout.

### E. Database Models

```text
User
  _id, googleSubject, email, emailVerified, displayName, avatarUrl?
  role: SUPER_ADMIN | ADMIN | STUDENT
  username? (immutable)
  accountStatus: PENDING | ACTIVE | SUSPENDED | ARCHIVED
  registrationStatus: NOT_STARTED | INCOMPLETE | PENDING_VERIFICATION | VERIFIED
  sessionVersion, lastLoginAt, createdAt, updatedAt
  UNIQUE: googleSubject; email
  UNIQUE PARTIAL: username when it is a string

Session
  _id, userId -> User, tokenHash, version, expiresAt, revokedAt?
  createdAt, updatedAt
  UNIQUE: tokenHash
  TTL: expiresAt, expireAfterSeconds=0
  LOOKUP: userId + revokedAt

OAuthTransaction
  _id, stateHash, browserHash, verifier, nonce, expiresAt
  UNIQUE: stateHash
  TTL: expiresAt, expireAfterSeconds=0
```

MongoDB indexes are initialized after connection before auth is marked ready. Sessions and OAuth transactions explicitly check expiry before relying on eventual TTL deletion. A user revocation version closes logout-all/suspension races. Google access/refresh tokens and plaintext session tokens are never stored. The short-lived PKCE verifier/nonce are retained only in the OAuth transaction needed to complete the flow.

Model/index behavior is unit-tested without a live database; actual Atlas index creation, persistence and unique-index enforcement remain unverified until configuration is supplied.

### F. API Endpoints

Base: `/api/v1/auth` on Express, `/backend/auth` through the frontend rewrite. All auth responses set no-store/private caching headers.

| Method/path | Authorization and response |
| --- | --- |
| GET /status | Public; 200 with available/message, false when configuration or storage is unavailable. |
| GET /google | Public, rate-limited; starts real OAuth, sets browser-binding cookie and redirects. 400 custom redirect, 403 foreign initiation, 503 unavailable. |
| GET /google/callback | Valid single-use browser-bound state and verified Google identity required; session cookie plus fixed 303 frontend redirect. Invalid input/identity returns sanitized 400/401; unavailability returns 503. |
| GET /me | Session required; safe own profile and fixed destination. No subject, hashes, tokens, secrets or session version. |
| GET /csrf | Session required; session-bound CSRF bootstrap token. |
| POST /logout | Session, exact Origin and CSRF token required; revokes current session, clears cookie, loggedOut=true. |
| POST /logout-all | Same checks; revokes all user sessions/version and clears cookie. |
| POST /refresh | Same checks; atomic token rotation, rotated=true; absolute expiration preserved. |
| GET /access/student | STUDENT, verified registration, ACTIVE account; authorized=true plus safe own profile only. |
| GET /access/admin | ADMIN and ACTIVE account; no business data. |
| GET /access/super-admin | SUPER_ADMIN and ACTIVE account; no business operations. |

Unauthenticated/expired sessions: 401. Role, account or CSRF denial: 403. Storage failures: sanitized 503. Unknown business/role-change routes: 404. Existing health and readiness endpoints remain; readiness now also requires initialized auth indexes.

### G. Security Implementation

- Backend-controlled code flow using a maintained library, S256 PKCE and nonce; verified signed ID tokens; fixed Google issuer and client audience.
- One-time MongoDB state consumption bound to a random HttpOnly cookie; explicit ten-minute expiration; replay and missing-verifier rejection.
- Stable subject identity, verified email, atomic upserts, unique indexes and refusal to merge identities solely by email.
- Minimum privileges for new accounts. No email/domain-based elevation; Google profile updates cannot overwrite role, lifecycle or username.
- Cryptographically random 256-bit session tokens, SHA-256 database hashes, server-side expiry/revocation/version checks, atomic rotation and fixation protection.
- Production host-only __Host cookies: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Local development uses separate names without Secure for HTTP localhost.
- Same-origin rewrite prevents reliance on third-party cookies across unrelated deployment domains; Express remains authoritative. No SameSite=None workaround or independent Next.js session system.
- CSRF requires exact FRONTEND_URL Origin and a session-bound HMAC token compared in constant time, with cross-site Fetch Metadata rejected. Credentialed CORS has explicit origins and no wildcard. Mutation helpers include credentials and fetch CSRF immediately before use.
- Per-request account/role/registration enforcement, safe fixed redirects, no-store server verification before rendering and periodic current-user revalidation.
- Sanitized API envelopes and safe auth events. Application logs exclude OAuth codes, tokens, cookies, state/verifiers/nonces and client secrets. Deployment/platform access logging must also be reviewed to avoid recording callback query strings.
- Existing Helmet, body limits, request IDs, rate limiting and health behavior retained. Dedicated login limiting is process-local; multi-replica production needs a shared/edge limiter.

No secrets were added to source or public environment variables. The report and existing internal agent/report files remain ignored. Application and fixture tests do not constitute an external penetration test or a guarantee about hosting-provider log retention.

### H. Environment Variables

Backend: MONGODB_URI, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_TTL, CORS_ORIGINS, NODE_ENV, PORT, TRUST_PROXY_HOPS, LOG_LEVEL.

Frontend: NEXT_PUBLIC_API_BASE_URL, BACKEND_API_BASE_URL, ENABLE_PREVIEW_ROUTES.

Only variables actually used by the implementation are documented. Session cookie names/security derive from NODE_ENV; no configurable weak cookie option or unused signing secret was added. Google credentials are optional as an all-or-none group until ready; partially configured OAuth fails startup with safe messages. Production requires HTTPS origins. The callback must exactly equal FRONTEND_URL + `/backend/auth/google/callback`.

Use NEXT_PUBLIC_API_BASE_URL=/backend. Configure the server-only BACKEND_API_BASE_URL to the Express base including `/api/v1`; it is required for production builds. Local development defaults to the existing localhost API. Rebuild when changing the rewrite target. No credential values are included here.

Google Cloud setup and deployment requirements are documented in the authentication setup section below with links to official Google, Next.js and openid-client references. Set up a Web application OAuth client, consent/test audience and exact redirect URI. Keep its secret backend-only. Atlas was not configured or connected during this phase.

### I. Testing Results

The existing Vitest, Testing Library and Supertest infrastructure was extended. Production imports contain no test repositories or fake identity providers. HTTP integration tests use dependency injection; signed RSA JWT fixtures exercise the real OpenID library with controlled transport, including invalid signature, issuer, audience, nonce, expiry, state, missing ID token and unverified email.

Final commands and results:

| Application | Actual command | Result |
| --- | --- | --- |
| Backend | npm run format | Completed. |
| Backend | npm run lint | PASS, exit 0. |
| Backend | npm run typecheck | PASS, exit 0. |
| Backend | npm test | **67 passed across 5 files**, exit 0. Local HTTP sockets required execution outside the sandbox; no Google/Atlas calls. |
| Backend | npm run build | PASS, TypeScript production output, exit 0. |
| Backend | npm audit --json | PASS, zero vulnerabilities. |
| Frontend | npm run format | Completed; generated output/dependencies ignored. |
| Frontend | npm run lint | PASS, exit 0. |
| Frontend | npm run typecheck | PASS, exit 0. |
| Frontend | $env:RUN_CONNECTIVITY_TEST='true'; npm test | **37 passed across 6 files**, exit 0, including the real local backend health request. |
| Frontend | $env:NEXT_PUBLIC_API_BASE_URL='/backend'; $env:BACKEND_API_BASE_URL='http://localhost:5000/api/v1'; npm run build | PASS, final Next.js production build including pre-render Proxy, exit 0. |
| Frontend | npm audit --json | PASS, zero vulnerabilities. |
| Repository | git diff --check | PASS. |

Total: **104 passing tests**. Normal frontend `npm test` skips the optional live health test; the final opt-in run included it. That health request is connectivity verification, not a Google/Atlas authentication test. No mock authentication was served by the local production apps.

Observed verification:

- Backend type checks, lint and production build passed.
- Frontend type checks, lint and production build passed, including pre-render Proxy checks.
- Backend security suites passed, including controlled OAuth callbacks, state/browser/PKCE/replay, canonical identity races/collisions, sessions, logout/all, rotation, suspension, RBAC, lifecycle/username rules, unavailable storage and production cookie policy.
- Frontend tests passed for server refresh/no-store checks, route guard loading/expiry/role rejection, unavailable login, CSRF credentials, logout, production preview restrictions and shared Phase 1 components; additional Proxy tests verify direct-request redirects and revalidation.
- Full dependency audits returned **zero vulnerabilities in both apps**.
- Built backend HTTP: health 200, ready 503, auth/status 200 with available=false, Google entry 503, own-profile and admin access without a cookie 401.
- Built frontend HTTP: login 200, `/backend/health` and `/backend/auth/status` 200; `/student`, `/admin`, `/super-admin`, `/registration-required`, `/account-pending` each returned **307 to /login** without authentication; production preview returned **404**. No protected profile was rendered.
- Early HTTP checks found streamed 200 redirects; the pre-render check was added and the final built HTTP checks returned actual 307 redirects.
- An early Mongoose mapper type error was fixed using explicit inferred document types. Final passing checks supersede that failure. A root-level npm typecheck invocation had no package.json and was rerun in the correct independent application directories.

Live Google OAuth consent/token exchange: **BLOCKED** (no credentials). Real Atlas connection/index persistence: **BLOCKED** (intentionally unconfigured). Browser visual/interaction checks: **BLOCKED** (browser initialization timed out). The optional health request is not evidence of a real authentication login.

### J. Known Issues and Blockers

1. Real Google and Atlas login/session persistence remain blocked by missing configuration. No fake success state was introduced.
2. Actual Vercel-to-Railway Cookie/Set-Cookie forwarding and HTTPS cookie behavior must be verified after deployment. The local health/status rewrite was tested; that is not a full deployed OAuth cookie test.
3. Browser automation timed out; responsive appearance, Google navigation and theme interactions require visual browser verification. Existing responsive tokens/layouts are preserved and new state UI uses them.
4. Invalid OAuth callbacks return sanitized JSON API errors rather than a branded error page; users restart from login. No sensitive callback details are exposed in messages.
5. Login/general limiters are process-local. Deploy with an appropriate shared/edge limiter before scaling to multiple backend replicas. Review trusted proxy hops in the actual topology.
6. Required indexes are created at connection startup. Existing datasets require deliberate index migration/duplicate review; index failure keeps auth unavailable.
7. CI targets Node 22; local checks ran on the provided Node 26.13.1/npm 11.20.0 host. Remote CI was not run. Frontend ESLint 9 retains its previously documented deprecation warning for compatibility with Next.js plugin peer ranges; audit is clean.
8. Host npm policy reports an optional esbuild install script awaiting approval; successful builds/tests did not require altering that policy.
9. There is intentionally no route to approve admins, provision Super Admins, complete registration, assign colleges or allocate usernames in Phase 2.

### K. Files Created or Modified

Created backend files: auth/types.ts, auth/repository.ts, auth/google.ts, auth/session-service.ts, auth/middleware.ts, auth/router.ts, auth/lifecycle.ts; models/user.ts, models/session.ts, models/oauth-transaction.ts; utils/usernames.ts; tests/auth-fixtures.ts, auth.test.ts, repository.test.ts, google.test.ts, cookies.test.ts.

Modified backend files: app.ts, config/env.ts, config/database.ts, utils/logger.ts, .env.example, package.json, package-lock.json.

Created frontend files: features/auth/contracts.ts, provider.tsx, backend-verification.ts, server.ts, route-guard.tsx, login-entry.tsx, workspace.tsx, account-state.tsx, sign-out.tsx; seven role/lifecycle/error pages; tests/auth-server.test.ts, auth-ui.test.tsx, auth-proxy.test.ts.

Modified frontend files: app/(auth)/login/page.tsx, app/globals.css, providers/index.tsx, config/env.ts, lib/api/client.ts, proxy.ts, next.config.ts, tests/preview.test.ts, .env.example, package.json, package-lock.json.

Root: updated README, .gitignore and CI environment; added safe public the authentication setup section below; created this ignored local report. Application source, tests and generic setup documentation contain no actual OAuth credentials, database credentials or local machine paths.

### L. Acceptance Criteria

| # | Requirement | Status | Evidence / limit |
| --- | --- | --- | --- |
| 1 | Google OAuth flow implemented | PASS | Backend code flow and callback integration fixtures. Live Google separately blocked. |
| 2 | State/PKCE validation | PASS | Browser-bound single-use state, stored verifier checks, S256 grant fixtures. |
| 3 | Google identity verification | PASS | Real signed-token library tests for signature, issuer, audience, nonce and time; verified-email validation. |
| 4 | Canonical User model | PASS | Schema/default/index/atomic upsert tests. |
| 5 | Session model | PASS | Token-hash, user link, revocation/version, expiry/TTL indexes. |
| 6 | Secure session management | PASS | Random hashed tokens, expiry/version/revocation checks, rotation and cookie policy tests. Actual browser deployment separately blocked. |
| 7 | Authentication endpoints | PASS | Versioned routes with standardized errors and HTTP tests. |
| 8 | CSRF | PASS | Origin + session-bound token, mutation/client tests. |
| 9 | RBAC middleware | PASS | Exact role, active account and completed-registration checks independent of frontend. |
| 10 | Protected frontend routes | PASS | Express verification before HTTP rendering and again before profile serialization; refresh/role/expiry tests and built HTTP 307 smoke checks. |
| 11 | Login UI functional when configured | BLOCKED | Wired real flow and availability tests pass; real configured login cannot be confirmed without Google/Atlas and browser access. |
| 12 | Logout/revocation | PASS | Current/all-device revocation and atomic rotation integration tests. |
| 13 | Suspended accounts blocked | PASS | Current-account checks and revocation tests; no new login session issued. |
| 14 | Incomplete registration restricted | PASS | Dedicated lifecycle routes and backend student access gating. |
| 15 | Frontend/backend contract consistency | PASS | Schema validation, fixed redirects, credentialed CSRF helpers and transport tests. |
| 16 | Automated tests pass | PASS | 67 backend + 37 frontend = 104 passing tests; see section I. No live MongoDB required. |
| 17 | Production builds pass | PASS | Both production builds executed successfully. |
| 18 | No production mock authentication | PASS | Mocks confined to tests, production uses only MongoDB repository and real OIDC provider. |
| 19 | Integration limitations documented | PASS | This report and the authentication setup section below. |
| 20 | No Phase 3 functionality | PASS | No provisioning, approval, college assignment or registration APIs/workflows. |

### M. Next Phase Readiness

The Phase 2 architecture is implemented with automated authentication/security coverage and successful production builds. Real end-to-end acceptance remains blocked on Google credentials, Atlas and browser/deployed-cookie verification. Keep Phase 3 paused until this report is reviewed; do not infer that mocked/signed-fixture tests establish a live Google/Atlas login. No Phase 3 work has started.

## Phase 3 — Super Admin and college administration

This is the historical Phase 3 handoff snapshot. Phase 4 below implements student registration, independent Student identities, verification, corrections and permanent QR credentials.

### A. What We Built

Implemented the Super Admin administration foundation: secure explicit owner provisioning, college management, identity-bound Admin requests, transactional approval/rejection, permanent name-based Admin usernames, normalized college assignments, backend permission checks, Admin suspension/reactivation, persistent audit models and API-backed administration screens.

Preserved the Phase 1 design and independent applications and the Phase 2 Google OIDC, HttpOnly sessions, CSRF, typed API client, error envelopes and route protection. No additional role, authentication system or production in-memory database was introduced. No student registration, course, batch, enrollment, attendance or progress operations were implemented.

Source, configuration and tests are included in Git under the current publication policy. Other Markdown documents, screenshots, secrets and generated artifacts remain local. No deployment, live provisioning or Atlas configuration was performed in Phase 3.

### B. Backend Architecture

- Models: College, AdminAccessRequest, AdminCollegeAssignment and AuditLog. User gained a single-owner partial unique index and an internal administrative revision used for transaction conflict detection. Existing session/token/identity models remain authoritative.
- `administration/contracts.ts`: permission/status/action allowlists, DTOs, strict Zod mutation/query schemas, canonical ObjectIds, public/own-data projections, pagination contracts and safe unique-conflict errors.
- `administration/repository.ts`: production Mongoose transaction unit with session-bound operations, snapshot reads, majority writes, unique-error translation and index readiness. No business write bypasses the transaction unit.
- `administration/service.ts`: owner provisioning, college lifecycle, requests/review, bounded username allocation, canonical-account promotion, assignment replacement, account status, current college authorization, own scope, metrics and audit reads.
- `administration/middleware.ts`: reusable requireCollegePermission middleware for future scoped operations.
- `administration/router.ts`: versioned session/role/CSRF-protected endpoints, request throttling, safe error mapping and no-store responses.
- `scripts/provision-super-admin.ts`: explicit interactive owner CLI, separate from HTTP startup/routes.
- Database startup initializes required new indexes and includes their readiness. Existing auth repositories continue to use the same canonical User.
- The OAuth transaction may carry a fixed ADMIN_ACCESS intent, validated/stored by the backend; arbitrary redirect URLs remain forbidden.

No new npm dependency was required. Existing Mongoose, Express, Zod, React Hook Form, TanStack Query, Lucide and theme/toast infrastructure are reused.

### C. Frontend Architecture

Protected routes:

- `/super-admin`: real summary counts and recent administrative activity.
- `/super-admin/colleges`: searchable, sortable, status-filtered college table; paginated results; create/edit/details; status and archive confirmation.
- `/super-admin/approvals`: request queue and details; requested-college selection; server-defined permission matrix; shared/private review notes; confirmation before approve/reject.
- `/super-admin/admins`: searchable/filterable Admin list and detail; assignment/permission editing; assignment history; suspend/reactivate confirmations.
- `/super-admin/audit`: action/search/date-filtered, paginated audit table with actor, target, change summary and timestamp.
- `/admin`: own verified account, permanent username, authorized active colleges, permission keys and unavailable-assignment count; no unrelated colleges or fake business metrics.
- `/request-admin-access`: Google-session-verified request form and own history, available without student registration. Verified email is read-only and excluded from mutation bodies. Supports cancellation and shared rejection feedback.

Organized feature modules: administration, super-admin, colleges, admin-requests, admin-management and audit. Reusable shared components include typed tables, pagination, search/status/sort controls, fields, status indicators, query loading/error states, college selection, permission matrix and native modal confirmation dialogs. Forms use React Hook Form/Zod and mutations use the existing CSRF-aware client plus toast feedback/query invalidation.

Next.js Proxy and server pages still verify through Express before protected rendering. An admin-request login intent keeps unauthenticated requesters on the existing Google flow. Registration/account-state screens link to the request workflow. Expired, suspended and unavailable authentication states are distinguished and hide the form.

### D. Super Admin Provisioning

Run only from an authorized interactive backend terminal after real Google/Atlas setup:

```powershell
# Configure PROVISION_SUPER_ADMIN_SUBJECT securely in the operator environment.
npm run provision:super-admin
```

The command requires interactive stdin/stdout and the exact operator phrase `PROVISION SUPER ADMIN`. It does not print the subject, tokens or credentials. It requires an existing verified canonical Google identity selected by stable subject, never email. After confirmation it connects and initializes indexes, then executes provisioning, session invalidation and audit insertion in one transaction.

The resulting account is SUPER_ADMIN/ACTIVE with an immutable `sa-fullname` derived from the verified Google display name. A unique partial User index on role=SUPER_ADMIN covers all lifecycle statuses, preventing a second owner. Zero owners are allowed before intentional initial provisioning; normal APIs cannot delete/demote the owner afterward.

Repeated provisioning of the same valid active owner is a no-op. A different owner, suspended/archived owner, unverified identity, incompatible permanent username, missing subject, missing confirmation or ambiguous database state fails closed. No public registration/provisioning or unrestricted transfer endpoint exists. A separate high-assurance recovery procedure is documented in OWNERSHIP_RECOVERY.md; it requires independent identity verification, multiple authorized operators, backups, a reviewed transactional migration, audit evidence and session invalidation. No recovery/transfer migration was executed or supplied as a bypass.

Positive provisioning behavior is tested through injected transactional repositories; the actual CLI is tested to reject noninteractive execution before database work. Live owner provisioning remains BLOCKED until real configuration is available.

### E. College Management

College stores name, normalized uppercase code, lowercase slug, city/state/country, status, revision, actor references and timestamps. Code, slug and a normalized name/location identity key are unique. Strict Zod schemas enforce allowlists, lengths and formats; ObjectIds normalize case before duplicate-selection checks.

The Super Admin creates, lists, searches, filters, sorts, views, updates and changes status. Updates require expectedRevision to reject stale changes. ACTIVE permits access/request/grant eligibility. INACTIVE blocks new scoped operations/grants. ARCHIVED is terminal through ordinary APIs and preserves records/references. No hard-delete endpoint exists.

Admins receive only currently assigned ACTIVE colleges with college.view permission. Direct foreign-college requests fail 403. Requesters receive only safe active-college directory fields needed to select colleges; private ownership/audit fields are omitted.

### F. Admin Request and Approval Workflow

An authenticated, verified, non-suspended Student can submit full name, one to twenty active college IDs and a 20–2000 character reason, without student registration or roll number. Requester User ID and Google email come from the backend identity. Strict bodies reject supplied roles, emails, requester IDs and permission lists.

A unique partial index allows only one PENDING request per requester. Users view their own history and a global pending indicator, cancel their own pending request idempotently, and see only shared review notes. Rejected/cancelled users may resubmit immediately within the documented limit of three submission attempts per hour. Rejection does not suspend the Student or grant privileges.

Only the Super Admin reviews requests. Approval requires a nonempty subset of requested ACTIVE colleges and allowlisted permission keys including college.view. It updates the existing User by immutable ID/subject relationship, sets ADMIN/ACTIVE, generates the username, stores grants, transitions the request, invalidates sessions and inserts audit events atomically. Student registration status is not falsely completed and is not required for active Admin access.

Privileged usernames use NFKD normalization, combining-mark removal, lowercase ASCII letters, removal of spaces/punctuation/unsupported characters and a maximum 60-letter name base. Names with fewer than two supported letters require human review. Admin collisions allocate the base, then suffixes 2–8 with unique-index-enforced bounded retries of the entire transaction. No sequential AD-0001 identifiers or student usernames are generated. Existing usernames never change with display-name updates.

Concurrent approvals have only one winner; reviewed requests cannot be approved/rejected again. Cancellation/review state is rechecked inside the transaction. Critical failures roll back User changes, username, request state, grants, session revocation and audit writes together. Audit failure never produces an approved account.

### G. Permissions and Authorization

Roles remain SUPER_ADMIN, ADMIN and STUDENT. The server defines college.view, course.manage, batch.manage, student.view, student.enroll, attendance.manage and report.view. Only college viewing is operational now; the other keys reserve future capabilities without implementing those business features.

The reusable scope helper/middleware reloads current account, assignment, required permission and college status. It does not trust browser role/scope headers. Revoked assignments and missing permissions fail immediately on the next authorization check. Super Admin can manage all college records; new scoped operations still require ACTIVE college status.

Admin assignment edits use expectedRevision, preserve revoked history, increment sessionVersion and revoke sessions. Suspension immediately blocks protected Admin actions and invalidates sessions while preserving assignments. Reactivation requires valid current active-college grants and never revives revoked assignments. Ordinary Admin-management endpoints cannot target the Super Admin or perform role elevation.

Actor/target state checks and administrative revision writes inside transactions protect against concurrent privileged changes. Authorization checks are independent of frontend guards. The frontend refetches/clears session state using the existing architecture; already in-flight/read responses are not a substitute for a fresh backend permission check.

### H. Database Models and Indexes

```text
User (extended)
  existing canonical Google identity/role/lifecycle/session fields
  administrativeRevision: internal conflict-detection counter
  UNIQUE PARTIAL { role: 1 } where role=SUPER_ADMIN, across all account statuses
  existing UNIQUE subject/email/optional username indexes retained

College
  name, code, slug, identityKey, city, state, country
  ACTIVE | INACTIVE | ARCHIVED, revision
  createdBy -> User, updatedBy -> User, timestamps
  UNIQUE code; UNIQUE slug; UNIQUE identityKey
  status/name index

AdminAccessRequest
  requesterUserId -> User (immutable), fullName, verified-email snapshot
  requestedCollegeIds -> College[], reason
  PENDING | APPROVED | REJECTED | CANCELLED
  reviewedBy -> User, reviewedAt, shared reviewNote, private internalNote
  UNIQUE PARTIAL requesterUserId where status=PENDING
  status/createdAt and requester/createdAt indexes

AdminCollegeAssignment
  adminUserId -> User, collegeId -> College, permission keys
  ACTIVE | REVOKED, assignedBy/assignedAt, updatedBy, timestamps
  UNIQUE PARTIAL { adminUserId, collegeId } where status=ACTIVE
  adminUserId/status lookup index

AuditLog
  actorUserId -> User, actorName, action, targetType/targetId
  optional collegeId, allowlisted before/after/count/permission metadata
  requestId, immutable createdAt
  time, action/time, actor/time and college/time indexes
```

Critical multi-document writes require a compatible MongoDB replica set/Atlas. The production repository uses Mongoose Connection.transaction with snapshot reads and majority write concern; transaction operations are sequential. Unique username conflicts retry the entire transaction, not an already-aborted transaction. No standalone/nontransactional fallback exists.

Index definitions and driver/session usage are tested without a live database. Actual index creation, persistence, database-enforced concurrent uniqueness and transaction behavior against Atlas remain BLOCKED. Index initialization errors fail readiness for operator review rather than silently dropping constraints.

### I. API Endpoints

Base `/api/v1`, browser prefix `/backend`. Every mutation requires the existing HttpOnly session, exact Origin and CSRF token. Administration JSON uses the standard success/data or sanitized error envelope and no-store caching.

| Method | Path | Authorization / behavior |
| --- | --- | --- |
| GET | /super-admin/overview | Active Super Admin; real counts and recent activity. |
| GET | /super-admin/permissions | Active Super Admin; server permission definitions/current-vs-future labels. |
| POST | /super-admin/colleges | Active Super Admin; validated creation, 201. |
| GET | /super-admin/colleges | Active Super Admin; paginated search/status/sort. |
| GET | /super-admin/colleges/:collegeId | Active Super Admin; details including historical status. |
| PATCH | /super-admin/colleges/:collegeId | Active Super Admin; allowlisted information + expectedRevision. |
| PATCH | /super-admin/colleges/:collegeId/status | Active Super Admin; status + expectedRevision, no archive restoration. |
| GET | /super-admin/admin-requests | Active Super Admin; review queue, search/status/pagination. |
| GET | /super-admin/admin-requests/:requestId | Active Super Admin; full review details and requested colleges. |
| POST | /super-admin/admin-requests/:requestId/approve | Active Super Admin; selected grants/shared/private note, transactional promotion. |
| POST | /super-admin/admin-requests/:requestId/reject | Active Super Admin; shared note at least ten characters. |
| GET | /super-admin/admins | Active Super Admin; Admin-only list, search/status/pagination. |
| GET | /super-admin/admins/:adminId | Active Super Admin; account and assignment history. |
| PATCH | /super-admin/admins/:adminId/assignments | Active Super Admin; replacement grants + expectedRevision; empty list revokes active scope. |
| PATCH | /super-admin/admins/:adminId/status | Active Super Admin; ACTIVE/SUSPENDED + expectedRevision. |
| GET | /super-admin/audit-logs | Active Super Admin; paginated read-only audit, action/date/actor/college/search filters. |
| GET | /admin-access-requests/eligible-colleges | Eligible authenticated Student; safe ACTIVE directory, no registration requirement. |
| POST | /admin-access-requests | Eligible authenticated Student; identity-bound submission, 201. |
| GET | /admin-access-requests/me | Authenticated Student/Admin; own history plus pending indicator, no private review metadata. |
| POST | /admin-access-requests/:requestId/cancel | Owning eligible Student; pending cancellation, idempotent when already cancelled. |
| GET | /admin/me | Active Admin; safe own account. |
| GET | /admin/colleges | Active Admin; current authorized scope only. |
| GET | /admin/colleges/:collegeId | Active Admin with current college.view on ACTIVE college. |

No provisioning, owner transfer, college hard-delete, audit write/update/delete, student registration or course/attendance endpoint exists. Existing health/auth endpoints remain. GET /auth/google accepts only the fixed optional intent=admin-access value; the callback uses stored intent, not browser redirect hints.

Lists accept bounded page/pageSize, escaped search text, allowlisted sort/direction/status. Audit dates use UTC ISO values and a validated range. Invalid input returns 400, unauthenticated/expired session 401, unauthorized scope 403, hidden/missing ownership 404, duplicate/stale state 409, throttling 429 and unavailable storage 503.

### J. Security and Audit Logging

Strict field allowlists, canonical IDs, current session/role/lifecycle checks, backend college scoping, exact-origin CSRF and fixed redirects prevent role/body spoofing, mass assignment, IDOR and arbitrary return URLs. No browser-provided requester identity or unrestricted permission is trusted.

The singleton owner, pending-request and active-assignment invariants have database unique partial indexes. Promotion uses a subject/role/status/version/unset-username guarded update, preventing changes to already assigned usernames. Reviewed-state checks, revision guards and transactions prevent duplicate approvals, stale overwrites and partial privilege changes.

Audit events cover provisioning, college creation/update/status, request submission/cancellation/approval/rejection, role grants, Admin suspension/reactivation, college assignment/revocation and permission updates. Writes are coupled to the relevant transaction. Normal APIs are append-only; actor/action/target/time fields are immutable. College updates record only changed allowlisted field summaries; permissions retain before/after key sets. Credentials, sessions, OAuth data, cookie values, request reasons and private review notes are excluded from audit metadata.

Application logging/error handling remains sanitized. Deployment/database operator permissions and log retention require separate operational controls; normal API append-only behavior is not a claim that a database administrator cannot modify data.

### K. Environment Variables

No new runtime secret is required. Existing backend variables remain: MONGODB_URI, FRONTEND_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_TTL, CORS_ORIGINS, NODE_ENV, PORT, TRUST_PROXY_HOPS and LOG_LEVEL.

CLI-only addition: PROVISION_SUPER_ADMIN_SUBJECT, set explicitly to the independently verified intended existing Google identity. It is not a browser variable, not a runtime authorization allowlist, not hardcoded and not printed.

Frontend variables remain NEXT_PUBLIC_API_BASE_URL=/backend, server-only BACKEND_API_BASE_URL and optional development-only ENABLE_PREVIEW_ROUTES. No role, Google secret or database credential is placed in NEXT_PUBLIC configuration.

Both .env.example files/local operational documentation retain generic configuration only. No real credential was requested or supplied. Real Google/Atlas connection and live owner provisioning were not attempted.

### L. Testing Results

Final validation: **196 tests passed: 139 backend tests across 9 files and 57 frontend tests across 8 files.** The frontend run included the optional live backend-health check.

Both applications passed npm run lint, npm run typecheck, npm test and npm run build. Formatting completed successfully. Frontend production build used the same-origin /backend transport and a localhost backend upstream. Both npm audit checks reported zero vulnerabilities. These checks establish local code/build behavior, not live Google or Atlas integration.

Automated backend coverage includes confirmed/idempotent/competing provisioning; missing/unverified/different/archived owner rejection; database index definitions; normalized IDs/code/slug; duplicates, stale updates and archive restrictions; incomplete-student requests, cancellation/IDOR, duplicate pending requests, throttling and shared-note projections; existing-user promotion; username collisions/bounded exhaustion/permanence; competing approvals and full rollback; assignment/permission scope; suspension/reactivation and session invalidation; no public provisioning/audit mutation endpoints; safe unavailable storage; real transaction/session call contracts; and noninteractive CLI rejection without printing the subject.

Frontend coverage includes protected direct routes, incomplete-student access intent, loading/error states without fabricated counts, real API-shaped metrics/scope, request validation and identity-safe JSON/CSRF, pending/cancellation/rejection states, approval/rejection confirmations, permission grants, college form validation/pagination and admin suspension revisions. Existing Phase 1/2 OIDC signature/session/CSRF/route tests remain in the suites. Fixtures are confined to automated tests; production servers did not serve mocked identities/data.

Built HTTP smoke checks observed:

- Backend health 200; readiness 503 with local database unavailable; auth/status 200 with available=false.
- Unauthenticated overview, colleges, requests, audit, eligible directory and Admin scope APIs each returned 401 without data.
- Super Admin root/colleges/approvals/admins/audit and Admin page returned 307 to login.
- /request-admin-access returned 307 to /login?intent=admin-access; login with that intent returned 200.
- Production preview returned 404.

Browser verification succeeded for the real login/admin-request entry: desktop light and 390×844 mobile dark layouts, disabled Google action while unconfigured, clear availability text and real Backend connected status. Theme appearance and viewport were restored afterward. Screenshots are retained locally. Authenticated dashboard visual/end-to-end flows remain BLOCKED because no real Google/Atlas account/session is configured; no role backdoor was used for screenshots.

Initial checks found mapper/session TypeScript issues and three fixture/validation assumptions, all corrected. A rate-limit test timed out under simultaneous heavy checks; it now reuses one HTTP server with a bounded 15-second test budget. A later review normalized ObjectId case before duplicate selection validation and distinguished unavailable/suspended/expired request-page authentication states. Final results supersede earlier failures; no unexecuted live integration is counted as passing.

### M. Known Issues and Blockers

- BLOCKED: real Atlas connection, persistence/index creation, multi-document transaction/concurrency behavior and audit durability. These are intentionally unconfigured, not replaced with fake production behavior.
- BLOCKED: actual Google login, live Super Admin provisioning, deployed Vercel/Railway cookie transport and authenticated browser E2E/visual flows.
- Browser login/intent/light/dark/mobile checks passed locally; this does not establish authenticated dashboard layout or keyboard interaction in a real session.
- Privileged names with insufficient supported ASCII letters require reviewed transliteration/name input. Username retries are bounded to eight candidates. A future student-to-Admin transition after a permanent student username exists needs a separately reviewed username policy; current approval refuses incompatible existing usernames instead of silently renaming them.
- Admin-management ordinary transitions cover ACTIVE/SUSPENDED; owner recovery/transfer and ambiguous legacy account states require separate high-assurance operations. No unrestricted recovery command is supplied.
- General/login/submission limiters remain process-local. A multi-replica rollout requires shared/edge rate limiting and verified proxy configuration.
- Startup index creation must be reviewed against existing production data. Duplicate legacy identities/owners/colleges/assignments prevent readiness until resolved through authorized migration.
- Local validation uses the provided Node 26.13.1/npm 11.20.0 host; project guidance/CI remains Node 22 LTS. Remote CI was not executed. Existing ESLint/plugin compatibility and optional esbuild install-policy warnings are unchanged; no dependency was added in Phase 3.
- Normal API audit immutability is not database-administrator tamper resistance; use appropriate production database roles/backups/retention.

### N. Files Created or Modified

Backend additions: administration/contracts.ts, repository.ts, service.ts, middleware.ts and router.ts; models/college.ts, admin-access-request.ts, admin-college-assignment.ts and audit-log.ts; scripts/provision-super-admin.ts; tests/administration-fixtures.ts, administration.test.ts, administration-http.test.ts, administration-repository.test.ts and provision-command.test.ts.

Backend changes: User singleton/administrative revision/username validation; auth transaction intent types/model/repository/router; username validation utility; app route mounting; database/index readiness; provisioning npm script/env example; existing auth tests and rate-limit harness.

Frontend additions: shared admin-ui components; administration-shell layout; administration contracts/queries/styles; super-admin overview/section; college management/selection; Admin request/review modules; Admin management/own-scope modules; audit viewer; request-access and four Super Admin subpages; administration UI/routing tests.

Frontend changes: Super Admin/Admin overview pages; protected request-route policy; login intent/provider; account-state entry link; API JSON/PATCH mutations; root CSS import; dialog test polyfills. Local documentation: ADMINISTRATION.md and OWNERSHIP_RECOVERY.md. The cumulative README gains Phase 3 while preserving prior phase records. This report and screenshot artifacts remain ignored/local.

### O. Acceptance Criteria

| # | Requirement | Status | Evidence / qualification |
| --- | --- | --- | --- |
| 1 | Secure Super Admin provisioning | PASS | Explicit interactive CLI; existing verified subject, confirmation and audit/rollback tests. Live provisioning blocked. |
| 2 | Single-Super-Admin invariant | PASS | Unique partial role index across statuses; idempotent/competing/different-owner tests. Zero before intentional bootstrap; live index execution blocked. |
| 3 | College model/management APIs | PASS | Schema, unique normalization and protected CRUD/status APIs; no hard delete. |
| 4 | College management UI against API | PASS | Typed client integration tests for list, pagination, forms and commands. Live authenticated browser/Atlas use blocked. |
| 5 | Admin request model/APIs | PASS | Identity-bound request and state lifecycle with pending uniqueness. |
| 6 | Admin request UI | PASS | Real endpoint wiring, selection, validation, status/history/cancellation tests. |
| 7 | Incomplete students can request | PASS | Service, HTTP, form and pre-render policy tests; no roll number required. |
| 8 | Owner approve/reject | PASS | Backend authorization, review UI/confirmation and transaction tests. |
| 9 | Approval updates existing User | PASS | ID/subject-bound guarded promotion; no duplicate User; session invalidation test. |
| 10 | ad-fullname usernames | PASS | Name normalization and role prefix with permanent assignment. |
| 11 | Safe username collisions | PASS | Global unique index and bounded whole-transaction suffix retries; exhaustion test. |
| 12 | College assignments stored | PASS | Real MongoDB relationship/repository, active uniqueness and mocked transactional tests. Live persistence blocked. |
| 13 | Backend permissions | PASS | Current account/grant/permission/college checks; cross-college/missing/revoked/forged-role tests. |
| 14 | Admin suspension/reactivation | PASS | Owner-only transitions, valid-scope reactivation, no revoked access restoration. |
| 15 | Session invalidation | PASS | Version increment + session revocation coupled to privileged changes; stale-cookie tests. |
| 16 | Persistent critical audit | PASS | MongoDB AuditLog inserts share critical transaction; failed audit rolls back changes. Actual Atlas durability blocked. |
| 17 | Super Admin dashboard | PASS | Real metrics/query states plus colleges, approvals, management and audit screens; no fake metrics. |
| 18 | Admin authorized scope | PASS | Own account, active permitted colleges/permissions only; unauthorized records omitted. |
| 19 | Consistent contracts | PASS | Zod schemas, strict bodies, normalized IDs, revisions and typed mutation/DTO tests. |
| 20 | Security tests | PASS | Backend/frontend security suites; live configuration limitations separately recorded. |
| 21 | Lint/types/tests/builds | PASS | Both applications passed; 196 tests passed. See section L. |
| 22 | No production fake success | PASS | Real MongoDB/OIDC defaults; test-only fixtures; unavailable health/auth/admin checks. |
| 23 | No Phase 4 functionality | PASS | No student registration, courses, batches, enrollment, attendance or progress operations. |

### P. Next Phase Readiness

Phase 3 is implemented, locally validated and ready for review. Google/Atlas/deployment and authenticated visual checks remain launch gates, as allowed by this phase's database constraint. Review the permanent-student-username/role-transition policy before introducing Phase 4 username allocation. No Phase 4 work has started, and no later phase will begin without a new implementation request. The implementation is published as source under the current policy; no deployment or live provisioning was performed.

## Phase 4 — Student identity, verification and permanent QR

This is the historical Phase 4 handoff snapshot. Phase 5 below adds Course/Batch delivery, enrollment and durable eligibility reconciliation.

### A. What We Built

Implemented mandatory Student registration, independent permanent Student identities, globally reserved roll numbers, institutional verification, own-profile editing, reviewed identity corrections, encrypted permanent QR credentials, scoped Admin student review and global Super Admin student management. Preserved the canonical Google User, existing OIDC/HttpOnly sessions/CSRF, Phase 3 administrative usernames and approval workflow, college assignments and audit infrastructure.

The UI uses real APIs and explicit loading/error/unavailable states. MongoDB and Google remain intentionally unconfigured. Test fixtures are confined to test files. No production in-memory identity store, fake success, impersonation route, enrollment, course, batch, attendance scanning or progress tracking was introduced. No Phase 5 work, commit, push or deployment was performed during this implementation.

### B. Backend Architecture

- `students/contracts.ts`: strict Zod registration/contact/correction/review/rotation/query schemas, DTOs, repository interfaces, department suggestions, safe projections and permanent username generation.
- `students/repository.ts`: Mongoose unit of work sharing its MongoDB ClientSession with the existing MongoAdminUnit; snapshot/majority transactions, explicit index initialization, profile revisions, permanent roll reservations, encrypted credential replacement and pending-request state checks.
- `students/service.ts`: current-account authorization, transactional registration, active-college guards, college/permission scopes, verification, correction review, safe own-profile access and audited credential issuance/rotation.
- `students/crypto.ts`: 256-bit opaque randomness, SHA-256 lookup hashing and AES-256-GCM credential vault with key IDs, random nonces and authenticated identity/version binding.
- `students/router.ts`: session/role/CSRF enforcement, allowlisted request bodies and queries, pagination, per-user attempt limits, no-store headers and standardized safe responses.
- Four Mongoose models: StudentProfile, StudentRollReservation, StudentQrCredential and StudentProfileCorrectionRequest.
- Existing app/database/readiness, permission definitions, audit model/actions, auth destinations and explicit provisioning CLI extended without replacing authentication. The provisioning CLI now loads database/model infrastructure only after interactive confirmation.

### C. Frontend Architecture

Added protected dynamic pages `/student/register`, `/student/profile`, `/student/my-qr`, `/admin/students` and `/super-admin/students`.

`features/students` contains typed schemas, responsive student shell, RHF/Zod registration and profile forms, review/confirmation steps, debounced roll availability, private QR rendering/download/rotation, paginated profile correction history, student directories and reviewer dialogs. Shared data tables, status pills, native accessible dialogs, query/error states and CSRF API mutation transport are reused. Administration navigation includes Students; verified Student workspace links to working Profile/My QR pages rather than placeholder actions.

Proxy and server page guards allow incomplete Students to register and registered/pending Students to view profile and QR. Verified workspace access remains guarded by backend registration verification. Fixed safe destinations preserve Admin/Super Admin workspaces and the incomplete-Student Admin-access request flow. No browser role flag grants access.

### D. Student Registration

All ten requested fields are mandatory: full name, roll number, verified Google email, phone, canonical active college, department, year 1–4 and all three coding handles. Email is read-only in the UI and obtained only from the current backend Google User; it is rejected as a registration body field. Registered fullName is separate from Google displayName.

Names normalize Unicode and whitespace, permit legitimate international name letters/marks and bounded punctuation, and reject invalid content. Phone validation uses the maximum metadata from [libphonenumber-js](https://www.npmjs.com/package/libphonenumber-js), requires explicit +country code, rejects extensions and stores E.164. There is no OTP or phone ownership claim.

College selection is API-backed, paginated/searchable and limited to existing ACTIVE college IDs. Suggested engineering departments include common and broader disciplines; a validated free-text department supports legitimate programs outside the suggestions. Academic year is a numeric study year, not graduation year.

Coding handles use bounded ASCII platform-specific character allowlists. LeetCode and Codeforces input casing is retained; CodeChef handles are lowercased. External APIs and ownership verification are not required or claimed.

Registration creates one profile, records PENDING_VERIFICATION, activates an eligible pending Student account, preserves Google identity/name and keeps institutional verification separate from successful form submission. When QR encryption is unavailable, registration still succeeds with an explicitly unissued QR; QR actions fail safely until configured.

### E. Roll Number Rules

Input is trimmed, checked for exactly ten ASCII A–Z/a–z/0–9 characters before conversion, then uppercased and validated against `^[A-Z0-9]{10}$`. Checking ASCII before uppercasing prevents Unicode characters such as long-s from turning into accepted letters. Internal spaces, punctuation, Unicode lookalikes and incorrect lengths are rejected without padding or truncation.

StudentProfile has a global unique rollNumber index, independent of college. StudentRollReservation has another global unique rollNumber index and permanently binds every claimed current or historical roll number to its original profile. Registration and corrections reserve rolls inside the same transaction as profile/account/audit writes. Unique-index races fail safely and roll back; frontend availability is advisory, owner-free and never the final authority.

No archive, withdrawal or deletion operation recycles a roll number. A former roll may be restored only to the same identity through reviewed correction; another identity cannot claim it. There is no public roll-reservation deletion endpoint.

### F. Username and Identity Architecture

Canonical User remains the single Google-subject account and retains the existing role, lifecycle, session and administrative username compatibility. StudentProfile has a unique userId relationship and independent immutable studentUsername. A Student registration does not populate User.username.

Student username format is lowercased roll number plus a safe hyphenated normalized name, for example `23a91a05b2-varun-manchikanti`. Latin diacritics are decomposed; unsupported characters become separators; the bounded name slug is capped at 65 characters. Entirely non-Latin names retain their full registered name while using the deterministic safe `student` suffix. Username maximum length is 80 and uniqueness is indexed globally. The roll prefix also keeps Student/Admin/Super Admin namespaces disjoint.

Phase 3 promotion allocates `ad-...` only into the still-empty administrative User.username, preserving StudentProfile/studentUsername/history/QR unchanged. One canonical Google User remains. Regression coverage registers a Student, requests Admin access and explicitly approves that same User. Existing administrative usernames are not renamed or migrated.

Single-role authorization intentionally remains: an approved ADMIN enters `/admin` and cannot simultaneously use Student workspace APIs. Their StudentProfile and credential remain retained for history/future policy. There is no automatic privilege elevation or public role assignment.

Migration contract: Phases 1–3 did not create student registrations, so no StudentProfile backfill is expected for this project. Unexpected legacy STUDENT User.username values require a reviewed, backed-up migration that copies the permanent value into a validated StudentProfile, checks all identity/roll/username collisions, preserves history, creates reservations, then removes the legacy administrative slot only under an audited operator procedure. Registration fails closed for such a legacy value; no silent destructive migration is shipped or executed. Existing synthetic VERIFIED User flags without profiles must likewise be reconciled before launch. Deploying new model indexes against real legacy data remains a live integration gate.

### G. Student Verification

Added `student.verify`, granted only through Super Admin-controlled existing assignment APIs. Grant validation requires `college.view` and `student.view`; selecting verify in the UI includes view, and removing view removes verify. Existing grants do not gain this permission automatically.

Admin directory/detail access requires current ACTIVE assignment, ACTIVE college and student.view. Verification and correction review additionally require student.verify. Mutations reload/lock the current reviewer and subject User, enforce profile revisions and lock the active College document in the same transaction. Suspension, assignment changes and college deactivation therefore conflict safely with concurrent privileged writes. Super Admin can inspect the global directory, including inactive-college details, while verification/correction mutations still require an ACTIVE college.

Verification supports explicit AUTHORIZED_MANUAL evidence review with a required bounded reason/evidence reference and true confirmation. Only authorized verification reviewers see the private evidence reference; Student and ordinary viewer projections omit it. Do not put document contents, credentials or sensitive document numbers into evidence references. No trusted roster exists or is imported in this phase, so no roster-match option or claim is offered.

Profile states are PENDING_VERIFICATION, VERIFIED and REJECTED. User.registrationStatus is the compatibility mirror used by existing verified workspace gates; REJECTED maps to its pending verification state, while the profile preserves the explicit rejection/feedback. Verification is never automatic, a verified identity cannot simply be overwritten by another verification, and material corrections reset the mirror and profile for reverification. Reviewers cannot verify or approve/reject corrections to their own retained Student identity; a separate authorized reviewer is required. These states grant no enrollment or arbitrary batch access.

### H. Permanent QR System

QR payload is only a random 32-byte base64url credential (256 bits), not a URL, database ID, name, roll, email, phone, college, or session. The lookup/indexing field holds a SHA-256 hash. Re-display material is stored as AES-256-GCM ciphertext plus random 12-byte nonce, authentication tag and keyId. Associated authenticated data binds profile ID, credential version and key ID. Plaintext is never stored in MongoDB or audit/log metadata.

One unique credential row per profile and one unique lookup hash exist. Logins and contact/identity edits do not issue or replace it. Own QR GET decrypts only for the authenticated Student. There is no administrative credential-read endpoint or public token-resolution URL. Sensitive responses set private/no-store, Pragma no-cache and no-referrer headers.

The client fetches credential material only after explicit Display QR. It lives in the display component's transient operation, not TanStack Query, persistent browser storage, SSR HTML, navigation URL or analytics. [qrcode](https://www.npmjs.com/package/qrcode) renders only the opaque payload to a local PNG data URL; displayed name/college/verification are outside the QR. The student may explicitly download that credential image. Hide, rotation, unmount/session invalidation and stale-response guards prevent retaining an old displayed image in application state. Keep downloaded copies private.

Rotation requires a Student session, exact Origin/CSRF, true confirmation and the expected credential version. Five attempts/hour per user are allowed. One transaction advances profile revision and QR version, replaces hash/encrypted material, and appends audit; competing rotations using the same old version cannot both succeed. The old lookup hash disappears immediately on commit. No attendance scanner or enrollment resolver is introduced.

Key lifecycle: configure a backend-only keyring and active key ID; retain older keys while their ciphertext is still used. To change wrapping keys without changing QR payloads, use an independently reviewed maintenance migration that authenticates/decrypts each old record, re-encrypts the SAME token with a fresh nonce/new AAD key ID, preserves hash/version and verifies counts/integrity under CAS/transactions before retiring keys. No such migration runs automatically. Maintain access-controlled key backups separately from database backups. Lost keys cannot recover plaintext from hashes; after establishing trusted identity, use explicit QR replacement with a new available active key, invalidating all old copies. A compromised wrapping key requires incident review and credential replacement, not merely changing the key label. No production key was generated, requested or supplied here.

### I. Profile and Correction Workflow

Own profile shows registered name, roll, permanent username, trusted Google email, normalized phone, college, department, year, all coding handles and verification status/method/timestamp/feedback.

Direct PATCH accepts only all contact/coding fields plus expectedRevision. It rejects name/roll/college/year/department/email/userId/role/status/username mass assignment. Successful changes are audited without placing contact values into audit logs.

Protected changes require an identity-bound correction with a reason and current profile revision. One pending request per profile is a deliberately stronger restriction than duplicate requests per field. Students see their own history and can cancel only their own pending request. Cancellation is idempotent; already-reviewed approvals/rejections cannot be replayed.

Reviewers inspect current profile and requested values, supply a shared note, confirm, and submit the current expectedRevision. A profile changed since form review causes conflict. Request profileRevision is retained as historical context; re-review against the latest explicit revision is allowed. Approval reserves any new roll, changes only allowlisted protected fields, preserves permanent username/QR, clears previous verification metadata and resets verification in one transaction. Audit includes changed identity before/after summaries and review events, without QR/evidence secrets. College transfer approvals require Super Admin, preventing one college's Admin from assigning identity into another college.

### J. Database Models and Indexes

| Model | Identity/relationships | Important indexes and guards |
| --- | --- | --- |
| StudentProfile | Canonical User + College; registered fields; verification; QR version; revision/timestamps | UNIQUE userId, rollNumber, studentUsername; collegeId+verificationStatus; collegeId+rollNumber; immutable userId/studentUsername; revision compare-and-set |
| StudentRollReservation | Immutable normalized roll + profile binding | UNIQUE rollNumber across current/historical identities; no public delete/update |
| StudentQrCredential | Immutable profile relationship; version; hash; authenticated ciphertext/nonce/tag/keyId | UNIQUE profileId; UNIQUE tokenHash; no plaintext; one active row replaced transactionally |
| StudentProfileCorrectionRequest | Profile/User/source College; immutable requested changes/reason/submission revision; status/reviewer/note/timestamps | UNIQUE profile with partial status=PENDING; sourceCollegeId+status+createdAt; requesterUserId+createdAt; pending-only review CAS |
| Existing User / College / AuditLog | Single-role compatibility; operational college write guard; append-only administrative audit | Existing identity/privilege indexes retained; permission enum and STUDENT_PROFILE audit target/actions extended |

All student/profile/reservation/credential/account/audit writes share one MongoDB transaction and ClientSession, with snapshot read concern and majority write concern. Active-college guards increment operationalRevision rather than editing human-facing details. No transactionless fallback exists. Replica-set/Atlas transactions and actual unique index creation remain unverified locally; explicit readiness gates require student indexes to initialize successfully.

### K. API Endpoints

All paths are under `/api/v1` on Express; browser paths use the existing `/backend` transport. All mutations require exact Origin and session-bound CSRF. Sensitive responses are non-cacheable. Pagination is bounded to 50 records/page and supports escaped literal search/allowlisted filters.

| Method | Path | Authority and behavior |
| --- | --- | --- |
| GET | /students/registration-options | Authenticated nonsuspended Student, including incomplete; active college directory and department suggestions |
| POST | /students/register | Same Student, mandatory fields/confirmation; transactional unique registration; 10 attempts/hour |
| GET | /students/roll-number-availability | Same Student; exact normalized roll, owner-free available flag; 120 requests/hour |
| GET | /students/me | Student's own profile, trusted email, college and vault availability |
| PATCH | /students/me | Student's own contact/coding fields; revision guard; 30 attempts/hour |
| GET | /students/me/correction-requests | Student's own paginated history |
| POST | /students/me/correction-requests | Student's own protected correction; reason/revision; 10 attempts/hour |
| POST | /students/me/correction-requests/:requestId/cancel | Student's own pending request; idempotent cancellation |
| GET | /students/me/qr | Student's own credential only; explicit component fetch; 120 requests/hour |
| POST | /students/me/qr/rotate | Student's own issue/rotate; confirmation/version; 5 attempts/hour |
| GET | /admin/students | ACTIVE Admin; active assigned colleges with student.view; paginated directory |
| GET | /admin/students/:studentId | Same scoped view; canVerify flag; evidence only with verification authority |
| POST | /admin/students/:studentId/verify | Active scoped student.verify; manual evidence/confirmation/revision |
| POST | /admin/students/:studentId/reject-verification | Same authority; shared reason/confirmation/revision |
| GET | /admin/student-correction-requests | Active assigned student.verify colleges; paginated review queue/history |
| POST | /admin/student-correction-requests/:requestId/approve | Same authority, pending request/revision/confirmation; no cross-college transfer approval |
| POST | /admin/student-correction-requests/:requestId/reject | Same authority, pending request/shared reason/revision/confirmation |
| GET | /super-admin/students | ACTIVE Super Admin; global paginated/search/college/status directory |
| GET | /super-admin/students/:studentId | ACTIVE Super Admin; global detail; inactive colleges viewable, not verifiable |
| POST | /super-admin/students/:studentId/verify | ACTIVE Super Admin and ACTIVE student college; manual evidence/revision/confirmation |
| POST | /super-admin/students/:studentId/reject-verification | Same authority; reason/revision/confirmation |
| GET | /super-admin/student-correction-requests | ACTIVE Super Admin global correction queue/history |
| POST | /super-admin/student-correction-requests/:requestId/approve | ACTIVE Super Admin; active source/destination colleges; transactional review including transfers |
| POST | /super-admin/student-correction-requests/:requestId/reject | ACTIVE Super Admin; audited shared rejection |

Existing auth `/me` destinations now return `/student/register`, `/student/profile`, or `/student` as appropriate. Old registration-required direct links redirect through the authoritative policy. Existing Phase 3 APIs remain available; the permission-definition endpoint now marks student.view/student.verify as implemented.

### L. Security Implementation

Backend User/session identity is authoritative. Strict bodies/queries reject browser-supplied identity, email, roles, permissions, verification flags and protected-field edits. Student APIs expose only self; Admin queries/details/reviews enforce current active college grants and permissions; Super Admin remains an explicit separate role. Account and assignment/college changes are rechecked inside mutation transactions. No QR endpoint accepts a target student ID.

Unique profile/roll/username indexes plus permanent reservations handle concurrent registrations and prevent cross-college duplication/reuse. Revision/version/pending-state CAS, same-session writes, audit atomicity and user/college write guards prevent stale/concurrent privileged approvals or rotations. CSRF, session fixation defense, hashed backend sessions, suspension checks, and Google subject identity binding remain intact.

QR values never appear in request URLs, application logs, audit records or stored plaintext. Error translation hides driver/key values and infrastructure diagnostics. Owner-free rate-limited availability limits enumeration. Rate limiters are process-local; a distributed limiter is required before horizontal scaling. Normal database access controls, backups, key management and prevention of external platform response-body logging remain operator responsibilities. Audit APIs are append-only, not a claim that a database administrator cannot alter storage.

### M. Environment Variables

Existing backend MongoDB, Google OAuth, exact frontend/CORS origins, session and proxy settings remain unchanged; frontend keeps the same-origin `/backend` configuration. No new public environment secret exists.

- `QR_ACTIVE_KEY_ID`: backend-only identifier of the current encryption key; ASCII letters/digits/underscore/hyphen, 1–40 characters.
- `QR_ENCRYPTION_KEYS`: backend-only JSON object mapping key IDs to base64-encoded 32-byte encryption keys. Values must be generated securely and stored in backend secrets, never in Git/browser/chat/logs. Previous keys are retained until their ciphertext is migrated safely.
- Missing/invalid active configuration leaves registration/profile available but QR issuance unavailable. Retrieval also requires the matching retained decryption key and valid authenticated ciphertext. No dummy/default key or plaintext fallback exists.

Sanitized `.env.example` documents only names/contracts. No Google credentials, Atlas credentials, QR key or identity subject was requested or included.

### N. Testing Results

Final application checks passed locally on Node 26.13.1.

| Check | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS | PASS |
| npm run lint | PASS | PASS |
| npm run typecheck | PASS | PASS |
| npm test -- --maxWorkers=2 | 200 passed, 12 files | 74 passed, 9 files; optional live-health file initially skipped |
| npm run build | PASS (TypeScript) | PASS (Next.js production build; all five new routes dynamic/protected) |
| npm audit | Zero vulnerabilities | Zero vulnerabilities |

The opt-in real API health test was then explicitly executed with RUN_CONNECTIVITY_TEST=true using npm test -- src/tests/connectivity.test.ts: 1 passed. Across the full suites and this separate optional run, **275 distinct tests passed: 200 backend and 75 frontend**. This confirms local HTTP health transport, not Google login or database persistence.

The frontend build used NEXT_PUBLIC_API_BASE_URL=/backend and a localhost BACKEND_API_BASE_URL. No production secret was required or embedded. Remote Node 22 CI was not executed.

Backend tests cover all mandatory fields; exact ASCII roll normalization and rejection cases; international phones; username bounds/fallback; duplicate/current-user/concurrent/cross-college registration; transaction rollback; inactive colleges; unregistered Admin requests; registered Student to explicit Admin approval preserving one User/student identity; scope/permission/suspension; manual evidence validation; competing verification; contact/protected separation; correction duplication/IDOR/cancellation/roll uniqueness/concurrent review/transfers/reverification; stable opaque encrypted QR, missing key, tamper detection, rotation conflicts, old lookup invalidation and audit rollback; API session/CSRF/mass assignment/no-store/safe errors; schema indexes; and real MongoDB method contracts for sessions, revisions, metadata clearing, reservations and credential replacement.

Frontend tests cover mandatory/roll validation, read-only email, review/confirmation and identity-safe registration payloads, honest unavailable behavior, profile/pending-verification status, explicit-only QR fetch, opaque-only encoding, PNG download, hide/rotation clearing, Admin/Super Admin API-backed directories, route integration, wrong-role restrictions and fail-closed authority/session errors. Existing Phase 1–3 suites remain in place with expected registration destination updates.

Initial runs found historical redirect expectations and a noninteractive provisioning subprocess timeout. Redirect expectations were updated to the implemented registration path; the CLI now defers database/model loading until after confirmation, preserving fail-closed behavior while avoiding unnecessary startup work. Initial checks are not counted as final success. Actual MongoDB transactions and Google integration are not established by mocked repository tests.

Built-server HTTP smoke checks passed: all five new protected frontend routes returned 307 to /login; Admin-access entry retained /login?intent=admin-access; production preview returned 404. API health returned 200, readiness 503 and auth availability false with the deliberately unavailable local database. Student options/profile/QR and Admin/Super Admin directory/correction APIs returned 401 without a session and retained private/no-store headers. The production /backend rewrite preserved health 200, readiness 503 and Student/QR 401 responses. No authenticated success was fabricated. Temporary servers were used only for local checks.

### O. Known Issues and Blockers

- BLOCKED: real Google login, Atlas persistence/index creation, database transaction/write-conflict/unique-index behavior, encrypted credential durability and deployed cookie transport. No credentials were requested and no production database operation was faked.
- BLOCKED: authenticated browser visual/accessibility/responsive end-to-end review, real PNG scan/rotation behavior across sessions and student/Admin workflows with actual accounts. Components and CSS are implemented and fixture-tested; that is not live browser proof.
- Trusted roster import/matching is outside this phase. Authorized documented manual verification is implemented without claiming a roster match, phone OTP or coding account ownership.
- Administrative/student profile records are independent, but simultaneous Student/Admin workspace access intentionally remains restricted by the existing single-role model.
- Unexpected legacy Student User usernames or synthetic verified flags require the documented reviewed reconciliation before production; no silent migration was performed.
- QR key loss requires trusted identity recovery and explicit replacement; operational wrapping-key migration is documented, not automatically executed. No administrative recovery endpoint is shipped; Student self-rotation is supported.
- Per-user rate limit state is process-local. Distributed coordination and platform logging/caching policy must be reviewed before horizontal deployment.
- Checks ran locally on Node 26.13.1. The repository targets Node 22 LTS in CI; remote Node 22 CI was not executed during this phase.

### P. Files Created or Modified

Backend new: `src/students/{contracts,crypto,repository,service,router}.ts`; `src/models/student-profile.ts` (profile and roll reservation); `student-qr-credential.ts`; `student-profile-correction-request.ts`; student domain/HTTP/repository tests and test-only transactional fixtures.

Backend extended: app DI/router mounting; database index/readiness integration; auth destinations; administration permission validation/definitions/audit actions; College operationalRevision; AuditLog target; provisioning CLI lazy loading; sanitized environment template; package manifests/lockfile for phone validation; auth regression expectations.

Frontend new: `src/features/students/{contracts,server,shell,registration,profile,qr,management}` and responsive stylesheet; five protected route pages; student UI and routing tests. Extended auth contracts/proxy/error destinations, shared role navigation/workspace links, permission matrix and definitions, root stylesheet imports and package manifests/lockfile for phone validation/QR rendering/types.

Documentation: cumulative root README updated with this A–R record, latest setup and current status. This separate report remains local/ignored. Root README is the only Markdown document eligible for publication; source/tests/safe config stay eligible for Git, while secrets/dependencies/generated files remain ignored. No commit or push was performed.

### Q. Acceptance Criteria

| # | Requirement | Status | Evidence / limitation |
| --- | --- | --- | --- |
| 1 | StudentProfile model | PASS | Production Mongoose model and unique/scoped indexes |
| 2 | Mandatory registration | PASS | All fields validated; trusted Google email; real API form |
| 3 | Exactly 10 alphanumeric roll | PASS | ASCII precheck + uppercase regex |
| 4 | Global roll uniqueness | PASS | Global profile/reservation indexes; live index enforcement BLOCKED |
| 5 | Consistent normalization | PASS | Backend/frontend trim/ASCII/uppercase tests |
| 6 | Permanent Student usernames | PASS | Bounded safe generator; unique immutable profile field |
| 7 | Student/Admin separation | PASS | Independent profile username; one canonical User |
| 8 | Phase 3 approval compatibility | PASS | Registered-student promotion regression |
| 9 | Verification lifecycle | PASS | Pending/verified/rejected distinct from registration |
| 10 | Scoped verification | PASS | Current permission/assignment/college/account checks |
| 11 | Registration UI/API integration | PASS | Functional API client; fixture-tested; live authenticated E2E BLOCKED |
| 12 | Student profile page | PASS | Protected own-profile UI/API |
| 13 | Direct/protected edit separation | PASS | Strict allowlists and reviewed identity changes |
| 14 | Corrections | PASS | Own requests/history/cancel; transactional staff reviews |
| 15 | Permanent QR | PASS | Persistent encrypted credential design; live persistence BLOCKED |
| 16 | No PII in QR | PASS | Only random opaque token encoded |
| 17 | Hash/encryption storage | PASS | SHA-256 + AES-256-GCM; tests detect tampering |
| 18 | Stable across sessions | PASS | No login/edit rotation; persisted reversible material; real cross-session E2E BLOCKED |
| 19 | Rotation invalidation | PASS | Single hash replacement/version CAS; concurrency tests |
| 20 | Admin verification UI | PASS | Directory, scoped details, evidence/rejection/correction review |
| 21 | Super Admin student UI | PASS | Global directory/filters/detail/review/transfer authority |
| 22 | Backend authorization | PASS | Session/role/own/scoped checks and negative tests |
| 23 | Audit coverage | PASS | Same-transaction lifecycle/identity/QR/review events |
| 24 | Automated tests | PASS | 275 distinct tests passed: 200 backend, 74 frontend suite + 1 optional real API health test |
| 25 | Lint/types/builds | PASS | Both applications passed lint, types and production builds |
| 26 | No production mock storage | PASS | Real Mongo repository; test fixtures only |
| 27 | No Phase 5 | PASS | No course/batch/enrollment/attendance/progress operations |

PASS denotes implemented and automated evidence, with explicitly named live integration limitations. No mocked result is represented as real Atlas/Google verification.

### R. Next Phase Readiness

Phase 4 implementation is locally validated and ready for review. Live Google/Atlas, credential durability and authenticated browser checks remain explicit pre-launch gates; this handoff does not authorize Phase 5.

Phase 5 must use the independent StudentProfile, active college and current institutional verification rather than treating Google login or registration completion as enrollment authority. Review real indexes/transactions, identity migration policy, secret/key backups and authenticated browser behavior before launch. Phase 5 has not started and requires a new request after review. No automatic commit, push or deployment was performed.

## Phase 5 — Courses, batches and roll-based enrollment

Historical Phase 5 handoff snapshot. Phase 6 below supersedes its next-phase status and extends its delivery model.

### A. What We Built

Implemented reusable scoped Course management, college-specific Batch delivery, permanent batch metadata snapshots, roll-only manual enrollment, bulk paste, CSV/XLSX import, owner-bound preview/confirmation, capacity-safe membership creation, pending registration/verification, durable reconciliation, immediate effective-access checks, withdrawal/transfer/history, real Student course/batch summaries and shared role-aware Admin/Super Admin management screens.

Preserved the independent applications, canonical Google User, separate StudentProfile, permanent usernames/QR, OIDC sessions, CSRF, college assignments, existing permissions and audit infrastructure. No production mock database, fake identity, successful offline import, public self-enrollment, Learning Day content, editorials, attendance scanning, coding progress, certificates or payments were introduced. No Phase 6 work, commit, push or deployment was performed.

### B. Backend Architecture

- `learning/contracts.ts`: strict Zod course, batch, lifecycle, pagination/filter/sort, roll-only manual, preview, confirmation, withdrawal and transfer schemas; typed DTOs and dependency-injected repository/unit interfaces. Reuses Phase 4 rollSchema.
- `models/learning.ts`: Course, Batch, BatchEnrollment, EnrollmentImport and append-only EnrollmentHistory Mongoose models with global/scoped/partial uniqueness, immutable relationship fields and indexed operational state.
- `learning/repository.ts`: real Mongoose unit sharing one ClientSession with MongoStudentUnit and MongoAdminUnit; explicit index readiness; scoped queries; conditional seat counters; revision/pending-state updates; persisted manifests/results; bounded reconciliation reads.
- `learning/service.ts`: ownership/college permission rules, curriculum snapshots, lifecycle validation, shared enrollment assessment, transactional import/withdrawal/transfer/history, reconciliation transitions and fresh effective-access authorization.
- `learning/parser.ts`: bounded CSV/XLSX/paste parsing; no filesystem extraction or permanent uploaded file storage; roll-column-only canonical manifests.
- `learning/markers.ts` and `worker.ts`: durable source-document work markers, event generation IDs, cursor continuation, retry/failure state, startup worker and audited Super Admin retry.
- `learning/router.ts`: existing session authentication, exact-Origin/CSRF mutation checks, strict schemas, private/no-store responses, rate limiting and safe standardized errors.
- Existing Student, Admin and auth repositories mark relevant state changes atomically in their original writes. App DI/router/body limits, database readiness, startup/shutdown and permission/audit definitions are extended.

### C. Frontend Architecture

New shared feature modules: typed contracts; paginated college/course/destination selectors; Course catalog/editor/details; Batch catalog/editor/details; organized enrollment workspace; manual and bulk import flows; paginated preview/results; membership change dialogs; Student membership cards; reconciliation status/retry; responsive stylesheet.

Protected routes:

- `/admin/courses`, `/admin/batches`, `/admin/batches/[batchId]`, `/admin/batches/[batchId]/enrollments`.
- Equivalent `/super-admin/...` routes, reusing the same components with explicit role props.
- `/super-admin/reconciliation` for durable failures and audited retries.
- `/student/courses`, `/student/batches`, and the updated verified `/student` dashboard.

Existing server page guards, authoritative Proxy checks, TanStack Query, typed API/CSRF transport, RHF/Zod forms, toast notifications, native focus-trapping confirmation dialogs, shared tables, pagination, skeletons, status pills and design tokens are reused. Registered pending Students may enter own-summary routes, but the backend exposes no unrelated pending rolls or course resources. Session/role/registration redirects remain authoritative.

### D. Course Management

Course is a reusable curriculum, separate from delivery groups. Fields include title, globally unique normalized uppercase code, unique lowercase slug, plain-text description/short description, difficulty, optional estimated study days, bounded normalized tags, explicit scope/owner/sharing, lifecycle, actor IDs, revision and timestamps.

Super Admin manages platform and college-owned courses. Admins with course.manage can create/edit/publish/archive only courses owned by their currently ACTIVE assigned College. Admins cannot create platform courses, take over ownership, edit another college's shared course or grant sharing. Ownership is fixed after creation. Super Admin may explicitly share a college-owned course with up to 20 active colleges. Published global or explicitly eligible shared/own courses are selectable for college delivery; private drafts remain restricted to their owner management scope. Other college ownership grants are never inferred from browser selection.

Lifecycle is DRAFT → PUBLISHED → ARCHIVED, with direct draft archive allowed. Archive is terminal and retains referenced records. Published metadata edits require expectedRevision. Course code/slug uniqueness is enforced by indexes; no hard-delete API exists. Course edits never rewrite existing Batch snapshots. Student-facing APIs do not expose the management catalog or unpublished content.

### E. Batch Management

Batch belongs immutably to one Course and one College. College+code is unique. Name, bounded description, optional validated ISO dates and optional integer capacity are supported. Enrollment policy is fixed to ADMIN_ROLL_ONLY. Batch revision protects human edits; operationalRevision serializes capacity and eligibility writes separately.

Creation requires batch.manage in the active College and a published course eligible for that College. Activation repeats those checks and refreshes the minimal snapshot from the current Course revision. Snapshot holds title, code, slug, description, difficulty and revision; completed/archived Batch metadata is not editable. This is a metadata snapshot foundation, not Learning Day versioning. Phase 6 must attach immutable curriculum revisions/content snapshots without mutating completed history.

Lifecycle is DRAFT → ACTIVE → COMPLETED → ARCHIVED, with explicit earlier archive allowed. Reopening completed/archived batches is unsupported. New enrollment is allowed only in DRAFT/ACTIVE batches; only ACTIVE batches can grant current effective learning access. Completion/archive retain membership and history while denying current access.

Capacity policy: every current membership, including both pending states, reserves a seat until explicit withdrawal/transfer. Conditional counter updates enforce the limit in the same transaction as membership creation; concurrent writers serialize on Batch. Capacity edits cannot reduce below existing reserved seats. No count-then-write check outside a transaction authorizes admission.

### F. Enrollment Architecture

Only rollNumber is accepted as an enrollment identifier. The canonical Phase 4 schema trims, rejects non-ASCII/incorrect length/internal spaces/punctuation, and uppercases exactly ten letters/digits. User/profile IDs, email, phone, Google subject, names and usernames are rejected as enrollment body fields and are never used for enrollment lookup.

The backend resolves the current StudentProfile.rollNumber, not merely a historical reservation. Current profile College, verification and canonical User eligibility are checked. Eligible verified STUDENT accounts in the matching active College/course and ACTIVE Batch receive ACTIVE membership. Registered unverified/ineligible accounts receive PENDING_VERIFICATION. Missing profiles receive PENDING_REGISTRATION without creating a User/Profile. Wrong-college or historical-roll matches produce safe conflicts without foreign profile details or automatic college changes.

Partial unique indexes prevent contradictory current Batch+roll and Batch+profile memberships. Current states are PENDING_REGISTRATION, PENDING_VERIFICATION and ACTIVE; WITHDRAWN/CANCELLED history remains retained. API responses contain safe roll/status/outcome data, not another college's personal profile.

Former withdrawn/cancelled membership is not silently recreated: a new add of that same roll to the same Batch returns HISTORY_CONFLICT and requires separate reviewed recovery. No re-enrollment recovery endpoint is shipped in this phase. An old bound enrollment after an approved roll correction cannot activate against the historical roll; explicit withdrawal and enrollment of the current corrected roll preserve history and identity rules.

### G. Pending Enrollment and Reconciliation

Relevant User, StudentProfile, College, Course and Batch writes include durable enrollmentReconciliationPending/cursor/attempt/next-time/error/event-token fields in the SAME original document write. These markers are an embedded durable outbox: they do not depend on a process-local event callback or a browser action. Student registration/verification/rejection/correction, canonical account suspension/reactivation/promotion, College changes and Course/Batch changes all feed this mechanism. Events reset the cursor and retry state and issue a fresh generation token.

The backend worker starts with the server, polls every five seconds only after storage readiness, and processes at most one marker per source kind per pass, with at most 50 current memberships per transaction. The same transaction writes enrollment changes, history/audit and source cursor/completion state. Full pages retain a cursor; shorter pages finish the marker. Process restarts retain pending work. Concurrent source changes conflict on the same document and restart safely. Current and historical roll associations are considered for repair discovery, but only CURRENT profile roll ownership can activate an enrollment.

Failures retain the marker and safe diagnostic text, increment attempts and back off to at most five minutes; after eight failures the work remains visible for explicit Super Admin review/retry. A generation guard prevents an old failure from replacing a newer event's retry state. `/super-admin/reconciliation` shows real pending/failure records. Retry is session/CSRF protected, rechecks current active Super Admin authority, marks work and appends audit transactionally. No external job service is required.

Authorized roster reads reconcile a bounded page as a safety net. Reconciliation is idempotent and writes history only when status, binding or eligibility reason changes. COMPLETED/ARCHIVED batch membership may retain ACTIVE as a historical membership state, while current effective access is always false. Withdrawal/transfer are not undone by reconciliation.

Effective access never trusts a stale stored ACTIVE flag. The reusable service helper checks the current User role/status/verification, current StudentProfile roll/College/verification, bound current ACTIVE enrollment, active College, published eligible Course and ACTIVE Batch on each use. Revocation denies access immediately even while a job is delayed or failed. Future Learning Day/attendance/progress endpoints must call this authority rather than trusting a preview, roll possession or stored membership status alone.

### H. Bulk Import

All manual, paste, CSV and XLSX methods use one enrollment assessment/execution pipeline. Manual requests require confirmation and a UUID request key. Paste accepts one-per-line, comma or whitespace separators. Every normalized input is categorized deterministically as ACTIVE, PENDING_REGISTRATION, PENDING_VERIFICATION, ALREADY_ENROLLED, DUPLICATE_INPUT, INVALID_ROLL, COLLEGE_CONFLICT, HISTORICAL_ROLL_CONFLICT, HISTORY_CONFLICT or CAPACITY_CONFLICT.

[csv-parse](https://csv.js.org/parse/options/) handles UTF-8, optional BOM, quoted fields, blank rows and strict record structure. Exactly one recognized Roll Number/RollNumber/Roll_No/Roll No header is required. Extra columns are ignored with a warning and are not retained as a profile lookup source.

[ExcelJS](https://github.com/exceljs/exceljs) reads the first worksheet only. Plain-text roll cells retain leading zeros. Unambiguous ten-digit integer cells with General/0 number formatting are supported; short numbers, padded/ambiguous numeric formats, formulas, hyperlinks and object-valued identifiers are rejected rather than silently converted. No formula engine or macro execution is used. [fflate](https://github.com/101arrowz/fflate) checks entry count/declared expansion before decompression; bounded extracted buffers are repacked before passing to the workbook parser so original ZIP metadata is not trusted again.

Limits: 200 nonblank input rows, 1 MiB original file, 8 MiB expanded workbook, 4 MiB per ZIP entry and 500 ZIP entries. Paste/text/cell lengths and JSON body sizes are also bounded. Workbook row ranges beyond 201 including the header are rejected. Only CSV/XLSX kinds are accepted; malformed encoding, UTF-8, CSV, ZIP or workbook data fails safely. Files are not extracted to disk, stored permanently, logged, or shared between Colleges. Only bounded roll-column manifests/results persist.

Flow: parse → validate/preview → explicit confirmation → authoritative revalidation → transaction → results. A random 256-bit preview token is returned once; only its hash is stored with owner User, Batch, canonical rows, source, warnings and 30-minute expiry. It is not a session or permanent authorization. Confirmation accepts only this token and true confirmation, rechecks current account/grants/College/Course/Batch/profile/verification/capacity/membership, and cannot be rebound to another actor or Batch.

Atomicity policy: because the entire operation is bounded to 200 rows, all accepted memberships, seat changes, histories, audit summaries and operation results commit in ONE transaction. Expected invalid/duplicate/conflicting rows are skipped individually and reported alongside committed rows. An unexpected database/audit failure rolls back every accepted row in that operation. This is not chunked partial commitment, and no whole-file success is fabricated after failure.

Completed results persist and identical preview/request-key retries return those original results without adding seats or rows; reusing a manual request key for another roll is rejected. Revalidation still requires current authorized operational access to retrieve/replay execution results. Preview alone reserves no capacity. Attempts across manual/preview/import are limited to 30 per current User/hour in addition to the existing API limiter. The XLSX library's UUID transitive advisory was addressed with a compatible UUID 11.1.1-or-later override; no vulnerable downgrade was applied.

### I. Withdrawal and Transfer

Withdrawal requires current student.enroll authority in the active College, confirmation, reason and enrollment revision. It changes the existing record to WITHDRAWN, records time/reason, releases a reserved seat and appends history/audit in one transaction. Effective access ends immediately; identity and previous events remain.

Transfer requires current authority for both source/destination, a different eligible DRAFT/ACTIVE destination Batch of the SAME Course and SAME College, current roll/profile compatibility, source revision, available destination capacity and no current/former conflicting destination membership. It creates a new destination record, links transferredFrom/transferredTo, withdraws source, adjusts both counters and writes both histories plus audit atomically. If verification is unavailable, destination remains pending. Cross-college/course transfer is rejected without changing StudentProfile; cross-college identity correction remains the separate Phase 4 process.

### J. Student Dashboard

The verified Student dashboard and own Course/Batch pages use real backend membership data. Cards show authorized snapshot course title, Batch, College, Batch status, dates, enrollment state and fresh effective-access state. No percentages, learning-day/problem totals, attendance or coding progress are invented.

Unverified profiles receive a safe verification-needed summary with no unrelated pending roll records. A verified current identity can see its own bound pending membership metadata where appropriate; that does not grant resources. Old-roll/foreign-current-college or operationally unavailable memberships show a generic review/unavailable state without unrelated curriculum details. No endpoint lets Students browse private catalogs/rosters or self-enroll.

### K. Database Models and Indexes

| Model | Fields/relationships | Important indexes/guards |
| --- | --- | --- |
| Course | Metadata, scope/owner/shared Colleges, lifecycle, actor IDs, revision, timestamps, durable marker | UNIQUE code; UNIQUE slug; scope+owner+status; title+status; pending marker+retry time |
| Batch | Immutable Course/College, College code, lifecycle/dates/capacity, policy, snapshot, seatCount, revisions, actors/timestamps/marker | UNIQUE College+code; College+status; Course+status; startDate; marker+retry time |
| BatchEnrollment | Immutable Batch/College/normalized roll/source, optional profile binding, state/reason, creator, activation/withdrawal/transfer links, revision/timestamps | Partial UNIQUE Batch+roll for current states; partial UNIQUE Batch+profile for current bound states; Batch/status; profile/status; College/status; roll/status |
| EnrollmentImport | Actor/Batch/token hash/request key/source/canonical roll rows/warnings/expiry/status/results/timestamps | UNIQUE tokenHash; UNIQUE actor+Batch+requestKey; Batch+status+createdAt; completed results retained for replay |
| EnrollmentHistory | Immutable membership/Batch/College/actor/action/before/after/reason/time | Enrollment+time; Batch+time; actor+time; no mutation/delete endpoint |
| Existing User/Profile/College | Existing identities preserved; durable source markers added | Indexed pending marker/retry time; source marker written atomically with domain update |

Critical operations share one Mongoose ClientSession through existing units with snapshot read concern and majority write concern. Capacity and enrollment revisions serialize competing writes. No transactionless fallback exists. Index readiness is explicit and gates `/ready`/learning repository access. Partial `$in` indexes require a MongoDB version that supports those expressions; validate on the actual Atlas version before launch. Schema/index mocks and transactional fixtures do not prove live MongoDB enforcement.

### L. API Endpoints

Paths below are under `/api/v1`; browser requests use the existing `/backend` same-origin transport. All use existing sessions and private/no-store responses; mutations require exact Origin and session-bound CSRF. Strict request/query schemas and bounded pagination/filter/sort prevent browser mass assignment.

| Method | Path | Authority / behavior |
| --- | --- | --- |
| GET | /courses | Admin authorized catalog or Super Admin global catalog; search/status/difficulty/scope/owner filters |
| GET | /courses/:courseId | Authorized metadata/details and current management capability |
| POST | /courses | Super Admin platform/college draft or Admin course.manage in owner College |
| PATCH | /courses/:courseId | Same ownership authority, full validated metadata and expectedRevision |
| POST | /courses/:courseId/publish | Same management authority; lifecycle/revision/confirmation |
| POST | /courses/:courseId/archive | Same management authority; terminal archive without deletion |
| GET | /batches | Admin active assigned College scope or Super Admin global; College/Course/status/search filters |
| GET | /batches/:batchId | Authorized Batch/snapshot/counter/capabilities |
| POST | /batches | batch.manage, active College, published eligible Course |
| PATCH | /batches/:batchId | Same management scope; revision/dates/capacity; immutable Course/College |
| POST | /batches/:batchId/activate | Same scope; eligible Course/College, current snapshot, revision/confirmation |
| POST | /batches/:batchId/complete | Same scope; retain history, deny current learning access |
| POST | /batches/:batchId/archive | Same scope; retain historical records |
| GET | /batches/:batchId/enrollments | student.view; scoped current roster/search/status; bounded repair safety net |
| POST | /batches/:batchId/enrollments | student.enroll; roll-only manual request key/confirmation and shared execution rules |
| POST | /batches/:batchId/enrollments/preview | student.enroll; authorized bounded paste/CSV/XLSX preview |
| POST | /batches/:batchId/enrollments/import | student.enroll; owner-bound token/confirmation; revalidate and atomically commit/results |
| POST | /batches/:batchId/enrollments/:enrollmentId/withdraw | student.enroll; reason/revision/confirmation; retain history |
| POST | /batches/:batchId/enrollments/:enrollmentId/transfer | student.enroll in both batches; same Course/College policy and destination capacity |
| GET | /batches/:batchId/enrollment-history | student.view plus report.view, student.enroll or batch.manage; retained membership records |
| GET | /batches/:batchId/enrollment-events | Same history authority; paginated append-only transition events |
| GET | /students/me/courses | Own current canonical Student identity only; fresh effective membership projections |
| GET | /students/me/batches | Same safe own membership projection |
| GET | /learning/reconciliation | Active Super Admin; real durable pending/failure visibility |
| POST | /learning/reconciliation/retry | Rechecked active Super Admin; kind/target/confirmation; audited durable retry |

Super Admin uses the same business services with explicit global authority; implementation is not duplicated into a second API or authentication flow. There is no hard-delete, public self-enrollment, direct profile enrollment or content-management route.

### M. Security and Audit

Every mutation uses current backend identity and college permissions. Admins cannot edit global/foreign curricula, create foreign batches, read foreign rosters, bind fake profile IDs, claim an old reserved roll, escalate via preview replay or bypass verification/capacity. Withdraw/transfer target membership IDs are checked against the authorized Batch. Student enrollment input accepts only roll, not another identity field.

Current memberships use partial unique indexes, conditional reserved-seat counters, actor/profile/College/Course/Batch write guards and revisions inside transactions. Preview tokens are hashed, actor/Batch bound, expiring and revalidated. Manual retries are keyed; completed manifests/results prevent duplicate execution. Reconciliation markers, bounded pages and retry generations survive process restart/failure, while fresh access checks deny revoked eligibility immediately.

Import file/row/expansion/type/encoding/cell limits, fixed roll-column selection, formula/link rejection, bounded repacking, text-only rendering and no filesystem extraction reduce spreadsheet attack surfaces. Uploaded full spreadsheets and foreign profile details never enter audit summaries. Application logging retains request IDs/status/timing rather than raw bodies, lists, cookies, QR or OAuth values.

Audit actions cover Course create/update/publish/archive; Batch create/update/activate/complete/archive; current/pending enrollment creation; activation/reconciliation; withdrawal/transfer; import completion/conflict summaries; and reconciliation retry. Per-enrollment history records include actor/time/transition/reason. All critical history/audit writes commit with the corresponding domain writes; unexpected audit failure aborts the transaction. Automated reconciliation uses the original enrollment creator's real retained User reference with explicit System reconciliation actor naming; no fake system User is created.

Process-local rate limiters require distributed coordination before horizontal scaling. The worker's local running guard is only an efficiency measure; persistence and transaction conflict handling provide durability. Audit APIs are append-only, not a promise of database-administrator tamper resistance.

### N. Environment Variables

No new secret is required. Existing MongoDB, Google OIDC, frontend/exact CORS origins, session/proxy and optional QR vault variables remain backend-only where appropriate. Frontend keeps NEXT_PUBLIC_API_BASE_URL=/backend and server-only BACKEND_API_BASE_URL. Parsing limits, page sizes, retry/backoff and worker intervals are bounded constants, not insecure browser overrides.

Atlas remains deliberately unconfigured. No production credential, import signing secret, fake identity, real personal roster or QR key was requested or generated. Existing `.env.example` files retain sanitized names/examples. No uploaded spreadsheet artifact is written into the repository.

### O. Testing Results

Final local validation (Node 26.13.1; remote Node 22 CI not run):

| Command | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS | PASS |
| npm run lint | PASS | PASS |
| npm run typecheck | PASS | PASS |
| npm test -- --maxWorkers=2 | 270 passed across 17 files | 97 passed across 11 files; optional live-health file initially skipped |
| npm run build | PASS (TypeScript) | PASS (Next.js production build, all new pages protected/dynamic) |
| npm audit | Zero vulnerabilities | Zero vulnerabilities |

The optional live-health test was then explicitly executed against the built local API with RUN_CONNECTIVITY_TEST=true and npm test -- src/tests/connectivity.test.ts: 1 passed. **368 distinct tests passed: 270 backend and 98 frontend including that separate connectivity run.** This establishes local HTTP transport, not MongoDB persistence or Google login.

The frontend production build used NEXT_PUBLIC_API_BASE_URL=/backend and a localhost server-only BACKEND_API_BASE_URL. No secret was embedded. The final HTTP cache-header fix was rechecked after moving no-store before authentication; final source/build results supersede the initial middleware-order finding.

Backend coverage includes scope/ownership/sharing, unique course IDs, lifecycle/revision/snapshot rules, active College and eligible Course checks, strict roll-only validation, verified/pending/missing/foreign/historical identities, duplicate/current/former membership policy, competing capacity requests, pending-seat reservation, preview conflicts/revalidation/expiry authority, replay/request-key binding, full rollback after unexpected audit failure, transfer/withdraw/history, reconciliation idempotence and immediate revocation gates.

Parser tests exercise BOM/headers/quoted UTF-8 CSV, leading-zero strings, ignored extra columns, no email/phone identifier fallback, invalid encodings/formats/quoting, limits, first XLSX worksheet, formulas/hyperlinks/ambiguous numeric formats and expanded archive bounds. Real model contract tests cover partial indexes, transaction options/session composition, durable flags in original identity/College writes, conditional counters and import-result updates. Worker tests cover same-transaction cursor completion, 50-row continuation, persisted eight-attempt failure/backoff visibility, generation guarding and unavailable readiness.

Frontend tests exercise course/batch forms and optional numbers/dates, ownership-aware controls, lifecycle confirmation/revisions, enrollment tabs/roll validation, paste preview/confirmation/results, preview invalidation after changed input, CSV/XLSX upload transport/type rejection, real own cards/unavailable states, reconciliation retry confirmation and protected routes. Existing Phase 1–4 tests remain included.

Initial validation found TypeScript/model-query union issues, historical mock expectations extended by durable marker fields, test transport mocks that treated GET as mutation, asynchronous selector timing and a real empty optional-number conversion bug. These were corrected; final results below supersede earlier failures. The parser's dependency audit advisory was fixed with the compatible UUID override and verified by execution, not a vulnerable downgrade. No failed or unexecuted check is labeled PASS.

Built HTTP checks observed unauthenticated Admin Course/Batch/detail/enrollment, Super Admin catalog/reconciliation and Student Course/Batch routes redirecting 307 to /login. Production preview returned 404. Backend health returned 200, readiness 503 and auth/status available=false with the deliberately unavailable localhost database. Private Course/Batch/enrollment/own-summary/reconciliation APIs returned 401 without data. The production /backend rewrite preserved health/readiness/denial behavior. After the middleware-order correction and rebuilt API, direct and same-origin Course, Batch, own-summary and reconciliation authentication denials all returned 401 with Cache-Control: no-store, private. No real Google/Atlas account was fabricated. Temporary servers were stopped after local checks.

### P. Known Issues and Blockers

- BLOCKED: actual Atlas persistence, partial unique index creation/enforcement, real transaction/write-conflict behavior, counters under multi-process load, worker restart/retry durability against real MongoDB and Google-authenticated end-to-end operations. Test fixtures are not live database proof.
- BLOCKED: authenticated browser visual/mobile/accessibility review and real administrative roster import against configured accounts. Responsive layouts and component behavior are implemented/fixture-tested, without a production preview account or impersonation route.
- Imports are deliberately bounded to 200 rows/1 MiB. Larger cohorts use multiple independent confirmed imports. Accepted rows of one import commit atomically; multiple imports do not form one global transaction.
- Pending memberships reserve capacity until explicit withdrawal/transfer. Former same-Batch membership is not silently recreated; reviewed re-enrollment recovery remains a separate future policy/tool.
- Transfers are same Course/same College only; cross-college identity correction remains Phase 4. Existing single-role Student/Admin access remains intentionally preserved.
- No Learning Day content or completed-curriculum content revision system exists yet. Phase 6 must extend immutable snapshots without rewriting completed Batch history.
- Per-process rate limits and worker operational throughput need validation before horizontal production scaling. Completed import results/history are retained for replay/audit; production retention policy must preserve idempotency/history guarantees.
- Local Node and remote Node 22 CI execution are distinct; remote CI is not claimed as executed. Application dependency audit results are recorded from actual local runs.

### Q. Files Created or Modified

New backend: `src/learning/{contracts,markers,parser,repository,router,service,worker}.ts`; `src/models/learning.ts`; learning transactional test fixtures and domain/parser/HTTP/repository/worker test suites.

Backend integration: existing User, College, StudentProfile marker fields/indexes; Student/Admin/auth repository atomic marker writes; Course/Batch/import/enrollment audit actions/targets; permission availability metadata; app DI/preview body limit/router mount; database indexes/readiness; startup/shutdown worker; dependency manifest/lockfile and safe UUID override; relevant prior model-contract test assertions.

New frontend: `features/learning/{contracts,options,courses,batches,enrollments,transfer-options,student,reconciliation}` plus responsive stylesheet; eleven new role pages for Course/Batch/Enrollment/own summaries/worker visibility; learning UI/routing tests. Updated verified Student dashboard, Student/administration navigation, root CSS imports, Proxy own-summary exceptions and audit filter actions.

Documentation: cumulative README with complete Phase 5 A–S record, current status and setup; this local ignored report. README remains the only publishable Markdown document. Source/tests/safe config are eligible for Git, while secrets, dependencies, builds, internal Markdown reports and screenshots remain ignored. Nothing was staged, committed, pushed or deployed automatically.

### R. Acceptance Criteria

| # | Requirement | Status | Evidence / limitation |
| --- | --- | --- | --- |
| 1 | Course model | PASS | Production schema/global/scoped indexes |
| 2 | Course management/lifecycle | PASS | Create/read/update/publish/archive; no destructive delete |
| 3 | Course ownership/scope | PASS | Owner-only Admin edits, global published selection, explicit SA sharing |
| 4 | Batch model | PASS | Immutable Course/College, snapshot/capacity/revisions |
| 5 | Batch lifecycle | PASS | Draft/active/completed/archived transitions |
| 6 | Course/College eligibility | PASS | Backend active/publication/scope guards |
| 7 | Enrollment model | PASS | Current-state partial uniqueness/history |
| 8 | Roll-only enrollment | PASS | Strict input, no PII identity lookup |
| 9 | Exact reused roll validation | PASS | Phase 4 schema imported directly |
| 10 | Verified enrollment | PASS | Current verified identity/College/Batch rules |
| 11 | Unverified remains pending | PASS | No effective resource access |
| 12 | Unregistered pending | PASS | No fake canonical account/profile |
| 13 | Historical roll safety | PASS | Current profile roll required; reservation alone cannot activate |
| 14 | Manual enrollment | PASS | Shared service, confirmation, keyed retry |
| 15 | Bulk paste | PASS | Delimiters, duplicates/invalid/conflict preview |
| 16 | CSV import | PASS | Bounded maintained parser, headers/BOM/quoting |
| 17 | XLSX import | PASS | Bounded first worksheet/plain-text/formula safeguards |
| 18 | Preview/confirmation | PASS | Persisted owner-bound manifest, authoritative revalidation |
| 19 | Idempotent/concurrent import | PASS | Transactional results/uniqueness/counter; live MongoDB BLOCKED |
| 20 | Safe capacity | PASS | Pending seat reservation and conditional transactional counter |
| 21 | Reconciliation | PASS | Durable markers, bounded retry/cursors, fresh effective gates; live restart proof BLOCKED |
| 22 | Withdrawal history | PASS | Explicit revision/reason/confirmation, no deletion |
| 23 | Transfer/history/scope | PASS | Same course/college, both permissions/counters, preserved links |
| 24 | Real Student dashboard | PASS | Own API-backed summaries; no fabricated progress |
| 25 | Admin management UI | PASS | Shared catalog/batches/enrollment workspace; live authenticated visual review BLOCKED |
| 26 | Super Admin oversight | PASS | Global scope/shared UI and reconciliation visibility |
| 27 | College authorization | PASS | Server current account/grants/College checks |
| 28 | Audit/history | PASS | Critical writes append atomically |
| 29 | Automated tests | PASS | 368 distinct tests passed, including separate real API health check; see section O |
| 30 | Lint/types/builds | PASS | Both applications passed lint, types and production builds |
| 31 | No fake production behavior | PASS | Real MongoDB repository, honest unavailability |
| 32 | No Phase 6 | PASS | No Learning Day/editorial/content operations |

PASS means implemented with the stated local evidence; explicitly blocked live integration is not represented as tested.

### S. Next Phase Readiness

Phase 5 is implemented and locally validated, ready for review with explicit live integration gates. This report does not authorize Phase 6 or represent mocked transaction tests as real Atlas verification.

At this historical Phase 5 handoff, Phase 6 had not started. The completed Phase 6 record below supersedes that readiness snapshot. Before launch, verify the actual Atlas version/indexes/transactions, reserved counters, durable worker recovery, configured Google roles and authenticated responsive flows. Phase 6 content must use fresh effective enrollment checks and immutable course/batch curriculum references. No automatic commit, push or deployment was performed.

## Phase 6 — Learning Days and immutable curriculum

Historical Phase 6 handoff snapshot. The Phase 7 record below supersedes its next-phase status and records the required Phases 1–6 GitHub push.

Implementation report. Local automated evidence and live integration evidence are distinguished below. Previous phases are preserved in README.md.

### A. What We Built

Course curriculum draft/clone/review/publish, arbitrary positive Learning Day numbers, ordered objectives/topics/resources/problem assignments, reusable canonical problem metadata, structured editorial versions, immutable published snapshots, server-time schedules, reviewed Batch assignments/upgrades, assignment history, audited release restrictions and Student Course/Batch/Day screens. Phase 7 is not implemented.

### B. Backend Architecture

The new curriculum contracts, service, MongoDB repository and router reuse Phase 5 Course, Batch and fresh effective-access services. New reusable authority methods centralize Course editor, Batch manager and catalog permissions. Batch gains nullable curriculumRevisionId; existing documents remain honestly unassigned. MongoCurriculumUnit composes MongoLearningUnit using the same ClientSession, including Student/Admin authority locks and transactional audit writes. Snapshot read concern and majority write concern cover publication and assignment. Storage/index readiness is mandatory; there is no production memory fallback.

### C. Frontend Architecture

New modular features/curriculum components provide a revision sidebar and builder, tabbed Learning Day editor, searchable/filterable problem catalog, structured editorial editor and sanitized preview, Batch impact confirmation/history/release controls, and Student learning screens. They use existing RHF/Zod, TanStack Query, CSRF API client, dialogs, loading/error states, toast notifications, light/dark tokens and protected shells. Responsive CSS collapses the workspace on smaller screens; code snippets scroll locally. Nine new protected pages cover Admin/Super Admin catalog, Course builder, Batch assignment and Student Course/Batch/Day routes. Navigation links integrate with existing Course and Batch pages.

### D. Curriculum Revision Design

CurriculumRevision has Course-local numbered DRAFT/PUBLISHED/ARCHIVED states, source revision, optimistic revision counter, actor/timestamps and Course snapshot. Parent CAS guards every draft edit. Course locks serialize numbering/publication with eligibility changes. Publication atomically writes separate PublishedLearningDay documents containing canonical problem metadata and the exact editorial version/body, then transitions the parent and writes audit. Later catalog/editorial changes cannot alter those documents. Published queries are guarded against writes, snapshot updates/deletes are rejected in Mongoose middleware, and draft-day operations require a DRAFT parent. Published editing clones to distinct draft documents; Batch references never follow the latest revision automatically.

Privileged operators using raw database access or application code bypassing Mongoose middleware can circumvent application constraints. Restrict database privileges, review migrations, protect backups and audit operator access. MongoDB indexes alone cannot prove document immutability. There is no public arbitrary-update, archive, published-delete or snapshot-rewrite endpoint. Draft/Editorial guarded queries require an ID, DRAFT status and numeric expected revision. Snapshot creation requires a DRAFT parent; insertMany bypass is rejected.

### E. Learning Day Management

Day numbers are integers from 1 through one billion, formatted with at least two digits without truncating Day 100 or higher. Total days have no five/six-day business limit. Unique revision/day-number indexes and parent CAS protect edits/reordering. Reorder requires every current ID exactly once, temporarily uses unused positive numbers and then renumbers from 1, including when existing numbers reach the maximum. No hard deletion is permitted after publication.

Objectives and topic/resource/assignment arrays preserve order. Per-day limits: 50 objectives, 100 topics, 100 resources and 100 assignments; title/description/code sizes are bounded. IDs and duplicate assignments are validated. Notes use sanitized Markdown; external links require public HTTPS and no credentials. No server-side URL fetch, preview scrape or file upload exists. INSTRUCTOR_ONLY resources are stripped server-side.

SCHEDULED days store UTC timestamps. Authoring displays local timezone; the backend rejects nonfuture schedules when saved. Every Student read evaluates eligibility using server time, without a process-local timer. Publishing the immutable revision does not automatically expose its DRAFT, UNPUBLISHED or future scheduled days. A Batch-scoped audited overlay can restrict access or restore original release rules; it cannot bypass a schedule or reveal hidden editorials.

### F. Problem Catalog

LEETCODE, CODEFORCES and CODECHEF official exact-host URLs are parsed and canonicalized to platform IDs and stable URLs. Unsupported hosts, credentials, query/fragment redirect tricks, encoded paths, unsupported ports and inconsistent client IDs are rejected. A compound unique index prevents duplicate platform/canonical IDs. Canonical identity and owner are immutable; permitted metadata uses revision CAS. The catalog is reusable across Learning Days. All descriptions are instructor-provided; no copyrighted statement scraping, external platform verification or solved state is claimed.

### G. Editorial System

EditorialRevision stores owner, problem, version number, DRAFT/PUBLISHED status and structured body: overview, multiple approaches, intuition, brute force/optimized explanation, ordered steps, complexities, examples, code linked to approaches and additional notes. Snippets support JAVA/PYTHON/CPP/JAVASCRIPT. Published editorials are immutable; editing clones a new numbered draft. Frozen curriculum captures the exact published version and body. Per-assignment visibility is HIDDEN/VISIBLE. Hidden bodies, editorial identifiers and drafts are absent from Student responses, including direct editorial lookups.

React Markdown skips raw HTML, runs GFM and rehype-sanitize, omits images/task inputs and allows only safe HTTPS links. Prism token rendering escapes code through React and never executes it. The instructor editor is explanatory text only. Editorial body is limited to 256 KiB, individual snippets to 20,000 characters and a frozen day to 1 MiB; authoring JSON is limited to 512 KiB.

Global published editorials are reusable by authorized editors. College-owned versions are visible only within the editor's authorized ownership scope; global drafts remain Super Admin only. Student access to frozen editorials depends on the assigned revision, original visibility, release rules and fresh enrollment.

### H. Batch Curriculum Assignment

Batch managers select only a published revision belonging to the Batch Course. Missing references remain null and display Curriculum not assigned. DRAFT and ACTIVE Batches support explicit assignment/replacement. The server returns an impact summary and digest covering Batch revision/status, previous/new curriculum, new day count and reserved membership count. Confirmation carries expected previous ID, expected Batch revision, digest, reason and confirmed=true; the transaction rechecks all authority/eligibility and rejects stale impact. ACTIVE upgrades retain previous/new assignments in append-only history. COMPLETED/ARCHIVED references cannot change. A new published Course revision never silently changes existing Batch content.

### I. Student Learning Experience

Course overview shows authorized enrolled Batches. Batch view displays College/Course, pinned revision, released day/topic summaries and resource/problem counts. Day view separates objectives, topics, resources and required/optional/challenge problem cards, with official platform links and visible editorial tabs. Empty/unassigned/unavailable states are explicit. Students may open any eligible released day, including Day 100, without completing earlier days. No solved/completed checkboxes, progress records or code execution exists.

### J. Authorization and Security

Every Student content endpoint uses Phase 5 effective access: canonical active verified User, STUDENT role, VERIFIED profile, current roll and College, current ACTIVE enrollment, ACTIVE Batch/College and eligible Course. The assigned revision must be published and match that Course; day schedule and release restrictions are evaluated before projection. Knowing a roll, problem ID, editorial ID or unrelated revision grants no content access.

Current Course ownership and course.manage protect authoring. Sharing a Course for delivery does not grant editing its curriculum. Batch management uses batch.manage plus College authority; it cannot authorize foreign Batch changes. Catalog writes enforce owner scope. Mutations recheck authority with existing account/assignment/College/Course/Batch locks inside the transaction. Sessions, Origin/CSRF checks, strict schemas, bounded inputs, sanitized errors, no-store responses and per-user curriculum rate limiting remain enabled. The limiter is process-local; scaled deployment requires shared enforcement as documented in prior phases.

### K. Database Models and Indexes

| Model | Main constraints and indexes |
| --- | --- |
| CurriculumRevision | unique Course/revisionNumber; Course/status/revisionNumber; DRAFT CAS |
| LearningDay | unique revision/dayNumber; revision/status/publishAt; DRAFT-parent writes |
| PublishedLearningDay | unique revision/dayNumber and revision/dayId; append-only frozen content |
| CodingProblem | unique platform/platformProblemId; platform/difficulty; title/topics |
| EditorialRevision | unique problem/versionNumber; problem/owner/status; DRAFT CAS |
| BatchCurriculumAssignmentHistory | Batch/createdAt and newRevisionId; append-only history |
| CurriculumReleaseControl | unique Batch/revision/day; optimistic counter |
| Existing Batch | optional nullable curriculumRevisionId; existing enrollment/history untouched |

Index initialization is part of storage readiness. Actual Atlas index creation and replica-set transaction behavior remain BLOCKED until authorized real integration.

### L. API Endpoints

All paths use /api/v1, session auth and no-store. Mutation bodies are strict and require Origin/CSRF; privileged mutations are audited. Lists accept bounded pagination; unknown query/body fields are rejected by their contracts.

| Methods and paths | Authorization / contract |
| --- | --- |
| GET /courses/:courseId/curriculum | Current Course editor; revision list |
| POST /courses/:courseId/curriculum/drafts | Course editor; optional published sourceRevisionId |
| GET /courses/:courseId/curriculum/revisions/:revisionId | Course editor; paginated draft/frozen days |
| POST .../revisions/:revisionId/clone | Course editor; confirmed published clone |
| POST .../revisions/:revisionId/publish | Course editor; expectedRevision + confirmed |
| POST .../revisions/:revisionId/days | Course editor; validated day + expected parent revision |
| PATCH/DELETE .../revisions/:revisionId/days/:dayId | Course editor; expected parent revision; deletion confirmation |
| POST .../revisions/:revisionId/days/reorder | Course editor; complete ordered IDs + expected parent revision |
| GET .../revisions/:revisionId/days/:dayId/preview | Course editor; Student-safe rendering with server schedule metadata |
| GET/POST /problems | Current curriculum editor; list/create reusable metadata |
| GET/PATCH /problems/:problemId | Current editor / owning editor CAS update |
| GET/POST /problems/:problemId/editorials | Scoped editor list/create |
| GET/PATCH /problems/:problemId/editorials/:editorialId | Scoped editor read / draft CAS update |
| POST .../editorials/:editorialId/publish | Owner; expectedRevision + confirmed |
| POST .../editorials/:editorialId/clone | Owner; published version + confirmed |
| GET /batches/:batchId/curriculum | Batch manager; assigned revision, published options, restrictions |
| GET /batches/:batchId/curriculum/assignment-preview?revisionId=... | Batch manager; server-generated review impact |
| POST /batches/:batchId/curriculum/assign | Batch manager; reviewed digest, expected previous/current revisions, reason, confirmation |
| GET /batches/:batchId/curriculum/history | Batch manager; paginated assignments |
| GET /batches/:batchId/curriculum/days | Batch manager; minimal assigned-day release metadata, no private bodies |
| POST /batches/:batchId/curriculum/days/:dayId/release | Batch manager; expected overlay revision, restricted, reason, confirmation |
| GET /students/me/courses/:courseId | Fresh authorized enrollment; own eligible Batches |
| GET /students/me/batches/:batchId/curriculum | Fresh effective access; released assigned-day summaries |
| GET /students/me/batches/:batchId/days/:dayNumber | Fresh effective access; released assigned-day safe projection |
| GET /students/me/batches/:batchId/days/:dayNumber/problems/:problemId/editorial | Same guards plus assignment and visible editorial |

The day number in the editorial URL disambiguates repeated catalog problems across days. No public editorial or unscoped Student revision endpoint exists.

### M. Audit Logging

Events cover draft creation/cloning; Learning Day create/update/remove/reorder; topics/resources/assignments; problem metadata; editorial draft changes/publication; curriculum publication; Batch assignment/upgrades; release restriction/restoration. They reuse AuditLog and share the corresponding transaction. Summaries contain IDs, states and counts, never full editorial code or resource bodies. Super Admin audit filtering includes new actions. Audit failure aborts the associated mutation and snapshots.

### N. Environment Variables

No new environment variable or secret is required for curriculum. Existing backend names: MONGODB_URI, NODE_ENV, PORT, FRONTEND_URL, CORS_ORIGINS, TRUST_PROXY_HOPS, LOG_LEVEL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_TTL; QR_ACTIVE_KEY_ID and QR_ENCRYPTION_KEYS remain backend-only Phase 4 settings. Frontend: BACKEND_API_BASE_URL, NEXT_PUBLIC_API_BASE_URL; RUN_CONNECTIVITY_TEST only opts into the live health check. No raw values, credentials or real email addresses are published.

### O. Testing Results

| Check | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS | PASS; final stylesheet also formatted after refinement |
| npm run lint | PASS, no warnings | PASS, no warnings |
| npm run typecheck | PASS | PASS |
| npm test | PASS: 356 tests in 20 files with --maxWorkers=2 and local socket permission | PASS: 131 tests, one opt-in health test skipped, using --maxWorkers=1 --testTimeout=20000 |
| Optional real client health test | Real built API listener | PASS: one additional test with RUN_CONNECTIVITY_TEST=true |
| npm run build | PASS | PASS: final Next.js production build with documented local API base configuration |
| npm audit | PASS: zero vulnerabilities | PASS: zero vulnerabilities |

**488 distinct tests passed: 356 backend + 132 frontend (131 standard + one separately executed live client health test).** This includes prior-phase regressions and 120 new Phase 6 tests. Skipped opt-in tests are not counted as passed in the standard run; the health test was executed separately against the real listener.

Production HTTP smoke: API health 200, readiness 503 while storage remains unconfigured, private curriculum/catalog/Student endpoints 401 with no-store; built frontend rewrite health 200, readiness 503, private catalog 401; Admin, Super Admin and Student deep routes redirect 307 to login without a session. Temporary listeners were closed. No authenticated user, production database or successful storage operation was fabricated.

The initial production frontend invocation without BACKEND_API_BASE_URL correctly failed configuration validation; the configured final builds passed. Initial audit requests were blocked by sandbox DNS and then completed with network permission. The initial HTTP test run failed due to sandbox EACCES; the permitted rerun passed all 356 tests. Concurrent frontend runs hit five-second resource timeouts; the final single-worker run with a 20-second test timeout passed all 131 standard tests. Two new frontend assertions were corrected to match semantic complexity markup and await filtered results.

Publication/privacy verification: git diff --check passes; eligible tracked/untracked source was scanned for credential patterns, local user paths, generated/private artifacts and unexpected Markdown with no findings. README.md remains the only tracked/eligible Markdown document; the detailed local report and generated logs are ignored. Nothing is staged, committed, pushed or deployed.

Tests use injected repositories only. New service tests exercise transactional rollback, optimistic conflicts, snapshot identity, scheduling, hidden projection, fresh eligibility and no sequential lock. HTTP tests use real session/CSRF middleware with temporary local listeners. Repository tests inspect shared sessions/guarded writes; ODM tests reject forbidden updates before any database connection. Frontend tests cover builder, publishing confirmation, Day editor, catalog, editorial tabs, safe Markdown/code, impact review, Student pages and protected deep routes.

Initial sandbox failures are recorded above for transparency; only successful final checks contribute to acceptance.

### P. Known Issues and Blockers

- BLOCKED: real Atlas connection, index creation, transaction/write-conflict behavior and persisted migration/assignment verification. No credentials requested or connection fabricated.
- BLOCKED: real Google login, configured roles, authenticated visual/browser verification on desktop/mobile and deployed cookie transport. DOM tests and responsive CSS do not establish a visual browser pass.
- Publication processes an entire revision in one transaction; very large curricula can encounter deployment transaction time/resource limits. It fails atomically without partial publication. There is no fixed five/six-day limit, and no claim of unlimited operational throughput.
- Student summaries filter visibility using server-side reads; there is no durable job because no persisted scheduled transition is necessary. No editorial timing unlock exists.
- Existing Batches require explicit assignment. No automatic data backfill, published revision fabrication or active upgrade is run.
- Raw privileged database access can bypass ODM guards; restrict operator privileges and migration tooling.
- External links are validated, not fetched or externally verified. No scraping or judge integration exists.

### Q. Files Created or Modified

Backend additions: src/curriculum/contracts.ts, repository.ts, service.ts, router.ts; src/models/curriculum.ts; curriculum fixture, service, HTTP and repository tests. Existing app/database readiness, LearningService authority and own-membership projection, Batch contract/schema, audit contracts/schema were extended.

Frontend additions: features/curriculum/contracts.ts, builder.tsx, day-editor.tsx, problems.tsx, editorials.tsx, render.tsx, batch-assignment.tsx, student.tsx, curriculum.css; nine protected pages; curriculum UI/routing tests. Existing API client accepts guarded DELETE, administration queries, navigation, Course/Batch/Student links, audit filter, root CSS imports, package manifest and lockfile were updated. React Markdown/GFM/sanitize and Prism renderer are frontend-only dependencies. README is the only publishable Markdown record; this separate report is local and ignored.

### R. Acceptance Criteria

| # | Requirement | Status and evidence |
| --- | --- | --- |
| 1 | CurriculumRevision model and indexes | PASS — local implementation and automated evidence described above |
| 2 | Published revisions immutable through guarded writes and snapshots | PASS — local implementation and automated evidence described above |
| 3 | Draft, clone, review and publish workflow | PASS — local implementation and automated evidence described above |
| 4 | Revision-aware LearningDay model | PASS — local implementation and automated evidence described above |
| 5 | Create/edit/remove/reorder draft days | PASS — local implementation and automated evidence described above |
| 6 | Ordered objectives and topics | PASS — local implementation and automated evidence described above |
| 7 | Validated resources and sanitized notes | PASS — local implementation and automated evidence described above |
| 8 | Reusable CodingProblem catalog | PASS — local implementation and automated evidence described above |
| 9 | Canonical platform URL/ID validation | PASS — local implementation and automated evidence described above |
| 10 | Required/optional/challenge ordered assignments | PASS — local implementation and automated evidence described above |
| 11 | Structured editorial authoring | PASS — local implementation and automated evidence described above |
| 12 | Immutable editorial versions and frozen bodies | PASS — local implementation and automated evidence described above |
| 13 | Hidden editorials absent from Student responses | PASS — local implementation and automated evidence described above |
| 14 | Server-time scheduled publication | PASS — local implementation and automated evidence described above |
| 15 | Reviewed published Batch revision assignment | PASS — local implementation and automated evidence described above |
| 16 | Honest existing Batch unassigned state | PASS — local implementation and automated evidence described above |
| 17 | Completed/archived Batch reference and history preservation | PASS — local implementation and automated evidence described above |
| 18 | Admin curriculum builder | PASS — implemented and DOM/route tested; authenticated visual verification BLOCKED |
| 19 | Super Admin curriculum builder | PASS — implemented and DOM/route tested; authenticated visual verification BLOCKED |
| 20 | Student Course page | PASS — implemented and DOM/route tested; authenticated visual verification BLOCKED |
| 21 | Student Batch page | PASS — implemented and DOM/route tested; authenticated visual verification BLOCKED |
| 22 | Student Learning Day page | PASS — implemented and DOM/route tested; authenticated visual verification BLOCKED |
| 23 | Fresh effective-access enforcement on content reads | PASS — local implementation and automated evidence described above |
| 24 | No sequential unlocking or completion records | PASS — local implementation and automated evidence described above |
| 25 | Current ownership and cross-college authorization | PASS — local implementation and automated evidence described above |
| 26 | Transactional privileged audit coverage | PASS — local implementation and automated evidence described above |
| 27 | Automated tests | PASS — final commands and results recorded in section O |
| 28 | Formatting/lint/typecheck/production builds | PASS — final commands and results recorded in section O |
| 29 | No production fake data or successful storage fallback | PASS — local implementation and automated evidence described above |
| 30 | No Phase 7 functionality | PASS — local implementation and automated evidence described above |

PASS refers to implemented behavior backed by the stated local tests; BLOCKED live integration is separately listed and never represented as a production verification.

### S. Phase 7 Readiness

Phase 6 awaits user review. Phase 7 has not started. Before production delivery, configure authorized Atlas/Google environments, validate indexes/transactions/role scopes/cookies, explicitly assign an intended published revision to each Batch, and complete authenticated responsive visual checks. QR attendance requires its own reviewed Phase 7 work; no scanning/session/submission/payment/certificate/tutor/chat functionality was added. No automatic deployment, commit or push was performed.


## Phase 7 — QR-based attendance management

Historical Phase 7 handoff snapshot. Phase 8 section A records its subsequent validation, commit and verified GitHub push.

Local implementation report. Live integration and physical-camera evidence are distinguished from automated checks.

### A. GitHub Push Verification

The actual workspace is one existing Git repository containing two independent applications, rather than two nested repositories. Existing history, main branch and origin were preserved; no repository was split and no remote was changed.

| Application | Branch | Existing remote | Pushed commit | Verification |
| --- | --- | --- | --- | --- |
| Frontend | main | https://github.com/manchikanti-varun/algora.git | 9a11e572cb53a2c35720879d89769cb9e3dbb6fe | PASS — remote main equals local HEAD |
| Backend | main | https://github.com/manchikanti-varun/algora.git | 9a11e572cb53a2c35720879d89769cb9e3dbb6fe | PASS — same shared repository and commit |

Stage A committed 47 reviewed files as `feat: complete Algora platform through phase 6`, preserving all prior history. The complete committed tree contained 234 files, including application source/tests/lockfiles/configuration/assets and cumulative README. Five preceding commits and pending content were checked for credential patterns; no findings. Staged files were separately reviewed: no private environment files, real rosters, generated output, dependencies, local logs or Markdown other than README. The existing Git author used a GitHub noreply address. Push succeeded, independent ls-remote verification matched HEAD, and the working tree was clean before Phase 7 began.

Stage A checks: format, lint, types, tests, build and audit in both applications; 488 distinct tests passed including the separately executed real API health test; both audits found zero vulnerabilities. One frontend asynchronous-loading test failed during a busy concurrent run and the complete suite passed on rerun with all assertions unchanged. Only after push verification did Phase 7 development begin. Phase 7 changes remain uncommitted and unpushed.

### B. What We Built

Batch-pinned Morning/Afternoon attendance, DRAFT/OPEN/CLOSED/FINALIZED lifecycle, permanent QR credential reuse, continuous authorized camera scanning, immutable roster admission snapshots, reviewed additive roster refresh, idempotent marks, explicit finalization, excusing unmarked members, audited corrections/history, own Student attendance including completed Batches, reports/comparisons and private CSV/XLSX exports. No Phase 8, deployment or production fake data was added.

### C. Backend Architecture

New attendance contracts, models, MongoDB repository, service and router compose the existing curriculum, LearningUnit, StudentUnit and AdminUnit using one MongoDB ClientSession. Existing Course, Batch, enrollment, QR, session/CSRF and audit systems are retained. New reusable LearningService methods authorize College-scoped attendance and evaluate fresh effective access inside the attendance transaction. Attendance indexes join the existing database readiness gate; unavailable storage fails honestly.

All privileged mutations are transactional with snapshot read concern and majority write concern. Operational writes lock the current actor/College/Batch/Course, session and relevant Student User/profile/enrollment/QR document. These writes conflict with permission revocation, withdrawal, QR rotation and closure instead of trusting a stale read. Session transitions and corrections additionally compare expected revisions. There is no transactionless fallback.

### D. Frontend Architecture

Shared Admin/Super Admin features include an attendance Batch hub with College/Course filters, Learning Day dashboard, Morning/Afternoon cards, roster review/history, reasoned confirmation dialogs, live scanner and report/export views. Student attendance has a self-only Batch history hub and per-Batch screen. Twelve new protected pages reuse existing role shells, backend-verified server guards, Query/RHF-era UI primitives, loading/error states, toast notifications and light/dark tokens. Responsive CSS stacks camera and session panels on mobile; status labels and colors distinguish unmarked/absent/present/excused.

The scanner uses the installed @yudiel/react-qr-scanner 2.6.0 library. Its documented camera/continuous-scanning API was checked against the [official project documentation](https://github.com/yudielcurbelo/react-qr-scanner). The locked ZXing decoder and license are copied to same-origin public assets by predev/prebuild. Generated decoder assets remain ignored. No third-party CDN is needed for decoding, and camera frames are not uploaded by the attendance client.

### E. Attendance Session Lifecycle

| State/action | Behavior |
| --- | --- |
| Create DRAFT | Actual assigned released day and authorized active Batch required; no roster or absence created |
| DRAFT → OPEN | Transactionally admits the current verified eligible enrollment roster |
| OPEN → CLOSED | Stops scanning; existing marks remain draft/reviewable |
| CLOSED → OPEN | Explicit reason/confirmation; original roster and marks retained |
| CLOSED → FINALIZED | Official records created atomically; cannot ordinarily reopen |

Every lifecycle transition after creation requires a meaningful reason, confirmation, expected session revision, current authority and audit/history. Exactly MORNING and AFTERNOON are supported; canonical uniqueness is Batch + LearningDay + sessionType. There are no fixed clock times or sequential attendance prerequisites. New/reopened scanning requires the pinned day's original publication/schedule and current release control. Closing/finalizing an already admitted session remains possible after the day is restricted, without exposing learning content.

### F. QR Scanning

The browser sends only the bounded opaque token in a CSRF-protected POST body. Backend hashes it using the existing Phase 4 QrVault.hash, reads the existing current credential hash/version/profile relationship, verifies the profile credential version and rechecks canonical User, verified profile, current roll/College, ACTIVE enrollment/Batch/College and eligible Course. Snapshot membership is required, but is never sufficient authority by itself.

The existing current-credential model replaces the old lookup hash at rotation. Consequently unknown and rotated-away hashes return INVALID_OR_REVOKED_QR; the system does not pretend it can distinguish them without retained historical hashes. A known mismatched version returns REVOKED_QR. Error responses do not expose identities. Successful authorized feedback contains only name/roll/status.

Camera controls prefer the rear camera, allow device selection, pause/resume/stop, handle insecure/unsupported/permission failures and release streams on unmount/device changes. Scanning continues automatically after responses. The client suppresses repeated frames for four seconds using an in-memory SHA-256 value and serializes in-flight requests; raw QR values are not placed in React Query mutation caches, localStorage, sessionStorage, URLs, logs or analytics. Sound is disabled. The backend's unique record identity and transactional state checks remain authoritative.

Scanning additionally requires an existing server-issued staff session less than eight hours old, or its earlier configured expiry. Renewal requires signing out and signing in again; ordinary token refresh preserves the original creation time and does not bypass this check. Account, role and College grants are rechecked on each request. No new authentication system was created.

### G. Roster Snapshots

Opening creates one immutable admission row per eligible profile: original enrollment ID, profile ID, roll/name snapshots, eligibility and timestamp. No automatic future enrollment admission occurs. A refresh preview computes the eligible additions and a fingerprint bound to session revision and current profile/enrollment revisions. Confirmation requires that digest, reason and expected session revision; the transaction recomputes it. Refresh only appends rows and never rewrites identities or removes withdrawn members.

Withdrawal/transfer after opening preserves historical admission but prevents new scans unless current effective eligibility is valid again. Current roll binding is checked against the current canonical profile/enrollment; historical roster identity stays unchanged. A later legitimate enrollment can authorize a currently eligible admitted profile without rewriting its admission snapshot; the attendance record retains the enrollment used for that mark.

### H. Finalization

Only CLOSED sessions may finalize. The durable admitted roster defines official membership. Existing PRESENT/EXCUSED records are preserved; unmarked roster members become ABSENT, with per-record history. Session state changes to FINALIZED only in the same committed transaction as all required records, history and audit. Empty rosters finalize with no invented marks and N/A percentage. Failure rolls everything back.

The implementation supports up to 2,000 admitted members per session with an atomic transaction and validates oversized cohorts before official publication. The 120-member fixture is tested. Actual Atlas latency/timeouts and production load remain unverified; larger transactional volumes require measured sizing or a future resumable/chunked design, not a partial official result.

### I. Corrections and History

A CLOSED unmarked member may be explicitly excused with reason, confirmation and session revision. Present marks are not silently changed before finalization. After FINALIZED, an authorized correction can change among PRESENT, ABSENT and EXCUSED, requiring reason, confirmation, session revision and record revision. Identity/Batch/session relationships are immutable. Same-status and stale corrections fail.

History preserves previous/new status, actor ID/name, reason and timestamp. Completed/archived Batches permit reasoned historical corrections by a currently authorized staff member in an ACTIVE College; current learning eligibility is not granted by that exception. Ordinary scanning/opening/finalization still require an ACTIVE eligible Batch. Append-only history and roster ODM guards prohibit updates/deletes; raw privileged database access can bypass application guards and must be restricted.

### J. Student Attendance

An active canonical STUDENT account may read only attendance linked to its own canonical profile and roster anchors. Before finalization, current effective enrollment remains mandatory; unmarked is not official absent. Finalized self-history stays available after Batch completion, enrollment withdrawal, roll/College changes or Course archival, without granting access to private learning content or other members. Suspended/archived accounts cannot use the exception.

The Student history hub discovers their original Batch associations from durable roster anchors. Session history is paginated in MongoDB with a self-only roster lookup; it does not impose the report session-count limit on long Batch histories. Individual record reads use the session/profile compound identity. No Student marking/correction/export/foreign-roster endpoint exists.

### K. Reports and Exports

College/Course/Batch selection is scoped through the staff Batch hub. Per-Batch reports filter Learning Day, Morning/Afternoon, session state, Student roll/name and date range. Dates are explicitly session creation dates in UTC. Views include session roster/counts, Student summaries/history, Batch totals, Morning/Afternoon comparison and day totals.

Official percentage is PRESENT / (PRESENT + ABSENT) × 100, rounded to two decimals, using finalized rows only. EXCUSED is excluded; zero denominator is null/N/A. OPEN, DRAFT and unfinalized CLOSED records never create official absence or inflate the denominator.

CSV/XLSX support Session, Batch and Student scopes. Exports contain roll/name, College/Course/Batch, day/session/state/status, marked/finalized times and official counts/percentage. CSV quotes delimiters/newlines and neutralizes formula prefixes; XLSX cells are explicit strings, never formula objects. QR material and Google identity identifiers are excluded. Current authority is rechecked and locked; export audit shares its transaction. The export is a confirmed CSRF-protected POST, then a private browser Blob download with URL revocation. No public file or cloud upload is created.

Reports are limited to 1,000 selected sessions and 10,000 selected detail rows; exports have the same row bound. Oversized requests fail with a filter/refinement error. UI tables are paginated, and day filter choices have their own pagination.

### L. Permissions and Security

The existing reserved attendance.manage permission is now enforced for staff reads and writes, together with current college.view and ACTIVE assignment/College scope. Optional attendance.view was not introduced: this phase uses the stricter attendance.manage policy throughout. Existing grants are not automatically expanded. Super Admin uses existing global authority and respects all content/history constraints.

Attendance inherits HttpOnly sessions, exact-Origin/CSRF checks, strict schemas, safe envelopes and no-store. The global IP limiter permits up to 480 attendance requests/minute while retaining existing limits elsewhere; attendance also has an authenticated-user limit of 600/minute. This accommodates scan/roster traffic without removing the unauthenticated IP bound. The existing limiter store is process-local; scaled deployments require shared enforcement.

A permanent QR is a bearer credential. A copied screenshot can be presented by someone else. Authorized scanning, current eligibility, session age/state, duplicates, auditing and rotation reduce abuse; they do not independently prove physical presence or prevent screenshot sharing. There is no public QR resolution, dynamic identity replacement or Student self-attendance.

### M. Database Models and Indexes

| Model | Constraints/indexes |
| --- | --- |
| AttendanceSession | unique Batch/LearningDay/type; Batch/status; College/status; LearningDay/type; guarded revision/state transitions |
| AttendanceRecord | unique session/profile; session/status; profile/session; immutable identity; guarded finalized corrections |
| AttendanceRosterSnapshot | unique session/profile; session/enrollment; session/roll; profile/session; append-only rows |
| AttendanceHistory | session/time; record/time; actor/time; append-only events |
| Existing QR/profile/enrollment | existing canonical identity reused; internal attendance lock counters serialize concurrent changes |

Session metadata snapshots preserve original College/Course/Batch/day labels and pinned revision. Once any attendance session exists, Phase 6 curriculum replacement is blocked, including otherwise-reviewed active upgrades; there is no silent day mapping or migration. Readiness initializes all new indexes. Tests of schemas and query guards do not prove actual Atlas index enforcement or write-conflict behavior.

### N. API Endpoints

All paths use /api/v1, session auth and no-store. All mutations require exact Origin/CSRF and strict bodies; list queries are bounded. Staff paths require current attendance.manage/College visibility; Student paths are self-only.

| Method/path | Contract |
| --- | --- |
| GET /attendance/batches | Authorized Batch selection; College/Course/search/pagination |
| GET /batches/:batchId/attendance | Pinned day cards and real session counts |
| POST /batches/:batchId/attendance/sessions | learningDayId + MORNING/AFTERNOON; creates DRAFT |
| GET .../sessions/:sessionId | Scoped session metadata/counts |
| POST .../sessions/:sessionId/open | expectedRevision + confirmed + reason; captures roster |
| POST .../sessions/:sessionId/close | Stops scanning |
| POST .../sessions/:sessionId/reopen | Reviewed CLOSED reopening |
| POST .../sessions/:sessionId/finalize | Reviewed CLOSED official finalization |
| POST .../sessions/:sessionId/scan | credential only; current staff session and eligibility |
| GET .../sessions/:sessionId/roster | Search/status/pagination; unmarked remains distinct |
| GET .../sessions/:sessionId/roster/refresh-preview | Current additive roster impact and digest |
| POST .../sessions/:sessionId/roster/refresh | Expected session revision, digest, reason, confirmation |
| POST .../sessions/:sessionId/roster/:profileId/excuse | CLOSED unmarked roster member; reasoned admission-row-bound exception |
| POST .../sessions/:sessionId/records/:recordId/correct | Finalized record status, expected session/record revisions, reason, confirmation |
| GET .../sessions/:sessionId/history | Paginated immutable event history |
| GET /batches/:batchId/attendance/reports | Scoped filtered rows/summaries/comparisons |
| POST /batches/:batchId/attendance/export | CSV/XLSX + scope/filters + confirmed; audited private download |
| GET /students/me/attendance/batches | Self-only historical Batch discovery |
| GET /students/me/batches/:batchId/attendance | Self-only current/past attendance |

No export GET mutates audit state, no QR appears in URL paths, and no arbitrary session/record update endpoint exists.

### O. Audit Logging

Nine audit actions cover session creation/opening/closing/reopening/finalization, QR marks, roster refresh, record corrections and report exports. Session-level history and per-member mark/absence/correction history retain sanitized transition context. Duplicate frames do not emit duplicate mark/history events. Audit failures abort critical changes. Export audit targets the Batch; session mutations target their AttendanceSession. Neither logs nor audit contain raw QR, hashes, encrypted material, full request bodies or private exports.

### P. Environment Variables

No new secret or environment variable is required. Existing backend names remain MONGODB_URI, NODE_ENV, PORT, FRONTEND_URL, CORS_ORIGINS, TRUST_PROXY_HOPS, LOG_LEVEL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and SESSION_TTL. Existing QR_ACTIVE_KEY_ID/QR_ENCRYPTION_KEYS remain necessary for QR issuance/reveal, but scanning performs hash lookup without decrypting credentials. Frontend uses BACKEND_API_BASE_URL and NEXT_PUBLIC_API_BASE_URL; RUN_CONNECTIVITY_TEST opts into the live client health test. No raw environment values or real credentials were introduced.

### Q. Testing Results

| Check | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS | PASS |
| npm run lint | PASS, no warnings | PASS, no warnings |
| npm run typecheck | PASS | PASS |
| npm test | PASS: 445 tests / 23 files, --maxWorkers=2 --testTimeout=20000 | PASS: 170 tests / 16 passing files; one optional test skipped, --maxWorkers=1 --testTimeout=20000 |
| Optional real client health | Compiled API listener | PASS: one separately executed health test |
| npm run build | PASS | PASS with documented local API transport settings; decoder prebuild succeeded |
| npm audit | PASS: zero vulnerabilities | PASS: zero vulnerabilities |

**616 distinct tests passed: 445 backend + 171 frontend (170 standard + one separately executed live health test).** This includes all prior-phase regressions and 128 new Phase 7 tests. A skipped optional test is not counted as passed in the standard run; it was executed separately against the real compiled API listener.

The production HTTP smoke passed: API liveness 200; readiness 503 while storage is unconfigured; private staff/Student attendance APIs 401/no-store; built frontend API rewrite works; protected Admin/Super Admin attendance, scanner and Student history routes redirect 307 to login without a session. The same-origin decoder returned 200 with the valid WebAssembly module signature. Temporary listeners were closed. This does not establish a real authenticated camera or Atlas pass.

Full test coverage includes fresh QR/enrollment/role/College checks, rotation, duplicates, simultaneous scan/close/finalize/correction operations, roster admission/refresh, immutable identities, audit/history rollback, 120-member finalization, completed-Batch self history, CSV injection/XLSX string cells, scoped HTTP/CSRF, repository session/version locks, database-paginated self queries, report bounds, camera lifecycle/device selection, malformed/duplicate/closed-session feedback, staff-session age renewal and protected routes.

No tests were deleted or disabled to obtain these results. Real MongoDB and physical-camera validation remain explicitly blocked/unexecuted. Final Git/privacy review: 269 eligible source/config/test files scanned with no credential-pattern, private-path, generated-artifact or unexpected-Markdown findings; git diff --check passes. README.md is the only tracked Markdown document. No Phase 7 files are staged or committed. Local HEAD and remote main remain 9a11e572cb53a2c35720879d89769cb9e3dbb6fe; all Phase 7 changes remain local.

Test storage and camera doubles exist only in test files and dependency injection. Production always uses MongoDB and actual browser camera APIs. Earlier fixture failures were corrected to use valid names under the existing registration schema; two Student UI assertions were corrected for the existing human-readable lowercase status component. No validation was weakened, no test was deleted and no production success was fabricated.

### R. Known Issues and Blockers

- BLOCKED: real Atlas connection/index creation, persisted snapshots, transaction/write-conflict verification and production throughput. No credentials requested and no production fallback added.
- BLOCKED/NOT TESTED: actual Google login, configured staff grants, real phone/webcam decoding, permission/device behavior and authenticated desktop/mobile visual verification. DOM camera lifecycle tests do not constitute a physical-camera pass.
- The permanent QR screenshot-sharing limitation remains. Human in-person supervision remains necessary; this system does not prove physical presence.
- Atomic roster admission/finalization is bounded to 2,000 members. Reports/exports require narrowing beyond their documented caps. Real transaction timeouts fail atomically; no resumable finalization worker is claimed.
- Staff scanning requires re-sign-in after eight hours from original server session issuance; shorter normal expiry still applies. Current account/grants remain mandatory even within that window.
- Existing Batches require an explicitly assigned published curriculum. Any attendance session prevents curriculum replacement; no automatic migration/mapping is implemented.
- Raw database operators or application code bypassing ODM middleware can violate history constraints. Restrict operational privileges and migration tooling; indexes alone cannot enforce full immutability.
- Distributed rate limiting, production camera HTTPS/CSP/device validation and export performance remain deployment acceptance gates. No automatic deployment was performed.

### S. Files Created or Modified

Backend additions: attendance/contracts.ts, repository.ts, service.ts, router.ts; models/attendance.ts; test-only attendance fixture/setup and service/concurrency/repository tests. Existing app/database readiness, audit enums/targets, LearningService transaction-aware authority, profile/credential/enrollment lock fields, enrollment DTO projection and curriculum replacement guard were extended. Existing auth/QR storage and Course/Batch models were reused.

Frontend additions: attendance contracts, Batch dashboard/hub, roster review, scanner/camera, reports, Student views, shared counts, responsive styles, twelve protected pages and three test files. Existing staff/Student navigation, Batch/Curriculum links, audit filter, API timeouts for bounded long operations and CSS imports were updated. Package manifest/lockfile add the scanner dependency and prebuild/predev decoder-copy script. .gitignore excludes generated decoder assets. README is the only tracked Markdown; this complete local report is ignored.

### T. Acceptance Criteria

| # | Criterion | Status / evidence |
| --- | --- | --- |
| 1 | Existing QR credentials reused | PASS — implemented with the local evidence described above |
| 2 | Morning/Afternoon sessions | PASS — implemented with the local evidence described above |
| 3 | AttendanceSession model | PASS — implemented with the local evidence described above |
| 4 | AttendanceRecord model | PASS — implemented with the local evidence described above |
| 5 | Immutable roster snapshot | PASS — implemented with the local evidence described above |
| 6 | Session lifecycle | PASS — implemented with the local evidence described above |
| 7 | Continuous camera scanning | BLOCKED for physical-device acceptance; implementation and camera lifecycle/continuous-flow DOM tests PASS |
| 8 | Secure QR resolution | PASS — implemented with the local evidence described above |
| 9 | Verification/enrollment checks | PASS — implemented with the local evidence described above |
| 10 | Idempotent duplicate scans | PASS — implemented with the local evidence described above |
| 11 | Draft attendance does not mark absence | PASS — implemented with the local evidence described above |
| 12 | Finalization creates official absence | PASS — implemented with the local evidence described above |
| 13 | Corrections preserve history | PASS — implemented with the local evidence described above |
| 14 | Curriculum changes cannot rewrite attendance | PASS — implemented with the local evidence described above |
| 15 | Admin dashboard | PASS in DOM, route and build checks; authenticated visual acceptance BLOCKED |
| 16 | Scanner interface | PASS in DOM, route and build checks; authenticated visual acceptance BLOCKED |
| 17 | Roster review | PASS in DOM, route and build checks; authenticated visual acceptance BLOCKED |
| 18 | Student own attendance/history | PASS in DOM, route and build checks; authenticated visual acceptance BLOCKED |
| 19 | Reports | PASS in DOM, route and build checks; authenticated visual acceptance BLOCKED |
| 20 | CSV exports | PASS — implemented with the local evidence described above |
| 21 | XLSX exports | PASS — implemented with the local evidence described above |
| 22 | Super Admin oversight | PASS — implemented with the local evidence described above |
| 23 | College-scoped permissions | PASS — implemented with the local evidence described above |
| 24 | Transactional audit events | PASS — implemented with the local evidence described above |
| 25 | Concurrent operations | PASS locally through race/lock contracts; actual Atlas concurrency BLOCKED |
| 26 | Automated tests | PASS — 616 distinct tests |
| 27 | Lint/typecheck/build | PASS — both applications |
| 28 | No production fake behavior | PASS — implemented with the local evidence described above |
| 29 | Phase 8 not implemented | PASS — implemented with the local evidence described above |
| 30 | Phases 1–6 pushed before Phase 7 | PASS — verified shared-repository commit 9a11e572cb53a2c35720879d89769cb9e3dbb6fe before Phase 7 source edits |

PASS refers to the stated implementation and local automated evidence. Blocked live integration and untested physical devices are never represented as verified production behavior.

### U. Phase 8 Readiness

Phase 7 is ready for user review with explicit live-integration gates. Before production attendance, validate real Atlas indexes/transactions and load, configure Google/staff authority and existing QR issuance, verify real HTTPS camera behavior on target phones/browsers, and complete authenticated responsive/export workflows. Phases 1–6 were pushed before this implementation; Phase 7 remains uncommitted/unpushed. Phase 8 has not started. No verified coding progress, submissions, code execution, payments, certificates, AI tutoring or chat was added.


## Phase 8 — Verified coding progress tracking

Historical base Phase 8 implementation record dated 2026-11-14. The enhancement section below extends this implementation and supersedes its page-only export limitation; Phases 1–7 above are historical snapshots. Phase 8 is local, uncommitted and unpushed. Phase 9 and deployment have not been started.

### A. Phase 7 GitHub push verification

- One repository, two independent applications; branch `main`; existing remote [Algora repository](https://github.com/manchikanti-varun/algora).
- Previous Phase 6 commit: `9a11e572cb53a2c35720879d89769cb9e3dbb6fe`.
- Phase 7 commit: [`2894b056f41d6fcb9e153b3e14a0644071a84540`](https://github.com/manchikanti-varun/algora/commit/2894b056f41d6fcb9e153b3e14a0644071a84540), `feat: implement phase 7 QR attendance management`.
- Push succeeded; an independent `git ls-remote origin refs/heads/main` matched local HEAD. Working tree was clean before Phase 8 began.
- Pre-push checks passed: backend 445 tests; frontend 170 ordinary tests plus one separately enabled real local API health test; 616 distinct tests total. Both apps passed formatting, lint, types, production builds and audits with zero vulnerabilities. Local production HTTP boundaries, readiness failure without storage, protected redirects and same-origin decoder delivery passed.
- Reviewed six existing commits and the 60 intended staged Phase 7 files. Credential/private-file scans and staged diff checks found no findings. Generated assets, credentials and other Markdown were excluded. No history rewriting, remote changes, nested repositories or automatic deployment occurred.

### B. Phase 8 summary

Implemented account management, official Codeforces ownership and submission adapters, immutable submission evidence, membership-scoped progress, durable MongoDB jobs/checkpoints, shared provider reservations, current-eligibility reconciliation, Student dashboards and Learning Day badges, College-scoped staff matrices, problem analytics and private paginated CSV/XLSX reports. Other providers deliberately remain unavailable instead of producing unverified achievements.

Local implementation is reviewable. Live acceptance remains **BLOCKED** by unconfigured MongoDB and Codeforces application configuration. No production credential, account login, Atlas connection or external ownership claim was used during implementation.

### C. Platform feasibility matrix

| Platform | Permitted integration established | Ownership | Evidence and canonical matching | Current acceptance |
| --- | --- | --- | --- | --- |
| Codeforces | Official public `user.info` and paginated `user.status` APIs | Official OIDC authorization-code integration implemented; requires an operator-configured application | Exact contest/index, individual current author handle, final known verdict, authoritative Unix timestamp; ambiguous/team/ghost/problemset records rejected | **SUPPORTED in code; BLOCKED live**. Public history and bounded backfill are **LIMITED**, never a promise of private history. |
| LeetCode | No approved authoritative submissions integration configured | No sufficient permitted ownership proof configured | Undocumented/recent-only public mechanisms cannot establish complete, attributable history here; no scraping or cookie-based adapter enabled | **UNAVAILABLE**. Declared handles remain unverified; unavailable coverage is explicit. |
| CodeChef | No current approved ownership-plus-submission integration established | No sufficient permitted ownership proof configured | No HTML scraping or unsupported inference from problem lists, ranks, ratings, screenshots or totals | **UNAVAILABLE**. Linking a handle does not create trusted progress. |

Research used primary sources: [Codeforces API introduction/rate policy](https://codeforces.com/apiHelp), [methods](https://codeforces.com/apiHelp/methods), [submission/user object contracts](https://codeforces.com/apiHelp/objects), [official OIDC announcement](https://codeforces.com/blog/entry/145566) and [live OIDC metadata](https://codeforces.com/.well-known/openid-configuration). The integration pins the advertised issuer/endpoints, code flow, client-secret-post authentication and HS256 ID-token algorithm. No undocumented PKCE support is assumed. [LeetCode terms](https://leetcode.com/terms/) and [CodeChef terms](https://www.codechef.com/terms) restrict scraping; no bypass is attempted. Capability assessments are scoped to these sources and configured permissions, not a claim that either platform can never offer another permitted integration.

### D. Account ownership verification

- Profile username declarations from Phase 4 do not become verified coding accounts automatically. Link/replace requires a strict platform/handle contract, expected revision and confirmation.
- Codeforces initiation is an authenticated CSRF-protected POST. The backend creates a high-entropy, five-minute state bound to the canonical Student, exact Algora session token hash and coding-account revision. State is hashed in storage and consumed once before exchanging a code. A rotated/different session, expired/replayed state, changed handle or changed revision fails closed.
- The backend exchanges the code only at the fixed HTTPS token endpoint. It independently validates the HS256 signature with timing-safe comparison, exact issuer/audience/nonce, bounded issue time, expiry, subject and handle. A bounded official current-handle lookup captures a registration-time fingerprint; subsequent syncs recheck it without historic-handle alias resolution.
- Only subject/handle, verification timestamps, fingerprint and a proof digest are retained. Access tokens, refresh tokens, raw ID tokens, codes and provider cookies are never persisted or returned to the browser. Transient OAuth state has a TTL index and explicit expiry checks.
- Proof expires after 30 days. Replacement/reverification increments the binding revision; disconnect/reassignment suspends current attribution and retains immutable historical evidence. Duplicate active trusted subject or normalized handle bindings are rejected by partial unique indexes. There is no Admin “mark verified” shortcut or silent account transfer.
- Ownership is a time-bounded attestation. Public submission APIs do not expose the OIDC subject on every submission; the current-handle/fingerprint check supplements the verified binding, not a claim of perpetual identity. Reverification and dispute recovery must remain explicit.

### E. Backend architecture

`src/coding/` contains strict contracts, ownership validation, provider adapters, a MongoDB repository, reconciliation/report services, authenticated routes and a readiness-gated worker. It composes the existing Curriculum/Learning/Student/Administration units using the same transaction session. Production has no in-memory queue or repository fallback. Test-only repositories live under `src/tests/`.

Models: `StudentCodingAccount`, `CodingOAuthState`, `SubmissionEvidence`, `StudentProblemProgress`, `CodingSyncJob` and `CodingProviderControl`. Storage readiness includes successful coding index/control initialization. The existing startup/shutdown lifecycle starts/stops the optional worker; leased work survives an interrupted process.

New Batch activations persist an actual UTC `startedAt`. Date-only planned dates are not silently converted into invented start instants. Existing active Batches without an actual timestamp remain unavailable for attribution; no unverified backfill migration or timestamp-correction bypass was added.

### F. Provider adapters

All outbound destinations are fixed official HTTPS endpoints. Handles/cursors are validated; redirects are rejected; timeouts and streamed response-size limits apply. Adapters retain bounded normalized provenance, never submitted source code or raw provider bodies. Unknown/malformed/pending/ambiguous evidence results in partial coverage or a sanitized failure, not acceptance. Unavailable providers have explicit adapters that fail closed.

### G. Codeforces integration

Requests use public `user.info` with current-handle matching and `user.status` pages of at most 100 submissions. Source-code inclusion and privileged API authentication are not requested. Problem matching uses the exact assigned frozen platform/problem identity, not titles, URLs supplied by Students, ratings or total-solved counts. Only final `OK` records qualify as accepted; known unsuccessful final verdicts establish attempts. Missing timestamps, unsupported problemset identities, pretests, pending/unknown verdicts, teams, ghosts and wrong authors are excluded and flagged as partial. No unsupported private/Gym identity is guessed.

The official limit is one API request per two seconds. The shared MongoDB provider lease uses database server time and reserves at least three seconds between requests, including identity checks. Each identity/submission pair waits between requests. HTTP 429 produces a bounded shared Retry-After cooldown; other provider failures open a temporary shared cooldown. This guarantee requires all application workers to share the same control collection and operationally exclusive API budget; unrelated applications using the same egress are outside this process's coordination.

### H. LeetCode integration

Account declarations and capability messaging are implemented, but trusted ownership/submission ingestion is unavailable. No unofficial GraphQL success, recent acceptance list, screenshot or self-reported submission ID is promoted to a solve. The denominator still includes assigned LeetCode problems, with unavailable verification shown separately. Enabling future support requires a permitted authoritative source and defensible ownership proof, followed by live contract/coverage tests.

### I. CodeChef integration

The adapter explicitly returns unavailable until a permitted current integration establishes both ownership and submission provenance. No crawling, anti-bot bypass, passwords, session cookies or solved-total inference is used. Historical developer-site/API references alone are not treated as proof of current permitted access.

### J. Submission evidence

Evidence stores provider submission ID, exact canonical problem, platform, verified account/revision, Student profile, Batch, curriculum revision, enrollment, stable assignment identity, author handle, final verdict, language, submitted/fetched UTC timestamps, source URL/type, confidence, normalized-response digest and adapter version. It contains no source code or provider/session credentials.

Evidence IDs/deduplication are deterministic across refetches and scoped to the binding revision, membership era and assignment. The same submission may independently support the same canonical problem in separate eligible Batches or Learning Days. Application-level immutable schema guards reject update/delete/replacement capabilities; the repository exposes guarded append/upsert only. Database operators retain their normal direct database powers.

Large expansions retain the earliest qualifying attempt/acceptance necessary for each problem rather than archiving every equivalent submission. At most 100 evidence/progress attributions are reconciled per transaction; unchanged progress is skipped on a resumed wide page. The durable job retains its provider offset until that page's reconciliation can advance. This is a bounded evidence store, not a complete provider submission archive.

### K. Progress reconciliation

Stable assignment identity derives from curriculum revision, frozen Learning Day ID and canonical problem ID. Progress uniqueness additionally includes Student profile, Batch and enrollment ID. The threshold is `max(actual Batch startedAt, current enrollment activatedAt)`, using provider submission time rather than fetch time. Missing authoritative activation timestamps block attribution. Solving on a different Learning Day is allowed; pre-Batch/pre-enrollment solves do not count.

Progress states: `NOT_STARTED`, `ATTEMPTED_VERIFIED`, `SOLVED_VERIFIED`, `VERIFICATION_UNAVAILABLE`. Sync health is separate: never checked, queued/running, success/partial, rate limited, failed or provider unavailable. NOT_STARTED requires adequate complete checked public history; partial/pending history remains unavailable. This does not claim knowledge of private or hidden submissions.

Failures, later unsuccessful attempts, empty responses and removed/hidden public submissions do not erase recorded accepted evidence. Accepted status is an as-captured verified achievement; no automatic destructive rejudge policy was invented. Ownership revocation/expiry/replacement suspends current attribution while retaining historic evidence. A fresh verified binding must resync before current attribution returns. Re-enrollment uses its own activation/enrollment identity, never the previous membership's progress.

Current Student reads require fresh effective enrollment; completed-Batch history is limited to the same verified Student/current College and an actual historical activated enrollment. This does not reopen learning content or permit refreshes on completed Batches. Changed College/profile/role/status or withdrawn active-Batch enrollment blocks current access. Staff reads use current College grants. Published revision replacement is blocked once coding sync/progress or attendance exists; no silent migration detaches evidence from its assignment.

### L. Synchronization jobs

MongoDB owns queue state, cursors, due times, active-job deduplication, leases/fencing tokens, retries, coverage and provider reservations. States: QUEUED, RUNNING, SUCCEEDED, PARTIAL, RETRY_WAIT, FAILED, CANCELLED. Atomic claims recover expired leases; stale workers cannot commit another token's work. Evidence, progress, completion/checkpoint and critical audit writes share snapshot/majority transactions. Network calls occur outside transactions, followed by canonical ownership/enrollment/College/actor/grant/revision revalidation and conflict-producing locks before attribution.

Bounds: 1,000 active queued jobs; one active account/Batch job; per-account/Batch manual cooldown; 60-second job lease; 30-second provider lease; 100 submissions per API page; 100 reconciled attributions per transaction; five bounded page/work passes per job; at most 12 claims and five transient-provider retries; capped exponential backoff with jitter. Provider cursors continue through subsequent partial jobs; incomplete scans never become conclusive negative progress. A terminal scan resets to the head for future fresh checks. Offset pagination is public-provider coverage, not an immutable snapshot; wide/backfilled scans conservatively remain partial where completeness is uncertain.

Automatic scheduling is opt-in, bounded to ten due accounts per scheduler pass and twenty enrollment candidates per account; it uses the same queue, eligibility, permissions, deduplication and rate budget as manual requests. Manual staff batch refresh handles one roster page and reports queued/skipped outcomes. Larger membership discovery remains explicitly bounded and requires later scheduling/operational review; no unbounded fan-out occurs. Sync health exposes failure/partial information without raw responses. Worker shutdown stops new claims; interrupted leases recover after restart.

### M. Student UI

Added `/student/coding-accounts`, `/student/progress` and `/student/batches/[batchId]/progress`, all protected on the server and using the existing role shell, theme and accessible controls. Platform cards distinguish linking, ownership, proof expiry and sync health; unsupported platforms and disabled background synchronization have explicit notices. Replacement/disconnect explain suspended attribution.

Batch dashboards include Course/Batch selection, assigned/solved/attempted/unavailable/coverage counts, whole-curriculum completion denominator, platform/Day summaries, filters, pagination, queued refresh, sync history and evidence provenance. Existing Learning Day problem cards display verified badges through a shared bounded Day query; instructor previews do not fetch Student data. Opening an external problem is not a solve. No checkboxes, optimistic solve toggles or fabricated charts were added.

### N. Admin UI

Admin and Super Admin navigation includes Coding Progress and Progress Reports. College/Course selection lists only authorized Batches. Batch matrices paginate the roster and assignments separately, expose current unavailable coverage, and show Student-specific evidence/jobs with permission-checked refresh. Filters cover Student, problem, platform, Learning Day, progress state, ownership and UTC submission date. Filtered exports use the selected roster page and matching assignment counts; primary dashboard completion continues to use the whole released curriculum denominator.

Problem-wise analytics aggregates currently eligible Batch members with a 2,000-member cap and paginated problems; platform and Learning Day filters are explicit. CSV/XLSX downloads are private, bounded, formula-safe and audited. No cross-College automatic grants or fabricated rankings were introduced. Real authenticated desktop/mobile/device/Atlas performance acceptance remains unverified.

### O. API contracts

Paths below are relative to `/api/v1`. All coding/progress responses are private/no-store; all mutations require the existing exact Origin and session-bound CSRF token. JSON inputs/queries are strict Zod contracts with bounded IDs, handles, filters and pagination.

| Method | Endpoint | Contract / authority |
| --- | --- | --- |
| GET | `/coding/accounts` | Current verified Student; own sanitized accounts/capabilities/worker status |
| POST | `/coding/accounts` | Own platform/handle, expected revision or null, explicit confirmation |
| POST | `/coding/accounts/:accountId/disconnect` | Own account, expected revision, confirmation |
| POST | `/coding/accounts/:accountId/verify` | Own active Codeforces account/revision; returns fixed authorization URL |
| GET | `/coding/accounts/codeforces/callback` | Existing same Algora session; one-use state/code; fixed destination redirect |
| GET | `/students/me/progress/batches` | Paginated own current/eligible completed Batch history |
| GET | `/students/me/batches/:batchId/progress` | Own current or policy-allowed completed progress; bounded filters |
| GET | `/students/me/batches/:batchId/progress/days/:day` | Fresh effective enrollment; up to 100 released Day assignments for shared badges |
| GET | `/coding/batches` | Current staff College visibility and progress.view; College/Course filters |
| GET | `/batches/:batchId/progress` | College-scoped progress.view; roster/assignment pages and filters |
| GET | `/batches/:batchId/progress/analytics` | Same scoped read authority; bounded eligible-roster problem analytics |
| GET | `/batches/:batchId/progress/assignments/:assignmentId/evidence` | Student self-only or scoped staff read; exact released assignment and enrollment |
| POST | `/batches/:batchId/progress/refresh` | Student self or scoped progress.view + progress.manage staff target; verified owned account |
| POST | `/batches/:batchId/progress/refresh-batch` | Scoped progress.view + progress.manage; one bounded roster page; queued/skipped outcomes |
| POST | `/batches/:batchId/progress/export` | Scoped progress.view; format, bounded filters and confirmation; audited base64 file response |

New backend/frontend permissions are `progress.view` and `progress.manage`, alongside `college.view`. Existing grants are not expanded. A current active verified Super Admin uses platform authority; ordinary staff must hold the actual College grants. Suspended/revoked actors are rechecked before worker attribution. Students cannot choose another profile, upload evidence, set progress or mark ownership verified.

### P. Security

Session authentication, canonical user/role/account checks, self-only Student projections, College scope, fresh effective enrollment, CSRF, exact Origin, input bounds, no-store, sanitized errors and request limits apply throughout. Provider destinations and callback destinations are fixed; no user-controlled URLs or redirects enter fetches. Browser links are schema-validated HTTPS provider links and new tabs isolate their opener. CSV formula prefixes are neutralized; XLSX cells are literal values. Blob URLs are revoked after download.

No passwords, provider cookies, source code, OAuth/session tokens, real environment values or personal email addresses were published. Logs contain sanitized operational events, not provider bodies, state/codes or evidence payloads. HTTP request limiting retains the existing application policy; multi-instance HTTP abuse protection still needs a shared/edge limiter. The new provider API limiter itself is MongoDB-shared.

### Q. Database indexes and transactions

- Account unique Student/platform; partial unique active trusted platform/subject and platform/normalized-handle; due-account scheduling index.
- OAuth state unique hash and TTL expiry.
- Job partial unique active account/Batch, due/lease claim index and Batch/history index.
- Progress unique Student/Batch/curriculum/enrollment/assignment, plus Batch/problem/status reporting index.
- Evidence unique binding revision/provider submission/digest/Batch/enrollment/assignment, plus scoped chronological retrieval.
- Fixed shared provider/queue control IDs; queue admission serialized through the queue control document.
- Index initialization is part of storage readiness. Replica-set transactions use snapshot reads and majority writes; provider reservation time is computed with MongoDB server `$$NOW`/date arithmetic. MongoDB 5+ is required for this control update.

Actual index creation, unique-conflict behavior, replica-set transactions, server-time reservation pipelines and recovery against a real database remain **BLOCKED / NOT EXECUTED**. Mocked repository/query tests establish intended contracts only.

### R. Audit logging

Extended the existing transactional audit registry with CODING_ACCOUNT_LINKED, CODING_ACCOUNT_VERIFIED, CODING_ACCOUNT_REVOKED, CODING_SYNC_QUEUED, CODING_SYNC_FINISHED, CODING_PROGRESS_RECONCILED and CODING_REPORT_EXPORTED. Events use canonical actor/target/College IDs and bounded state/count metadata. Critical account mutations, terminal sync/reconciliation and export authorization are audited without raw proof, handles/provider bodies, secrets or excessive polling logs.

### S. Actual validation results

| Check | Backend | Frontend |
| --- | --- | --- |
| `npm run format` | PASS; final affected files also formatted | PASS |
| `npm run lint` | PASS | PASS |
| `npm run typecheck` | PASS | PASS |
| `npm test` | Full run: **570 passed / 28 files**. Final focused coding run after fixes: **126 passed / 5 files**, including one additional interrupted-stream test. **571 distinct backend tests** passed across these runs. | **190 passed / 17 files**; one opt-in connectivity test skipped in the ordinary run, then **1 passed** separately against the real local API. **191 distinct frontend tests** passed. |
| `npm run build` | PASS, final TypeScript production output | PASS, final Next.js production build including all nine new protected pages |
| `npm audit` | PASS, **0 vulnerabilities** | PASS, **0 vulnerabilities** |

**762 distinct automated tests passed** across final full/focused/live-health runs; repeated tests are not double-counted. Phase 8 adds 126 backend tests and 20 frontend tests to the Phase 7 baseline. Test repositories/providers are controlled fixtures; this total does not establish live external-provider or MongoDB integration.

Final production HTTP smoke: liveness 200, readiness 503 without storage, protected coding/progress APIs 401 with no-store, all nine new protected pages redirect to login, same-origin API rewrites work, and the existing local WASM decoder is delivered correctly. The separately enabled health client passed. Temporary local listeners were closed. No database connection or authenticated provider flow was performed.

Final privacy/publication review: 296 eligible text files scanned; no credential, private environment, generated artifact, personal machine-path or private-address findings after removing public contact metadata from the lockfile. Two existing URL-userinfo attack fixtures were reviewed as URLs rather than personal addresses. Dependency graph/integrity values remain unchanged. README is the only tracked Markdown; the standalone report and test artifacts remain ignored. No Phase 8 files are staged. GitHub main and local HEAD still match the Phase 7 commit.


### T. Environment variable names

New backend variables: `CODEFORCES_CLIENT_ID`, `CODEFORCES_CLIENT_SECRET`, `CODEFORCES_REDIRECT_URI`, `CODING_SYNC_ENABLED`, `CODING_SYNC_INTERVAL_SECONDS`. Existing required names remain `MONGODB_URI`, `FRONTEND_URL`, `CORS_ORIGINS`, `SESSION_TTL`, `NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS`, `LOG_LEVEL`; Google and QR names remain as documented in earlier phases. Frontend continues to use `BACKEND_API_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL`. No new public credential or LeetCode/CodeChef cookie/password variable exists.

Codeforces client settings must be configured together on the backend. Its redirect must exactly equal the frontend origin plus `/backend/coding/accounts/codeforces/callback`. Synchronization is disabled by default and must be explicitly enabled after the database and provider configuration are validated. The sanitized backend environment template documents names only for optional credentials. No production credentials are requested here.

### U. Files and modules

New backend: `src/coding/{contracts,ownership,providers,repository,router,service,worker}.ts`, `src/models/coding.ts`, and `src/tests/coding-{fixtures,http.test,jobs.test,providers.test,repository.test}.ts` plus `coding.test.ts`.

Changed backend: application/startup/database readiness, environment contract/template, permission/audit registries, Batch start timestamp and Learning authority, curriculum replacement safeguards and test fixtures.

New frontend: `src/features/coding/{contracts.ts,accounts.tsx,progress.tsx}`, nine protected Student/Admin/Super Admin route pages, and `src/tests/coding-ui.test.tsx`. Changed navigation shells, cumulative permission contracts, Learning Day cards/content, shared API timeout policy and responsive/theme styles. No new package dependency or generated asset is tracked. A public maintainer contact was removed from dependency deprecation metadata in the backend lockfile; versions, resolved URLs, dependency graph and integrity hashes are unchanged. Existing Git history was not rewritten.

### V. Known issues and blockers

- **Locally tested:** strict contracts, signed proof validation, session/state/revision replay protection, attribution windows, canonical matching, immutable evidence, progress preservation, fake-repository job races/recovery, Mongo query/index contracts, scoped HTTP auth/CSRF/no-store, page bounds, reports and React interactions. Fixtures are explicitly test-only.
- **Live provider tested:** primary documentation/metadata researched. Real OAuth code exchange, actual handle ownership and live submission ingestion were not run; no claim of provider success is based on mocks.
- **MongoDB integration tested:** none. Atlas and a local replica set were not configured or contacted. Database persistence/index/transaction/lease claims are implementation and mock-test results, not live integration acceptance.
- **Not tested:** authenticated browser/device workflows, real consent/callback transport, multi-process crash injection against MongoDB, provider/network timing in production, actual 120-member database performance and deployed cookies. An automated 120-Student/100-assignment fixture checks bounded response/aggregation behavior only.
- **Blocked:** live Codeforces application and database acceptance; missing historical actual Batch activation timestamps; permitted ownership/submission access for LeetCode and CodeChef. Unconfigured/ineligible cases remain unavailable rather than generating achievements.
- **Deliberate limits:** page-based reports instead of an unbounded College dump; 2,000-member analytics cap; 10,000 released assignments; bounded public backfill and scheduler discovery. Retained as-captured acceptance is not a destructive live rejudge verdict service. All application instances must share one database/provider budget. Production HTTP limiting still needs existing shared/edge deployment controls.

### W. Acceptance criteria

Statuses distinguish implemented/tested local behavior from external acceptance; PASS below never substitutes for real MongoDB/provider verification.

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Phase 7 committed/pushed | PASS |
| 2 | Independent remote commit verification | PASS |
| 3 | Existing architecture preserved | PASS |
| 4 | Three platform capability assessments | PASS |
| 5 | Coding account management | PASS locally |
| 6 | Ownership enforcement | PASS locally; Codeforces live BLOCKED |
| 7 | Unverified accounts cannot create achievements | PASS |
| 8 | Official Codeforces API adapter | SUPPORTED in code; live BLOCKED |
| 9 | Honest LeetCode limited-evidence handling | UNAVAILABLE, explicitly represented |
| 10 | Honest CodeChef limitation handling | UNAVAILABLE, explicitly represented |
| 11 | Canonical problem matching | PASS locally |
| 12 | Batch-specific timestamp eligibility | PASS for authoritative timestamps; legacy missing timestamps BLOCKED |
| 13 | SubmissionEvidence model | PASS in code; live persistence BLOCKED |
| 14 | StudentProblemProgress model | PASS in code; live persistence BLOCKED |
| 15 | Durable synchronization jobs | PASS in code/contracts; live database acceptance BLOCKED |
| 16 | Worker concurrency control | PASS in tests; real multi-process database run BLOCKED |
| 17 | Provider rate budget | PASS in contracts/tests; live timing BLOCKED |
| 18 | Retries/checkpoints | PASS locally; bounded public coverage LIMITED |
| 19 | No self-reported verified solves | PASS |
| 20 | Failure preserves verified evidence | PASS locally |
| 21 | Student dashboard | PASS in component/HTTP tests; authenticated live acceptance BLOCKED |
| 22 | Learning Day progress | PASS in code; authenticated live acceptance BLOCKED |
| 23 | Admin Batch progress | PASS locally; real database/device acceptance BLOCKED |
| 24 | Problem-wise analytics | PASS locally within bounds; production performance BLOCKED |
| 25 | Reports | PASS locally; paginated scope LIMITED |
| 26 | CSV/XLSX exports | PASS locally |
| 27 | College-scoped authorization | PASS locally |
| 28 | Audit logging | PASS locally; database durability BLOCKED |
| 29 | Automated tests | PASS — 762 distinct tests across final runs |
| 30 | Formatting/lint/types/build/audit | PASS — both apps; audits 0 vulnerabilities |
| 31 | No production fake data | PASS |
| 32 | Phase 9 not implemented | PASS |
| 33 | Phase 8 uncommitted/unpushed | PASS — HEAD/remote unchanged; no staged Phase 8 files |

### X. Phase 9 readiness

The evidence, assignment/membership identities, status/coverage separation, scoped queries and private report contracts provide a foundation for later analytics. Before production or claiming full external acceptance, configure and validate the authorized MongoDB replica set/indexes and Codeforces client, exercise real ownership/submission/cookie flows, confirm the shared provider budget, review legacy missing timestamps and load-test authenticated reports. LeetCode/CodeChef coverage remains unavailable unless a permitted authoritative integration is established.

Phase 9 has not been started. Phase 8 remains local for review; no commit, push or deployment is performed for this phase.

## Phase 8 enhancements — Complete reports and registration

Historical enhancement handoff dated 2026-11-14. The delivery record below supersedes its local-only Git status. This extends the original Phase 8 implementation above; it does not restart Phase 8 or implement Phase 9. The original page-only export limitation and registration year defaults are superseded by this section. All work remains local, uncommitted and unpushed.

### A. Existing repository state

Inspected the single repository on `main`, with frontend/backend applications and existing uncommitted Phase 8 changes. HEAD remains Phase 7 commit `2894b056f41d6fcb9e153b3e14a0644071a84540`. The existing remote is [Algora on GitHub](https://github.com/manchikanti-varun/algora). Saved a local ignored pre-enhancement status snapshot. No reset, checkout, history rewrite, staging, commit, push or deployment was performed. Existing Phase 8 files and relationships were retained.

### B. Scope and preserved behavior

Added complete bounded report downloads and registration/profile improvements only. Existing provider adapters, Codeforces ownership, attribution windows, immutable evidence, durable synchronization, College grants, Student IDs, usernames, roll numbers, enrollment IDs, attendance and permanent QR behavior remain in place. No provider access, unofficial scraping, new College creation workflow or Phase 9 feature was added.

### C. Report architecture

The existing coding export endpoint and `CodingService.exported` remain the entry point. Exports now traverse every matching roster page in bounded 50-member chunks and reuse the existing progress projection for released canonical assignments. Display page/page-size/assignment-page do not restrict export coverage. The existing permission, evidence and ownership logic is reused; reporting does not invent accepted submissions or change progress states.

`coding/reports.ts` defines strict report contracts, counting, CSV serialization and ExcelJS workbook formatting. No parallel report database, public file service or unbounded export queue was created. Limits are 2,000 scanned roster members, 20,000 matching Student/assignment rows and 10 MiB per prepared file. Exact Student or full-roll filters permit a narrowly scoped lookup. Oversized datasets return `EXPORT_TOO_LARGE` with refinement guidance; no first-page fallback or silent truncation occurs. Output remains in bounded process memory; no sensitive temporary file or public URL is created.

### D. Download types

| Selector | API value | Excel output | CSV output |
| --- | --- | --- | --- |
| Day-wise | DAY | Student/Day counts for the selected Learning Day | Flat Student/Day rows; a Day is required |
| Problem-wise | PROBLEM | One aggregate row per canonical assignment; optional Detailed Progress sheet | Aggregates, or a flat Student/problem breakdown when explicitly selected |
| Student-wise | STUDENT | Student totals plus Detailed Progress with one row per Student/assignment | Flat Student/assignment rows |
| Batch-wise | BATCH | Summary, Day-wise Progress, Platform Progress and Problem-wise Progress | Flat OVERALL/DAY/PLATFORM/PROBLEM records with numeric counts and percentages |
| Complete Batch | COMPLETE | Exactly the five sheets listed below | One documented flat Detailed Progress schema covering every matching assignment row |

College, Course and Batch metadata are resolved from canonical relationships/assigned Batch context, never Student-supplied College names. Filenames use a bounded sanitized Batch component, report type/Day and the actual extension. Old clients may omit reportType and receive the compatible Student report, now across all matching pages.

### E. Excel workbook

Complete Batch contains exactly:

1. **Summary:** canonical College/Course/Batch, UTC export time, matching eligible Students, distinct assignments, Student × assignment opportunities, solved/attempted/checked-no-solve/unavailable totals, completion/coverage and Day/platform summary counts.
2. **Student Progress:** one row per matching Student; roll, name, canonical College/Course/Batch, numeric Year or missing placeholder, assigned problems, all progress counts, completion/coverage and latest relevant successful sync.
3. **Day-wise Progress:** one row per Student/Day; academic/context fields, assigned problems, progress counts, completion/coverage and latest relevant successful sync.
4. **Problem-wise Progress:** one row per stable assigned-problem identity, including Day, title, platform, difficulty, canonical identifier, eligible Student count, all verified/unavailable counts, completion and coverage. Identical canonical problems on different Days remain distinct assignments.
5. **Detailed Progress:** one row per Student/assignment; roll, name, Year, Day, title, platform, difficulty, canonical/assignment identity, progress and external account verification state, accepted timestamp, evidence reference and last/last-successful sync.

Worksheets have descriptive names, navy/white bold headers, column widths, frozen header rows and auto filters. Summary totals are bold. Counts/Years are numeric; percentages are numeric fractions formatted as percentages. UTC dates are actual Excel date values with consistent UTC-labelled formatting. Missing Years use Not provided; absent timestamps/evidence and zero-denominator percentages use N/A. User/provider text is literal and formula prefixes are neutralized.

### F. CSV implementation

CSV is UTF-8 with BOM, quoted fields, escaped quotes and CRLF records. Dates are ISO UTC. Percent columns use numeric percentage values; N/A replaces missing/zero-denominator values. Formula prefixes, including whitespace followed by spreadsheet operators, are escaped. XLSX values are literal cells, never user-controlled formula objects.

Complete Batch and Student CSV columns are: College, Course, Batch, Roll number, Student, Year of Study, Learning Day, Problem, Platform, Difficulty, Canonical problem identifier, Assignment identity, Progress status, External account verification status, Accepted submission timestamp, Evidence reference, Last synchronization, Last successful synchronization. CSV has no worksheets. Batch CSV uses explicit record types for overall/Day/platform/problem aggregates instead of pretending to be a workbook.

### G. Cross-page verification

The automated Complete Batch fixture uses **120 eligible Students × 100 assignments = 12,000 detailed rows** while requesting display page 4, display page size 1 and assignment page 8. The decoded workbook is checked for all 120 distinct roll numbers, 12,001 rows including the Detailed Progress header, 121 Student Progress rows, all five sheets, correct eligible/opportunity counts and formatting. This verifies roster and assignment coverage across display pagination; it is an isolated test fixture, not a live database load test.

### H. Counting rules

- Verified solved counts only SOLVED_VERIFIED.
- Verified attempted counts only ATTEMPTED_VERIFIED and excludes already solved rows.
- **No verified solve (checked)** counts NOT_STARTED plus ATTEMPTED_VERIFIED. Attempted is a subset of this checked count.
- VERIFICATION_UNAVAILABLE is separate, never converted to NOT_STARTED. The report never states that a Student did not solve a problem.
- Completion = verified solved / matching assigned opportunities. Student/Student-Day denominators are that Student's matching assigned problems; population totals use matching Student × assignment opportunities. Distinct assigned-problem count is shown separately and is not substituted for the opportunity denominator.
- Coverage = matching rows with a usable verification result / matching opportunities. Unavailable rows remain in the completion denominator. Zero denominators are N/A.
- Filters define the reported population. Accepted dates are shown only for current verified solves; date filtering reuses existing accepted/first-verified-attempt semantics, without inferred timestamps for unavailable activity. Repeated problems on different canonical assignments count independently.

### I. Report UI

Admin and Super Admin Batch progress screens now include a visible report-type selector, Download Excel and Download CSV, optional problem breakdown and report Student-name/roll filters. Existing College/Course/Batch selection and Day/platform/Student/problem/progress/ownership/UTC date filters are retained. The export request intentionally omits display pagination.

Generation disables duplicate actions and shows Generating complete report. Download ready appears only after the backend file has been prepared, decoded and offered to the browser. Empty results, denied authority, oversized exports and other failures have explicit messages and retry. Blob URLs are revoked. Existing responsive/theme styles, native accessible selectors and keyboard controls are reused. No optimistic fake export success toast is used.

### J. Registration improvements

Reused the existing searchable College selector and existing canonical numeric yearOfStudy field. Registration no longer silently defaults to first year. Students explicitly choose 1st Year, 2nd Year, 3rd Year or 4th Year; missing, fractional, out-of-range and string years fail validation. Backend validation remains required independently of the form.

College loading/search preserves entered form values and the selected canonical College. Names and existing codes are displayed, with loading, no ACTIVE matches, error/retry and validation states. No institution is hardcoded and no manual MongoDB ID entry is required.

### K. College directory

Reused authenticated `GET /students/registration-options`, already appropriate for Student registration and reviewed corrections. It returns bounded ACTIVE College results with only ID/name/code per College, plus existing form options. Search and pagination remain server-side; directory ordering uses case-insensitive alphabetical collation and an ID tie-breaker. No duplicate endpoint or College identifier was introduced.

Registration revalidates the selected existing College and active status transactionally before creating a profile. Invalid/nonexistent/inactive/archived references fail. Selection does not create a College or persist a College-name substitute. College transfers remain subject to the existing reviewed Super Admin process.

### L. StudentProfile compatibility

Kept exactly one field, yearOfStudy. New registration still requires an integer 1–4. Storage/read contracts permit absence for legacy profiles, with no default or automatic migration; frontend read schemas allow missing/null and show Not provided. Values remain numeric when supplied, and invalid new values are rejected. No destructive or production migration was run.

Year remains a reviewed academic field under the existing profile policy. Students request corrections through the existing endpoint; scoped student.verify reviewers approve them. A truly year-only correction preserves institutional verification and skips enrollment reconciliation markers. Unchanged identity fields in a request are ignored when determining whether a critical identity change occurred. Actual name/roll/College/department changes retain the original verification-reset/transfer safeguards.

### M. Profile and Admin integration

Student profile facts, Admin/Super Admin detail dialogs and authorized Student lists display the canonical College name and friendly Year label or missing-data placeholder. Reports include Year where relevant. Missing College display data uses an unavailable placeholder rather than treating a raw identifier as a College name.

An audited year-only update is tested to preserve Student/profile ID, roll, permanent username, QR credential/version, active enrollment, attendance rows, coding account/revision, immutable evidence and verified progress. It does not grant College access or change coding attribution. Unauthorized College mutation and direct academic-field mass assignment remain blocked.

### N. API contracts

No new endpoint was needed.

| Method / route | Enhancement |
| --- | --- |
| POST `/batches/:batchId/progress/export` | Strict reportType DAY/PROBLEM/STUDENT/BATCH/COMPLETE, format CSV/XLSX, optional includeDetails, confirmed and bounded filters. Adds College/Course/roll/name filters; existing Day/platform/Student/problem/status/ownership/date filters are reused. Display pagination is accepted for compatibility but ignored for complete coverage. |
| GET `/students/registration-options` | Existing authenticated ACTIVE directory reused; alphabetical stable sorting and the existing bounded pagination/search. |
| POST `/students/register` | Existing canonical College and required numeric Year validation retained; explicit year selection in the form. |
| GET `/students/me`, staff Student list/detail | Legacy missing-year projections are readable; canonical College/Year display. |
| Existing correction request/review routes | Reviewed year-only updates preserve verification and relationships; actual critical identity changes retain prior policy. |

The export response contains sanitized filename, MIME, base64 data, matching row/student counts and report type. Legacy page metadata indicates one complete prepared file rather than a display-page extract. There is no public file URL.

### O. Security

Existing authentication, current verified staff authority, College scope, college.view/progress.view, exact Origin, CSRF, strict input validation, private/no-store responses and audit logging are retained. Report readers do not need progress.manage and no grants are expanded. Before releasing a prepared report, authority/curriculum are rechecked and actor/College/Batch conflict-producing locks protect the audit/authorization commit. Heavy exports have an additional five-per-minute authenticated-actor limit.

No QR credentials, OAuth/session/provider tokens, source code or credential hashes enter report rows. Stable evidence/assignment references are non-secret application identifiers required for provenance. No public export directory or sensitive temporary file exists. Output row/byte limits are explicit and fail closed; formula-safe literal cells and sanitized filenames cover spreadsheet/file injection.

### P. Actual tests

- Backend full regression: **620 passed / 30 files**, no failures or skipped tests.
- Frontend full regression: **221 passed / 19 files**, with the single opt-in health test skipped in that ordinary run. The separately enabled real local API health test then **passed**.
- **842 distinct tests passed**: 620 backend + 222 frontend, compared with the previous 762-test baseline. This adds **80 tests** (49 backend, 31 frontend); repeated focused runs are not double-counted.
- The 120-Student × 100-assignment fixture decoded all 12,000 detailed rows, all 120 distinct roll numbers and exactly five correctly formatted workbook sheets. Backend report tests also cover all five report types, zero denominators, explicit limits, filters, formulas, audit and permission failure. Registration/preservation tests cover ACTIVE directory behavior, valid/invalid/missing Years, legacy reads, existing College reference persistence, scoped review and unchanged QR/enrollment/attendance/coding records.
- Private HTTP tests verify authenticated CSRF exports, no-store, safe payloads, invalid contracts, College denial and the authenticated heavy-export limit. Frontend tests cover selectors, both formats, pagination-free filter preservation, pending generation, empty/limit/denial/failure/retry, searchable College options, missing-year states and explicit Year selection.
- After final label adjustments, the affected report-layout tests passed again. The existing staff download interaction test was strengthened to assert pagination exclusion and CSRF instead of the superseded page-only behavior. No tests were deleted or security assertions relaxed.
- Test repositories, signed identities and provider responses remain isolated fixtures. No real MongoDB, Google consent or external-provider success is claimed.


### Q. Build validation

| Check | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS; final affected file also formatted | PASS |
| npm run lint | PASS | PASS |
| npm run typecheck | PASS | PASS |
| npm test | PASS, 620 tests | PASS, 221 ordinary + 1 separate live local health test |
| npm run build | PASS, final TypeScript output | PASS, Next.js production build |
| npm audit | PASS, zero vulnerabilities | PASS, zero vulnerabilities |
| git diff --check | PASS at repository root | Same shared repository check |

Built HTTP smoke passed: health 200, readiness 503 without storage, private coding/registration directory endpoints 401/no-store, protected registration/progress/staff routes redirect to login, same-origin rewrites and the existing WASM decoder work. The real local health client passed separately. Temporary local listeners were stopped. This exercised built transport/auth boundaries without connecting to a database or provider; authenticated real deployment/device acceptance remains blocked.


### R. Important files

Backend: `coding/reports.ts` (new), existing coding service/router/contracts, Student contracts/model/repository/service, and existing College directory repository sorting. Added `progress-reports.test.ts` and `registration-enhancements.test.ts`; extended coding HTTP and Student repository tests. The shared coding fixture exposes its existing attendance test repository for preservation assertions.

Frontend: `coding/report-downloads.tsx` (new), existing staff progress screen, Student registration/contracts/profile/management, and opt-in previous-data preservation in the shared query hook. Added report-download and registration-enhancement tests. Existing registration/export interaction tests now perform explicit Year selection and assert pagination-free complete report requests; their validation/security assertions were preserved.

No new dependency, secret, public environment variable or report persistence model was added. README is the only tracked Markdown; the detailed local report and artifacts remain ignored.

### S. Known issues and acceptance boundaries

- **Tested locally:** report generation/round-trip structure/formatting, 120 × 100 cross-page coverage, metrics, filters, empty/limit errors, injection safety, scoped authenticated HTTP/CSRF/no-store/rate limits/audits, directory behavior, Year validation/legacy reads and preservation of related identities/records.
- **Not live tested:** real MongoDB pagination/collation/indexes/transactions/performance, Google consent/login, authenticated deployed browser/mobile flows and external providers. Multi-query reports describe records read during bounded generation; no global immutable database snapshot is claimed.
- **Blocked:** previously unconfigured authorized MongoDB/Google/Codeforces live acceptance. LeetCode and CodeChef verification remain unavailable as before. Reports honestly include unavailable coverage.
- **Deliberate limits:** per-Batch reports, 2,000 roster members, 20,000 matching assignment rows, 10 MiB and per-actor request throttling. Larger selections must be refined; no global unbounded export or automatic production migration was added.

### T. Acceptance criteria

Statuses describe local implementation/testing, not live database or provider acceptance.

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Report type selection | PASS locally |
| 2 | Excel download | PASS locally |
| 3 | CSV download | PASS locally |
| 4 | Day-wise report | PASS locally |
| 5 | Problem-wise report | PASS locally |
| 6 | Student-wise report | PASS locally |
| 7 | Batch-wise report | PASS locally |
| 8 | Complete Batch report | PASS locally |
| 9 | Five-sheet Complete XLSX | PASS; decoded workbook verified |
| 10 | All matching pages | PASS; 120 Students, 100 assignments, 12,000 rows |
| 11 | Backend filters | PASS locally |
| 12 | Counts | PASS locally |
| 13 | Separate unavailable coverage | PASS locally |
| 14 | Completion denominators/percentages | PASS locally; zero is N/A |
| 15 | No misleading solve claims | PASS |
| 16 | Explicit export limits | PASS; refinement error, no truncation |
| 17 | CSV injection protection | PASS locally |
| 18 | XLSX literal safety | PASS locally |
| 19 | College permissions | PASS locally; live database acceptance BLOCKED |
| 20 | Audited exports | PASS locally; real durability BLOCKED |
| 21 | Backend College dropdown | PASS; reused directory |
| 22 | ACTIVE Colleges only | PASS locally |
| 23 | Search | PASS locally |
| 24 | Canonical College ID stored | PASS locally |
| 25 | No duplicate College creation | PASS |
| 26 | Invalid College references rejected | PASS locally |
| 27 | Required new-registration Year | PASS |
| 28 | Numeric Years 1–4 | PASS |
| 29 | Invalid Years rejected | PASS |
| 30 | Legacy missing-Year compatibility | PASS locally; no data migration run |
| 31 | Student College/Year display | PASS locally |
| 32 | Scoped Admin/Super Admin display | PASS locally |
| 33 | Year updates preserve identity | PASS locally, including evidence/attendance/enrollment/QR |
| 34 | Controlled College transfers | PASS; existing policy retained |
| 35 | Registration/verification lifecycle | PASS locally; actual critical changes still reset verification |
| 36 | Coding progress preserved | PASS regression tests |
| 37 | Attendance preserved | PASS regression/preservation tests |
| 38 | Permanent QR preserved | PASS regression/preservation tests |
| 39 | Existing tests | PASS — 842 distinct tests, +80 from baseline |
| 40 | New tests | PASS — 842 distinct tests, +80 from baseline |
| 41 | Lint/types/builds | PASS — both apps; audits zero vulnerabilities |
| 42 | No secrets exposed | PASS — privacy/publication review clear |
| 43 | No production fake data | PASS |
| 44 | No Phase 9 | PASS |
| 45 | No deployment | PASS |
| 46 | Local uncommitted/unpushed changes | PASS — local HEAD unchanged; no staging/commit/push |

### U. Git status

Branch remains `main`; HEAD is still Phase 7 commit `2894b056f41d6fcb9e153b3e14a0644071a84540`. The existing Phase 8 work and these enhancements remain modified/untracked locally. No files are staged, no commit or push command was run, and no deployment or Phase 9 work occurred. README is the only tracked Markdown; local reports/artifacts are ignored. Privacy scans of 302 eligible text files found no credentials/private-address/machine-path/generated-file findings. Existing URL-userinfo attack test vectors were reviewed as test URLs, not personal email addresses.


### V. Production readiness

Review the local changes before a separate commit/push instruction. Configure and validate the authorized MongoDB replica set and existing authentication/provider applications privately, exercise real authenticated faculty downloads/registration, verify collation/transaction behavior, and load-test permitted report limits on the actual database. No credentials are requested here. Legacy Year completion uses the reviewed workflow; no guessed values or destructive migration is required. Phase 9 and deployment have not started.

## Phase 8 delivery — validated publication

Delivery validation dated 2026-11-16. This record accompanies the commit `feat: implement phase 8 verified coding progress and reporting` on `main`. The earlier local/uncommitted statements are historical handoff snapshots, not the status of this delivery package. Its commit identifier is available in repository history.

- Fresh sequential regression runs passed **620 backend tests** and **221 ordinary frontend tests**. The separately enabled local health client passed, for **842 distinct passing tests**. The five failures from the previous concurrent preflight did not recur; no assertions or timeouts were loosened.
- Both dependency audits were refreshed and reported **zero vulnerabilities**. Formatting, lint, typecheck and production builds had passed in the prior preflight; application source was unchanged before the sequential rerun. The built API/Next.js HTTP smoke passed again, including no-store/private responses, protected redirects, same-origin rewrites, readiness 503 without configured storage and the local QR decoder.
- Privacy review covers the intended source, tests, lockfiles and sanitized configuration. Real environment files, credentials, generated assets, dependencies, local reports and all Markdown other than root README remain ignored. Git author metadata uses a GitHub noreply address. No force push or history rewriting is part of this delivery.
- The implementation covers Phases 1–8 and the Phase 8 enhancements: role-based administration, Student identity/Year/QR, Courses/Batches/enrollment, immutable curricula, attendance, verified coding progress and complete bounded faculty reports.
- **Phase 9 has not been implemented.** No deployment, live MongoDB acceptance, real Google consent or live Codeforces verification is claimed. LeetCode and CodeChef verification remain explicitly unavailable. Existing provider/configuration/database blockers must be resolved and tested before production use.

## Phase 9 — Operational dashboards and learning analytics

Historical implementation snapshot before Git handoff. The Phase 9 delivery record below supersedes its local-only Git statements.

### A. Repository baseline and delivery status

The verified local baseline was `main` at `f3ec0484bfce3fc05ed210f3cde27d40c6594d8f`, the published Phase 8 delivery. The working tree was clean before Phase 9. Previous phase sections are historical snapshots; this section describes the current local implementation. Phase 9 remains **uncommitted and unpushed**. No Git history was changed, deployment performed or Phase 10 started.

### B. Implementation summary and architecture

Added on-demand, backend-calculated operations and learning analytics for Super Admin, authorized College Admins and individual Students. The implementation reuses existing identity, enrollment, pinned curricula, release controls, durable attendance rosters, authoritative attendance records, account ownership and verified evidence attribution. It creates no new database, analytics collection, persisted analytics snapshot or production mock dataset.

`CodingService.reportData` is the shared collection path for Phase 8 downloads and Phase 9 staff coding analytics. `reportMetrics` remains the common coding calculator. Existing report rendering, auditing and size controls remain in place. `CodingService.personalData` exposes the existing self-authorized projection to personal analytics without changing verification rules.

### C. Super Admin dashboard

The existing workspace now includes platform KPI cards with management links, College comparison, Batch operations and completion comparison, plus actionable alerts. Inventory includes College and active College counts, registered/verified Students, Courses, active Batches and current enrollment records. Learning metrics include released Day deliveries, assigned problem identities, finalized attendance sessions, verified completion and verification coverage. College rows show registration, active Batches, distinct eligible enrolled Students, comparable attendance/coding rates and latest relevant activity. Existing College, administrator and approval functionality remains accessible.

Alerts derive from actual records: missing pinned curriculum, released Days without published problems, sessions awaiting finalization, failed/stale synchronization, pending Student verification and active Colleges without an active authorized Admin. No alert is synthesized from random or sample data.

### D. College Admin dashboard

Admin operations use the same calculations within current authorized ACTIVE Colleges. Full combined analytics requires `college.view`, `student.view`, `attendance.manage` and `progress.view`; an incomplete or revoked grant does not grant partial access to the combined payload. The existing Admin scope view is preserved. Daily Batch/Day views show separate Morning/Afternoon sessions, eligible roster counts, actual present marks, confirmed finalized absences, session state and coding opportunities.

### E. Student dashboard

The Student landing workspace now shows own Courses, active Batches, current released Learning Day, assignment counts, verified solves/attempts, unavailable verification, finalized attendance and account freshness. Batch sections include Day-wise learning totals, assignment/editorial navigation, Morning/Afternoon rates, finalized history, corrected marks and coding account status/errors. Personal analytics derives identity exclusively from the session. A browser-supplied Student ID is rejected by the strict query contract.

Personal coding eligibility follows Phase 8's existing enrollment rules; the dashboard does not grant coding access to a withdrawn enrollment in an ACTIVE Batch. Existing historical attendance screens remain available through their established self-only APIs.

### F. Batch analytics

Dedicated routes under `/admin/batches/[batchId]/analytics` and `/super-admin/batches/[batchId]/analytics` provide Overview, Attendance, Coding Progress, Learning Days, Students and Reports views. Overview shows canonical College/Course/Batch context, Batch state, pinned revision, eligible Students, released Days, assigned problems, attendance and coding rates, pending finalization and follow-up evidence.

Attendance includes separate session rows, a finalized-rate trend and a paginated Student/session matrix. Coding includes counts, Day trends, platform coverage, problem rates and sufficient-coverage low-solve review links. Students have search, Year filtering, stable sorting, bounded pagination, relevant metrics and authorized detail navigation.

### G. Learning Day analytics

Dedicated `/analytics/days/[day]` frontend routes display the released Day title, published assignments, eligible Students, separate session information and problem-level coding results. Empty published Days remain visible and display N/A for completion. Pinned revision and restriction controls are reused; hidden/restricted Days are excluded from released curriculum metrics. Historical attendance snapshots retain their original Day identity and are not rewritten.

### H. Attendance calculation rules

Phase 9 attendance is `finalized PRESENT marks / all eligible finalized Student-session snapshot opportunities`. Morning and Afternoon remain distinct opportunities. EXCUSED marks remain in this Phase 9 denominator; unfinalized sessions never establish confirmed absence. Zero opportunities produce null/N/A. Current authoritative corrected records determine marks; missing or withdrawn current enrollments do not erase finalized snapshot history. Year filtering uses current stored Year only for profiles still in the Batch College; snapshot names and rolls remain historical.

Phase 7 attendance reports retain their existing policy excluding EXCUSED from their denominator. A dedicated Phase 9 attendance download uses the new formula and reconciles with the analytics response. The two policies are explicitly described in the UI. The analytics detail file repeats selection-wide summary counts/rate as reference columns; these are not per-row contributions and must not be summed across detail rows.

### I. Coding calculation rules

- Completion: `SOLVED_VERIFIED / matching eligible assigned opportunities`.
- Coverage: `opportunities with a usable verification outcome / matching eligible assigned opportunities`.
- ATTEMPTED_VERIFIED is counted separately from solved.
- Checked no verified accepted submission includes NOT_STARTED plus ATTEMPTED_VERIFIED, so it overlaps the attempted count and must not be added to it as a disjoint category.
- VERIFICATION_UNAVAILABLE remains separate and does not establish that a Student failed to solve a problem.
- Zero denominators return null/N/A. Repeated canonical problems on different Day assignments retain distinct identities.

The existing Phase 8 projection determines account revisions, ownership expiry, provider availability, complete coverage, enrollment activation and assignment evidence attribution. Date filters retain Phase 8's accepted/first-verified-attempt timestamp semantics: unknown activity timestamps cannot be assigned to a selected period. Published assignment inventory and eligible Student context can remain visible even when no matching activity rows exist; the coding opportunity denominator is the matching report-row population.

### J. Student follow-up rules

Central documented constants specify at least 2 finalized ABSENT session marks; completion below 40% only with at least 5 opportunities and at least 80% verification coverage; missing/expired account ownership; latest failed synchronization; synchronization older than 24 hours since success; active jobs unchanged for more than 24 hours or with an expired running lease; pending registration verification; and legacy missing Year. Missing success timestamps alone are not fabricated stale successes. Job signals respect account revision, Batch, enrollment and pinned revision.

The follow-up table includes Student, roll, Batch where available, reason, relevant counts/rates or timestamps, update time and authorized detail links. Pending registration and missing Year can also surface for Students without a selected Batch. Reasons are review signals, not grades or predictions. There is no messaging, notification or automated outreach.

### K. Charts and visualizations

Responsive SVG charts provide finalized attendance trends, Day completion, platform coverage, problem solve rates and Batch comparisons. They use actual backend values, a fixed 0–100 percent scale, light/dark theme styles, accessible titles/descriptions, exact-value descriptions and native tooltips. Line segments do not bridge unavailable values. Tables provide precise records. No chart dependency was added.

### L. Filters and navigation

Applicable screens support College, Course, Batch, Learning Day, platform, paired UTC dates, Student Year, Student search, coding ownership verification status and follow-up reason. Existing College/Course selectors are reused. URL query parameters preserve filters, active view, pagination and sorting. Dependent College/Course selections clear stale Batch/Day choices; filter changes reset pagination.

Dates must be supplied together, ordered and within 366 days. Pagination is limited to 50 rows per page with stable ID tie-breaks. Coding-specific platform/ownership filters do not change attendance marks. Date filtering uses session creation dates for attendance. Entity inventory remains scoped to the selected College/Course/Batch; cohort filters narrow applicable Student measures. Loading, empty, error/retry and download states are implemented.

### M. Report and export integration

The Reports view reuses `ReportDownloads` and Phase 8's DAY, PROBLEM, STUDENT, BATCH and COMPLETE report types in Excel/CSV. Shared coding data and counts reconcile independently of visible pagination. A small reusable attendance file writer is extracted from the existing attendance export, retaining the old export contract. The Phase 9 attendance endpoint uses the same writer with matching analytics filters and the Phase 9 denominator; it does not create a second report storage service.

Downloads are backend generated, private, bounded, audited and CSRF/Origin protected. Filenames are fixed/sanitized, CSV spreadsheet prefixes are neutralized, XLSX text remains literal, and temporary browser Blob URLs are revoked. Phase 9 attendance exports allow at most 10,000 matching rows and a bounded encoded payload. Existing coding export limits remain 2,000 roster members, 20,000 assignment rows and 10 MiB prepared files. Oversized requests fail explicitly instead of silently exporting the first page.

### N. Backend API contracts

All paths below are relative to `/api/v1`. Success responses use `{ success: true, data }`; errors retain the existing safe error envelope. All analytics responses are `no-store, private`.

| Method | Path | Contract and authority |
| --- | --- | --- |
| GET | `/analytics/platform` | Super Admin only; inventory, College comparison, Batch metrics, alerts and follow-up |
| GET | `/analytics/overview` | Current authorized staff scope; operational dashboard |
| GET | `/analytics/follow-up` | Same staff scope and validated filters; paginated evidence-based follow-up |
| GET | `/analytics/batches/:batchId` | Current combined Batch authority; summaries, Days, sessions, coding, paginated matrices/follow-up and freshness |
| GET | `/analytics/batches/:batchId/days/:day` | Same authority with validated Day filter |
| GET | `/analytics/me` | Session-derived Student only; own eligible Batch learning, account and attendance information |
| POST | `/analytics/batches/:batchId/attendance/export` | Staff authority, CSRF, exact Origin and export rate limit; `{ format, filters, confirmed: true }`; file metadata/base64, row count and reconciled summary |

Strict Zod filters reject unknown fields, malformed IDs, forged identity fields, invalid ranges and unbounded pagination. Existing Phase 8 coding export filters additionally accept `year` and `search`, preserving existing defaults. Display pagination never limits the exported population.

### O. MongoDB queries and indexes

`analytics/repository.ts` provides bounded catalog reads and request-local Batch prefetching. Profiles, Student authority records, accounts, progress and recent jobs are loaded in bulk; the shared Phase 8 projection then operates on that prepared read unit instead of querying each Student's data repeatedly. Coding-job reference filters retain the existing String schema types. Recent jobs use a MongoDB aggregation with `$firstN` per account, preserving the existing 20-job history policy; the deployment database must support that operator. Attendance fetches session IDs, rosters and records in bulk and resolves authoritative marks by key.

Existing College, profile, enrollment, Batch, account, progress and job indexes support the query prefixes. No index, model or persisted analytics source of truth was added. Explicit limits include 500 Colleges, 100 Batches per overview, 10,000 profiles, 4,000 enrollment-history rows per prepared Batch, 2,000 current roster members, 20,000 progress/attendance rows, 40,000 recent job rows and 50,000 coding opportunities across an overview. Oversized selections return an explicit error. Some preparation bounds apply to the whole stored Batch before display filters, so a Day filter cannot bypass every Batch history/progress bound. These bounds support controlled initial deployment; they are not proof of production query latency.

### P. Security and authorization

Existing Google OAuth, HttpOnly sessions, CSRF and exact Origin checks are preserved. Staff analytics rechecks current user status, role, ACTIVE College grants and Batch permissions; direct URLs do not bypass backend checks. Exports reauthorize and lock current actor/College/Batch before audit and delivery. Personal responses never accept a target Student ID. Analytics output selects public academic and operational fields and excludes email, provider subjects, credential material, tokens, private proof data and phone numbers.

### Q. Actual tests

- Backend full regression: **673 passed / 32 files**; no failures or skips.
- Frontend full regression: **244 passed / 20 files**; the single opt-in health test was skipped in the ordinary run and **passed separately** against the real local API.
- **918 distinct tests passed**, including local health: 673 backend + 245 frontend. This preserves the 842-test Phase 8 baseline and adds **76 tests**. Repeated runs are not double-counted. Existing assertions and verification rules were not weakened.
- The production bulk-reader regression checks 120 Students, actual String-valued coding-job references, bounded per-account job aggregation, one bulk read per domain and reconciled evidence-derived counts. It mocks database I/O and is not a live Atlas integration test.

The new tests cover scope denial, forged filters and IDs, revoked grants, inactive Colleges, suspended users, Student self-only access, separate sessions, finalization, corrections, withdrawn-roster history, zero denominators, pinned restrictions, unsupported verification, attempts versus solves, stale/failed jobs, Year/search/pagination/sorting, report reconciliation and safe downloads. The realistic fixture includes 120 Students, 100 assignments, 12,000 coding opportunities and 240 finalized Student-session opportunities. It verifies full summaries while displaying only page 3 of the Student table. This is an isolated fixture, not an Atlas load test.

### R. Formatting lint types and production builds

| Check | Backend | Frontend |
| --- | --- | --- |
| npm run format | PASS | PASS |
| npm run lint | PASS with zero warnings | PASS with zero warnings |
| npm run typecheck | PASS | PASS |
| npm test | PASS | PASS plus separate local health |
| npm run build | PASS | PASS |
| git diff --check | PASS for the final change set | Shared repository check |

The frontend production build uses the existing required `BACKEND_API_BASE_URL` with the sanitized local setup example and same-origin public API path. Configuration validation was preserved. Compiled HTTP smoke verified health 200, intentional readiness 503 without a database, private analytics/coding/attendance APIs returning 401 with no-store, protected role/analytics routes redirecting to login and the same-origin scanner decoder asset. This was HTTP boundary testing, not authenticated visual acceptance.

### S. Dependency audits

Backend and frontend `npm audit` each reported **zero vulnerabilities**. No new dependency, package or lockfile change was required for Phase 9.

### T. Performance observations

The 120-Student fixture reconciles expected counts across pagination. Production data paths use bounded bulk reads, keyed joins and request-local preparation with no persisted analytics cache. Server responses forbid HTTP caching. Existing TanStack Query client behavior can reuse a response for its 10-second stale interval; mutations continue to invalidate administration queries, and navigation/filter changes request their matching data. Generated timestamps and successful synchronization timestamps communicate freshness. No real-time provider guarantee is made.

Atlas query plans, database persistence, concurrent-user latency, deployment throughput and live job aggregation compatibility remain BLOCKED until tested against the configured database. No unsupported performance claim is made.

### U. Files and modules

- New backend modules: `analytics/contracts.ts`, `calculations.ts`, `repository.ts`, `service.ts` and `router.ts`; shared `attendance/file.ts`; `tests/analytics-fixtures.ts`, `tests/analytics.test.ts` and `tests/analytics-repository.test.ts`.
- Backend integrations: `app.ts`, `coding/service.ts`, `coding/reports.ts` and `attendance/service.ts`. Verification algorithms and historical mutation rules are preserved.
- New frontend modules: `features/analytics/contracts.ts`, `dashboard.tsx` and `tests/analytics-ui.test.tsx`.
- New protected route families: Admin and Super Admin `/analytics`, `/follow-up`, `/batches/[batchId]/analytics` and `/batches/[batchId]/analytics/days/[day]`.
- Updated role landing pages, administration and Student navigation, working roll-search deep links into the existing Student directory, Batch catalog/detail links, themed responsive CSS and analytics request timeout handling.
- No new environment variables or dependency packages. Existing `MONGODB_URI`, `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, session/cookie/CSRF settings and Phase 8 `CODEFORCES_*` / `CODING_*` settings remain applicable. Only variable names belong in published documentation.

<details>
<summary>Complete Phase 9 changed file manifest</summary>

```text
README.md
algora-backend/src/analytics/calculations.ts
algora-backend/src/analytics/contracts.ts
algora-backend/src/analytics/repository.ts
algora-backend/src/analytics/router.ts
algora-backend/src/analytics/service.ts
algora-backend/src/app.ts
algora-backend/src/attendance/file.ts
algora-backend/src/attendance/service.ts
algora-backend/src/coding/reports.ts
algora-backend/src/coding/service.ts
algora-backend/src/tests/analytics-fixtures.ts
algora-backend/src/tests/analytics-repository.test.ts
algora-backend/src/tests/analytics.test.ts
algora-frontend/src/app/(admin)/admin/analytics/page.tsx
algora-frontend/src/app/(admin)/admin/batches/[batchId]/analytics/days/[day]/page.tsx
algora-frontend/src/app/(admin)/admin/batches/[batchId]/analytics/page.tsx
algora-frontend/src/app/(admin)/admin/follow-up/page.tsx
algora-frontend/src/app/(admin)/admin/page.tsx
algora-frontend/src/app/(admin)/admin/students/page.tsx
algora-frontend/src/app/(student)/student/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/analytics/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/batches/[batchId]/analytics/days/[day]/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/batches/[batchId]/analytics/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/follow-up/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/page.tsx
algora-frontend/src/app/(super-admin)/super-admin/students/page.tsx
algora-frontend/src/app/globals.css
algora-frontend/src/components/layout/administration-shell.tsx
algora-frontend/src/features/analytics/contracts.ts
algora-frontend/src/features/analytics/dashboard.tsx
algora-frontend/src/features/learning/batches.tsx
algora-frontend/src/features/students/management.tsx
algora-frontend/src/features/students/shell.tsx
algora-frontend/src/lib/api/client.ts
algora-frontend/src/tests/analytics-ui.test.tsx
algora-frontend/src/tests/students-ui.test.tsx
```

</details>

### V. Known issues and integration blockers

Live Atlas persistence/index/query-plan verification, real Google OAuth, real Codeforces ownership/synchronization, deployed cookie transport and authenticated browser acceptance remain BLOCKED/unverified. LeetCode and CodeChef trusted automated verification remain unavailable as documented in Phase 8. No provider scraping or fake solves were introduced. Automated component tests establish behavior, not visual mobile/light/dark browser acceptance. Existing real-camera acceptance remains unverified. A large multi-Batch overview can hit explicit bounds and must be narrowed.

### W. Acceptance criteria

PASS below means local implementation and automated checks, not deployed/live acceptance. LIMITED identifies a feature with outstanding live acceptance; BLOCKED indicates unavailable external verification.

| Criterion | Status | Evidence or boundary |
| --- | --- | --- |
| 1 Existing Phase 8 intact | PASS | Full coding/report/registration regression suite retained |
| 2 Super Admin analytics | LIMITED | Scope and counts tested; live authenticated browser/database acceptance pending |
| 3 College Admin analytics | LIMITED | Current permissions and College denial tested; live acceptance pending |
| 4 Student personal analytics | LIMITED | Self-only response and UI tested; live acceptance pending |
| 5 Batch analytics | PASS | Six views, combined metrics and 120-Student fixture |
| 6 Learning Day analytics | PASS | Published/restricted/empty Day handling and navigation |
| 7 Attendance calculations | PASS | Separate sessions, finalized snapshots, corrections and denominators |
| 8 Coding distinctions | PASS | Shared Phase 8 projection/calculator and unavailable/attempted distinctions |
| 9 Follow-up rules | PASS | Evidence and explicit thresholds; no automated outreach |
| 10 Filters and pagination | PASS | Strict bounded contracts, URL filters and stable sorting |
| 11 Charts use backend records | PASS | No production fixtures; accessible exact-value charts |
| 12 Freshness visible | PASS | Generated/sync timestamps and pending/failed/stale signals |
| 13 Analytics downloads | PASS | Existing coding reports and reconciled attendance CSV/XLSX |
| 14 College permissions | PASS | Current scopes and revoked/inactive denial tests |
| 15 Student self-only access | PASS | Browser-supplied target IDs rejected; private HTTP boundary tests |
| 16 Zero denominators | PASS | Null/N/A in calculations and UI |
| 17 Existing exports intact | PASS | Phase 8 workbook/report tests and prior attendance exports preserved |
| 18 Registration enhancements intact | PASS | Existing registration/profile tests retained |
| 19 QR attendance intact | PASS | Attendance regressions and protected scanner asset smoke |
| 20 Coding verification intact | PASS | Existing ownership/evidence/job regressions retained; live provider checks BLOCKED |
| 21 New tests | PASS | Recorded actual counts above |
| 22 Regression tests | PASS | Existing assertions preserved |
| 23 Production builds | PASS | Both local production builds |
| 24 No secrets or fake production data | PASS | Sanitized documentation and privacy scan; fixtures confined to tests |
| 25 Remains uncommitted and unpushed | PASS | Baseline HEAD preserved; local source changes only |

### X. Final Git status

Local branch remains `main` at `f3ec0484bfce3fc05ed210f3cde27d40c6594d8f`. The GitHub main reference was read and still matches that Phase 8 commit. Phase 9 source/tests and this README are local working-tree changes; the index is empty. No Phase 9 commit, push or deployment occurred. Only root README.md is tracked among Markdown files. Generated logs, reports and assets remain ignored.

### Y. Next phase readiness

Ready for review of the local Phase 9 implementation. Resolve live database/provider configuration and run authenticated browser acceptance before production sign-off. No Phase 10 feature work has begun. Commit, push and deployment remain separate user-directed steps.


## Phase 9 delivery and Phase 10 handoff

The Phase 10 request authorized a Phase 9 delivery commit, and the user explicitly approved pushing Phase 9 only. The refreshed handoff checks passed both applications: 673 backend tests, 244 regular frontend tests, format, lint, typecheck, production builds and zero dependency vulnerabilities. The separately enabled local health/HTTP check is recorded with the handoff. Previous 918-test acceptance remains the baseline. No unrelated file changes were found, and only intended source, tests and root README.md are included.

This README accompanies commit `feat: implement phase 9 analytics and operational dashboards`; its immutable hash is recorded in Git history and the subsequent Phase 10 implementation record. Push outcome is verified before any Phase 10 source work. No credentials, generated output or other Markdown documents belong in this handoff. Phase 10 must remain uncommitted and unpushed.

## Current local setup

Use Node.js 22 LTS and npm in the complete local workspace. Two independent applications are retained: algora-frontend and algora-backend.

Backend terminal:

```powershell
cd algora-backend
npm ci
Copy-Item .env.example .env
# Configure MONGODB_URI when an authorized database is available.
# Set the Google OAuth variables together when credentials are available.
npm run dev
```

Frontend terminal:

```powershell
cd algora-frontend
npm ci
Copy-Item .env.example .env.local
# NEXT_PUBLIC_API_BASE_URL=/backend
# BACKEND_API_BASE_URL points to the local Express API base.
npm run dev
```

Frontend runs at http://localhost:3000; Express at http://localhost:5000/api/v1. Sign-in remains unavailable until its real dependencies/configuration are ready. Do not overwrite an existing environment file when revisiting setup.

Run inside each application: npm run format, npm run lint, npm run typecheck, npm test, npm run build and npm audit. Production frontend builds require BACKEND_API_BASE_URL; browser requests use NEXT_PUBLIC_API_BASE_URL=/backend. The optional live health test needs RUN_CONNECTIVITY_TEST=true and the local API running.

### Phase 9 analytics setup

After the existing database, identity and provider setup, open the appropriate role landing page: `/super-admin`, `/admin` or `/student`. Staff have dedicated `/analytics`, `/follow-up` and Batch analytics routes. Combined Admin analytics requires current ACTIVE College assignments with `college.view`, `student.view`, `attendance.manage` and `progress.view`. Existing management permissions still govern linked actions. The MongoDB deployment must support the recent-job `$firstN` aggregation. No new environment variable is required. Review the Phase 9 bounds and acceptance record before production sign-off.

## Authentication configuration and contracts

The Phase 2 identity and authorization infrastructure remains in use. Database unavailability is intentional until an authorized MongoDB replica set is configured. There is no production in-memory authentication fallback or privileged development account.

### Deployment and cookie strategy

The browser communicates with `/backend/*` on the frontend origin. A fixed Next.js external rewrite forwards requests to `${BACKEND_API_BASE_URL}/*` on Express. This is a transport rewrite, not a Next.js authentication implementation; no Next.js API handlers, OAuth callbacks, token issuance or session databases are introduced. Server-rendered protected pages call Express directly with only the session cookie and `cache: no-store`.

This small transport layer is necessary to support unrelated Vercel/Railway hostnames without relying on browser third-party cookies. Use it even if custom subdomains become available. Public browser requests use `NEXT_PUBLIC_API_BASE_URL=/backend`; direct cross-site production browser authentication is deliberately unsupported. No `SameSite=None` workaround is used.

Production cookies are host-only `__Host-algora_session` and `__Host-algora_oauth`, with Path=/, Secure, HttpOnly and SameSite=Lax. No Domain attribute is set. Local HTTP development uses `algora_session` / `algora_oauth` without Secure. The callback must be the frontend origin plus `/backend/auth/google/callback`, so cookies are issued through the same public host used for protected pages. Do not configure the public callback as the Railway hostname. TLS must be enabled on both production hosts. Vercel must forward Cookie and Set-Cookie without caching or logging them. Verify this behavior on the actual deployment before launch.

The rewrite target is trusted server configuration, never user input. This introduces one extra frontend-to-backend hop. Keep frontend deployment previews separate from production sessions; use a separate OAuth client/environment for previews rather than wildcard origins or redirects. Configure the exact allowed frontend origin and correct Railway reverse-proxy hop count. Rate limit storage is process-local; a horizontally scaled production deployment needs a shared limiter or edge-level equivalent.

Next.js external rewrites are documented in the [official rewrite reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites). Browser verification of the deployed cookie transport remains required.

### Course, Batch and enrollment setup

Grant course.manage, batch.manage, student.enroll and student.view explicitly to the authorized College Admins through Super Admin assignment management. History additionally requires report.view or membership/batch-management permission alongside student.view. These grants are not automatically added to existing accounts.

Super Admin manages platform curricula and explicit cross-college course sharing. College Admins manage their own College-owned curricula and authorized Batches. Publish an eligible Course, create the College Batch, and activate it when ready. Enrollment uses the current ten-character roll only. Pending records reserve seats but grant no learning access. For paste/CSV/XLSX imports, review the server preview and confirm it; the final operation revalidates eligibility and capacity.

The backend starts its durable reconciliation worker automatically after storage readiness. Super Admin can review failures at /super-admin/reconciliation. Database indexes/transactions, worker restart behavior and configured authenticated workflows must be verified before production use. No additional enrollment secret is required.

### Curriculum and Learning Day setup

Use /admin/problems or /super-admin/problems to author canonical problem metadata and publish immutable editorial versions. Open a Course's curriculum builder, create a draft, add and order Learning Days/topics/resources/assignments, choose exact published editorial versions and visibility, preview, then review and publish. Schedules are authored in local time, stored in UTC and evaluated by the server. Hidden editorials and instructor-only resources never enter Student projections.

Open Batch curriculum management to select a published revision of the same Course, provide a review reason, review server-calculated impact and explicitly confirm assignment. Active Batch upgrades preserve assignment history and require a fresh review; completed/archived references remain unchanged. Existing Batches have no fabricated revision. Batch-specific release restrictions withdraw future access and restore only original release rules. No automatic scheduling worker or new curriculum environment secret is needed.

Verified Students with current effective enrollment open their own Course/Batch learning path and any released Day. Current roll, profile, College, Course and Batch eligibility remain mandatory on every content request. There is no sequential completion gating. Phase 8 adds evidence-backed coding progress without self-reported solved states. Real persisted and authenticated browser checks remain blocked until dependencies are configured.

### Attendance setup

Super Admin explicitly grants college.view and attendance.manage to the relevant College staff; no existing grant is expanded automatically. Open /admin/attendance or /super-admin/attendance, select the authorized College/Course/Batch, and use a released Learning Day from its pinned published revision. Create Morning and Afternoon slots separately, open a session to capture its durable verified roster, then start the continuous scanner over HTTPS or localhost. Use the existing permanent Student QR. Camera permission and a supported device are required; QR screenshots remain shareable bearer credentials.

Close scanning to review PRESENT/UNMARKED members. New enrollments require an explicit reviewed additive roster refresh. Unmarked members can be reasonedly excused while CLOSED. Review and confirm finalization to create official ABSENT records for the remaining durable roster. Subsequent status changes use audited corrections. Attendance sessions and Phase 8 coding sync/progress prevent curriculum replacement. Staff scans require sign-in within eight hours of the original session issuance; sign out/in to renew, and use a shorter SESSION_TTL if required by your deployment policy.

Students use /student/attendance to discover their own roster history, including finalized attendance after a Batch completes. Staff reports calculate percentages only from finalized PRESENT/ABSENT rows, exclude EXCUSED and use N/A for zero denominator. CSV/XLSX exports are private and audited. Admission/finalization is capped at 2,000 members; reports at 1,000 selected sessions/10,000 detail rows. No automatic migration, database connection or deployment has occurred. Phase 7 was subsequently pushed and independently verified as recorded in Phase 8 section A. npm dev/build lifecycle hooks generate the same-origin decoder asset from the locked dependency; keep those generated public assets ignored.

### Coding ownership and progress setup

Staff progress pages now offer Day-wise, Problem-wise, Student-wise, Batch-wise and Complete Batch downloads in Excel/CSV. Downloads cover all matching authorized roster/assignment pages, within 2,000 scanned roster members, 20,000 matching assignment rows and 10 MiB. Complete Excel has five worksheets; Complete CSV is flat assignment detail. Refine filters when a limit error is returned; no partial first-page file is substituted.

Grant `college.view` and `progress.view` explicitly for authorized College report readers. Add `progress.manage` for staff who may request Student/Batch sync; existing grants are not expanded. Students link accounts at `/student/coding-accounts`, complete the configured official Codeforces ownership flow, and use `/student/progress` or Learning Day problem badges for verified evidence. Staff use `/admin/progress` or `/super-admin/progress` and the corresponding Progress Reports navigation.

On the backend, configure `CODEFORCES_CLIENT_ID`, `CODEFORCES_CLIENT_SECRET` and `CODEFORCES_REDIRECT_URI` together for an authorized Codeforces OIDC application. The exact callback is the frontend origin plus `/backend/coding/accounts/codeforces/callback`. Keep the secret server-only. No credentials are supplied or requested in this phase. LeetCode/CodeChef ownership and authoritative submission integration remain unavailable; do not add passwords or cookies as a workaround.

Validate MongoDB 5+ replica-set transactions, indexes and shared provider-control updates first. Set `CODING_SYNC_ENABLED` explicitly when ready; `CODING_SYNC_INTERVAL_SECONDS` controls bounded automatic scheduling. Synchronization is disabled by default. All workers must use the same control collection/provider budget. Queueing is durable; disabled workers leave jobs queued. Actual database/provider/multi-worker verification remains blocked here.

New Batch activations persist actual UTC `startedAt`. Existing active Batches missing that timestamp remain unavailable for verified attribution; a planned date is not guessed into an actual instant. Assignment windows also require the current enrollment's authoritative activation time. Review older data through an explicitly audited future remediation process rather than a hidden migration. Completed-Batch own history does not unlock learning content or enable new sync jobs.

### Student identity and QR setup

Registration uses the authenticated searchable ACTIVE College directory, displaying existing names/codes while storing only the canonical relationship. New registrations must explicitly choose numeric Year of Study 1–4. No first-year default is guessed. Legacy missing-year profiles remain readable and can request completion through the existing reviewed correction workflow. A year-only approved correction preserves verification, enrollment, attendance, QR and coding evidence; real identity/College changes retain existing review and transfer safeguards.

Create ACTIVE colleges and explicitly grant student.view/student.verify to authorized college Admins. Students complete mandatory registration after Google login, then enter their profile while institutional verification is pending. Only an authorized separate reviewer may verify identity. Course/Batch delivery and authorized roll-only enrollment are implemented in Phase 5; institutional verification and effective enrollment remain separate requirements.

QR requires backend-only QR_ACTIVE_KEY_ID and QR_ENCRYPTION_KEYS. Store an independently generated 32-byte key in the backend secret manager as a base64 value in the JSON keyring; never put a real value in README, source, chat or browser configuration. Registration remains usable with explicitly unissued QR when the vault is unavailable. See Phase 4 section H for wrapping-key rotation, backups and lost-key recovery. No credential has been configured here.

### Super Admin setup

After a real verified Google account exists in MongoDB, an authorized operator can run npm run provision:super-admin from the backend with PROVISION_SUPER_ADMIN_SUBJECT set privately for that invocation. The command requires an interactive terminal and exact confirmation. It is never run during startup, deployment or tests. See Phase 3 section D for safeguards and the separate local ownership recovery procedure. Never publish the subject or credentials.

### Google Cloud setup

1. Create or select a Google Cloud project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure Google Auth Platform branding, audience/consent, and permitted test users while the application is in testing mode.
3. Create an OAuth client with application type **Web application**.
4. Add the exact authorized redirect URI: frontend origin followed by `/backend/auth/google/callback`. For local development this is `http://localhost:3000/backend/auth/google/callback`; production uses your actual HTTPS frontend origin. Avoid wildcard redirects.
5. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI together on the backend. Never put the client secret in NEXT_PUBLIC variables, Git, screenshots, or chat.
6. Set FRONTEND_URL to the exact frontend origin and include that origin in CORS_ORIGINS. Configure MongoDB and restart the backend. The login page enables Google only when the backend reports configuration and auth storage ready.

Refer to Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) for credential/consent setup and exact redirect matching. Only openid, email and profile scopes are requested. No Google API access or refresh tokens are retained.

### Environment contract

Backend:

| Variable | Contract |
| --- | --- |
| MONGODB_URI | Required backend-only MongoDB URI. No credentials are supplied by this project. |
| FRONTEND_URL | Exact public frontend origin. Local default is localhost:3000; production requires HTTPS. |
| GOOGLE_CLIENT_ID | Optional until OAuth is configured; set together with the secret and redirect URI. |
| GOOGLE_CLIENT_SECRET | Backend secret, never sent to the browser. |
| GOOGLE_REDIRECT_URI | Must equal FRONTEND_URL + `/backend/auth/google/callback`. |
| SESSION_TTL | Absolute lifetime in seconds; default 604800, permitted range 300–2592000. Rotation does not extend it. |
| CODEFORCES_CLIENT_ID | Optional official Codeforces OIDC application identifier; configure all three provider settings together. |
| CODEFORCES_CLIENT_SECRET | Backend-only HS256/token-exchange secret; never expose in public variables, logs or Git. |
| CODEFORCES_REDIRECT_URI | Exact frontend origin plus `/backend/coding/accounts/codeforces/callback`. |
| CODING_SYNC_ENABLED | Opt-in worker switch; disabled until authorized storage/provider setup is validated. |
| CODING_SYNC_INTERVAL_SECONDS | Bounded automatic scheduling interval; validated by the backend environment schema. |
| CORS_ORIGINS | Exact comma-separated allowlist; must include FRONTEND_URL. Production origins require HTTPS. |
| NODE_ENV / PORT | Production enables secure host-prefix cookies; PORT is supplied by Railway. |
| TRUST_PROXY_HOPS | Verified count of trusted reverse proxies; default 0. |
| LOG_LEVEL | Pino level. Avoid platform logging of OAuth query strings or cookie headers. |

Frontend:

| Variable | Contract |
| --- | --- |
| NEXT_PUBLIC_API_BASE_URL | `/backend` in production; default `/backend`. No secrets. |
| BACKEND_API_BASE_URL | Server-only upstream base including `/api/v1`; required at production build/runtime. HTTPS required in production, except localhost build/smoke checks. |
| ENABLE_PREVIEW_ROUTES | Optional true only in development; production preview routes always return 404. |

No session signing secret is needed because opaque tokens are random and only their SHA-256 hashes are stored. Cookie names/security settings are derived from NODE_ENV rather than user-configurable insecure options. Keep deployment variables consistent between build and runtime: rewrites are determined at build time.

### Identity and OAuth sequence

GET /auth/google rejects custom redirects and browser role overrides, checks configuration/storage, and generates state, nonce and PKCE using openid-client. State and browser-binding tokens are hashed in the OAuth transaction store. The verifier and nonce are stored only in the short-lived transaction; the browser receives an opaque HttpOnly binding cookie. Each transaction expires after ten minutes.

The callback atomically consumes a transaction matching state, browser binding and explicit expiry. It checks for a verifier before exchanging the code. The library sends S256 PKCE and validates expected state/nonce, Google issuer, client audience, token time claims and RS256 signature through Google JWKS. Signature checking is explicitly enabled with [enableNonRepudiationChecks](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md). A verified email and stable Google subject are required.

Only the stable Google subject identifies an existing account. Email collisions with another subject are rejected, never automatically linked. Atomic subject upsert plus unique indexes handle concurrent first login. Only profile fields and lastLoginAt are updated on later Google login; role, account/registration status and username are not accepted from Google/browser profile input.

New users are STUDENT / PENDING / NOT_STARTED, without a username. They enter /student/register. Registered but unverified Students may view /student/profile and /student/my-qr; only institutional verification permits the verified Student workspace, and Course/Batch access separately requires a current eligible enrollment. Privileged accounts use the explicit Phase 3 operator provisioning command or the authenticated Super Admin approval workflow. Browser role selection never assigns privilege.

A fresh opaque session is created after verification; an existing browser session is revoked to prevent fixation. Status and revocation version are rechecked before issuing the cookie. Redirect destinations come only from a fixed server-side role/status policy, never a request URL. Invalid OAuth callbacks return sanitized API errors; the user can return to the login page to restart. Google cancellation never creates an account session.

### Models and indexes

User: googleSubject (immutable, unique), normalized email (unique), emailVerified, displayName, optional avatarUrl, role, optional immutable username, accountStatus, registrationStatus, sessionVersion, lastLoginAt, createdAt, updatedAt. Username uniqueness uses a partial index for strings, allowing multiple unregistered users without usernames. Names are normalized only by reusable utilities; privileged usernames are allocated only by controlled provisioning/approval workflows, while independent permanent Student usernames live in StudentProfile after registration.

Session: userId reference to User, tokenHash (unique SHA-256 hash), version, expiresAt (TTL index), revokedAt, createdAt, updatedAt. A compound userId/revokedAt index supports revocation. The raw 256-bit random token exists only transiently during issuance and in the HttpOnly cookie, never in responses, logs or browser storage.

OAuthTransaction: unique stateHash, browserHash, verifier, nonce, fixed optional Admin-access intent and expiresAt with TTL. Atomic find-and-delete plus explicit expiry prevents replay independent of delayed MongoDB TTL cleanup.

Auth indexes are created after connection before auth storage is considered ready. Failures keep authentication/readiness unavailable. Do not bypass this check or enable login before indexes exist. Plan index changes carefully for existing production datasets; Phase 2 starts without user data. User status changes increment sessionVersion; logout-all does the same and revokes session rows. Every request reloads current User and compares versions, so revocation remains effective even if an older session row is inserted during a race.

### API contract

All routes below are under `/api/v1/auth` on Express and `/backend/auth` from the browser. All auth responses are non-cacheable. Errors use `{ success: false, error: { code, message, requestId } }`; JSON success uses `{ success: true, data: ... }`.

| Method/path | Behavior |
| --- | --- |
| GET /status | Public availability/message for the login button. No credentials or infrastructure details. 200 with available=false when not ready. |
| GET /google | Public OAuth entry, rate-limited; sets transient browser binding cookie and redirects to Google. 503 when configuration/storage unavailable. Only the fixed optional intent=admin-access is accepted; no arbitrary redirect parameters. |
| GET /google/callback | Validates single-use transaction and identity, creates session and redirects to a fixed frontend route. 400/401 on invalid transactions/identity; 503 on storage/provider unavailability. |
| GET /me | Requires valid session; safe own-user profile plus fixed destination. No subject, hashes, token, version or raw OAuth data. |
| GET /csrf | Requires session; session-bound CSRF token, for subsequent mutation headers. |
| POST /logout | Requires session, exact Origin and X-CSRF-Token; revokes current session and clears cookie. |
| POST /logout-all | Same protection; increments revocation version, revokes all devices and clears cookie. |
| POST /refresh | Same protection; atomically rotates the cookie token and CSRF derivation, preserving absolute expiry. |
| GET /access/student | Session + STUDENT + verified registration + ACTIVE account. Returns authorized=true and safe own-user profile only. |
| GET /access/admin | Session + ADMIN + ACTIVE account. No college/admin business data. |
| GET /access/super-admin | Session + SUPER_ADMIN + ACTIVE account. No privileged business operations. |

Session errors return 401; role/lifecycle/CSRF denial returns 403; repository unavailability returns sanitized 503. Suspended/archived users are blocked and sessions revoked. Unauthenticated logout is treated as already signed out by the frontend; failed server revocation is never reported as successful logout. Phase 3 administration, Phase 4 Student identity and Phase 5 Course/Batch/enrollment endpoints are documented above and enforce their own lifecycle, role, own-record/scope and CSRF checks.

### CSRF and frontend route protection

Mutation requests require exact FRONTEND_URL Origin and a session-bound HMAC CSRF token compared in constant time; missing/foreign origins, missing tokens, and cross-site Fetch Metadata are rejected. CSRF token bootstrap is authenticated, non-cacheable and protected by exact credentialed CORS. CORS alone is not the CSRF defense. The HMAC is derived server-side from the stored session hash; JavaScript never needs the authentication cookie value.

Frontend fetch always includes credentials. Mutation helpers bootstrap CSRF before each request, avoiding stale tokens after session rotation. No authentication tokens are stored in localStorage or sessionStorage. TanStack Query owns current-user state; logout cancels and clears cached data and refreshes routing. Auth state refetches on focus and every minute. A client guard hides content during verification and on failure, but the server-side Express access check is the actual authority.

Next.js Proxy checks the relevant Express access endpoint before rendering to issue HTTP redirects for direct navigation, refresh and session expiry. Each role server page then rechecks through the same transport helper before rendering any profile. No profile, role, or authorization decision is trusted from a browser-supplied header. Checks use no-store requests. Missing/expired sessions go to login, denied roles to unauthorized, and lifecycle states to dedicated screens. The role policy is exact (SUPER_ADMIN does not implicitly gain another role's route); college scoping composes with existing backend middleware and current database assignments rather than trusting browser metadata. The extra check adds a backend round trip on protected page requests and closes the time gap before server rendering.

### Verification and outstanding configuration

Unit/integration tests use only test-directory repositories, mocked transport and controlled signed JWT fixtures. They require no live Atlas database. Production imports contain no mock identity provider or in-memory user/session store. The optional Phase 1 live health test requires RUN_CONNECTIVITY_TEST=true and a running API; normal tests skip it.

Actual Google consent/token exchange, Atlas index creation/persistence, QR encrypted durability, deployed cookie transport and authenticated Student/administration browser flows must be verified with real configuration before launch. Login desktop/mobile appearance and light/dark themes were checked locally. Do not represent fixture tests as live Google/Atlas verification. Phase 3 implements Admin approval, explicit Super Admin provisioning and college management. Phase 4 implements registration, independent Student identities, scoped verification, corrections and encrypted permanent QR. Phase 5 implements scoped Courses/Batches, authorized enrollment/import/history and durable reconciliation. Phase 6 implements immutable Learning Day delivery, Phase 7 implements QR attendance, and Phase 8 implements evidence-backed coding progress. Their external acceptance limits are recorded in the latest phase sections.

## Updating this record

After each implementation phase, preserve these previous phase records and add a new phase section covering scope, architecture, important modules, API changes, environment variable names, actual verification commands/results, unresolved blockers, acceptance criteria and next-phase readiness. Update the current-status table and setup instructions to match the latest implementation. Never claim unexecuted checks passed, and never publish credentials or personal machine information.

When a push is requested, publish application source, tests, lockfiles and safe configuration together with README.md. Keep other Markdown files, secrets, dependencies and generated artifacts ignored. Do not begin a later phase without a separate implementation request.
