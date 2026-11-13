# Algora — Where Logic Grows

Algora is a multi-college DSA bootcamp and course management platform under development. This README is the cumulative implementation record and is updated after every phase.

## Publication policy

**README.md is the only Markdown document published to GitHub.** The repository includes frontend and backend source, tests, package manifests and lockfiles, sanitized environment templates, CI and deployment configuration. Other Markdown documents remain local and ignored. Dependencies, build output, screenshots, real environment files and credentials are excluded.

No credentials, authentication tokens, private keys, personal email addresses or local machine paths belong in this document. Environment variable names and generic localhost examples are documentation only.

## Current status

| Phase | Scope | Implementation and verification |
| --- | --- | --- |
| Phase 1 | Project foundation and branded UI | Implemented; 22 tests passed at handoff; lint, types and builds passed. Real Atlas/browser verification remained blocked. |
| Phase 2 | Google OAuth, sessions, lifecycle and authorization | Implemented; 104 tests passed (67 backend, 37 frontend); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. |
| Phase 3 | Super Admin, colleges and Admin approval | Implemented locally; 196 tests passed (139 backend, 57 frontend); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. Live integration remains blocked. |
| Phase 4 | Student registration, verification, profiles, corrections and permanent QR | Implemented locally; 275 tests passed (200 backend, 75 frontend including separate real API health test); lint, types and production builds passed; both dependency audits reported zero vulnerabilities. Live integration remains blocked. |
| Phase 5 | Course/Batch management, roll-only enrollment and reconciliation | Implemented locally; 368 tests passed (270 backend, 98 frontend including separate live API health); lint, types and production builds passed; both audits reported zero vulnerabilities. Live Google/Atlas verification remains blocked. |
| Phase 6 | Immutable curricula, Learning Days, problem/editorial authoring and Student learning | Implemented locally; 488 tests passed (356 backend, 132 frontend including separate live API health); formatting, lint, types and production builds passed; both audits reported zero vulnerabilities. Live Atlas/Google and authenticated visual verification remain blocked. |
| Phase 7 | QR attendance | Not started; awaiting review and a separate implementation request. |

Real Google consent/login, Atlas persistence/index creation, deployed cookie transport and authenticated dashboard browser flows remain unverified. The real login entry was visually checked on desktop in light theme and mobile in dark theme. Automated fixtures do not establish a live Google/Atlas integration.

## Contents

- [Phase 1 — Project foundation](#phase-1--project-foundation)
- [Phase 2 — Authentication and authorization](#phase-2--authentication-and-authorization)
- [Phase 3 — Super Admin and college administration](#phase-3--super-admin-and-college-administration)
- [Phase 4 — Student identity, verification and permanent QR](#phase-4--student-identity-verification-and-permanent-qr)
- [Phase 5 — Courses, batches and roll-based enrollment](#phase-5--courses-batches-and-roll-based-enrollment)
- [Phase 6 — Learning Days and immutable curriculum](#phase-6--learning-days-and-immutable-curriculum)
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

## Authentication configuration and contracts

Phase 2 implements identity and authorization infrastructure only. Database unavailability is intentional until Atlas is configured. There is no production in-memory authentication fallback or privileged development account.

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

Verified Students with current effective enrollment open their own Course/Batch learning path and any released Day. Current roll, profile, College, Course and Batch eligibility remain mandatory on every content request. There is no sequential completion or solved-state tracking. Real persisted and authenticated browser checks remain blocked until dependencies are configured.

### Student identity and QR setup

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

Actual Google consent/token exchange, Atlas index creation/persistence, QR encrypted durability, deployed cookie transport and authenticated Student/administration browser flows must be verified with real configuration before launch. Login desktop/mobile appearance and light/dark themes were checked locally. Do not represent fixture tests as live Google/Atlas verification. Phase 3 implements Admin approval, explicit Super Admin provisioning and college management. Phase 4 implements registration, independent Student identities, scoped verification, corrections and encrypted permanent QR. Phase 5 implements scoped Courses/Batches, authorized enrollment/import/history and durable reconciliation. Learning Day content, attendance and coding progress remain unimplemented.

## Updating this record

After each implementation phase, preserve these previous phase records and add a new phase section covering scope, architecture, important modules, API changes, environment variable names, actual verification commands/results, unresolved blockers, acceptance criteria and next-phase readiness. Update the current-status table and setup instructions to match the latest implementation. Never claim unexecuted checks passed, and never publish credentials or personal machine information.

When a push is requested, publish application source, tests, lockfiles and safe configuration together with README.md. Keep other Markdown files, secrets, dependencies and generated artifacts ignored. Do not begin a later phase without a separate implementation request.
