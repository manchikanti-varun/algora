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
| Phase 4 | Student registration and subsequent scope | Not started; requires a separate implementation request. |

Real Google consent/login, Atlas persistence/index creation, deployed cookie transport and authenticated dashboard browser flows remain unverified. The real login entry was visually checked on desktop in light theme and mobile in dark theme. Automated fixtures do not establish a live Google/Atlas integration.

## Contents

- [Phase 1 — Project foundation](#phase-1--project-foundation)
- [Phase 2 — Authentication and authorization](#phase-2--authentication-and-authorization)
- [Phase 3 — Super Admin and college administration](#phase-3--super-admin-and-college-administration)
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

This section records the Phase 1 snapshot. Later phases extend its behavior; use the current setup and Phase 2 sections for today's authentication configuration.

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

Run inside each application: npm run lint, npm run typecheck, npm test and npm run build. Production frontend builds require BACKEND_API_BASE_URL; browser requests use NEXT_PUBLIC_API_BASE_URL=/backend. The optional live health test needs RUN_CONNECTIVITY_TEST=true and the local API running.

## Authentication configuration and contracts

Phase 2 implements identity and authorization infrastructure only. Database unavailability is intentional until Atlas is configured. There is no production in-memory authentication fallback or privileged development account.

### Deployment and cookie strategy

The browser communicates with `/backend/*` on the frontend origin. A fixed Next.js external rewrite forwards requests to `${BACKEND_API_BASE_URL}/*` on Express. This is a transport rewrite, not a Next.js authentication implementation; no Next.js API handlers, OAuth callbacks, token issuance or session databases are introduced. Server-rendered protected pages call Express directly with only the session cookie and `cache: no-store`.

This small transport layer is necessary to support unrelated Vercel/Railway hostnames without relying on browser third-party cookies. Use it even if custom subdomains become available. Public browser requests use `NEXT_PUBLIC_API_BASE_URL=/backend`; direct cross-site production browser authentication is deliberately unsupported. No `SameSite=None` workaround is used.

Production cookies are host-only `__Host-algora_session` and `__Host-algora_oauth`, with Path=/, Secure, HttpOnly and SameSite=Lax. No Domain attribute is set. Local HTTP development uses `algora_session` / `algora_oauth` without Secure. The callback must be the frontend origin plus `/backend/auth/google/callback`, so cookies are issued through the same public host used for protected pages. Do not configure the public callback as the Railway hostname. TLS must be enabled on both production hosts. Vercel must forward Cookie and Set-Cookie without caching or logging them. Verify this behavior on the actual deployment before launch.

The rewrite target is trusted server configuration, never user input. This introduces one extra frontend-to-backend hop. Keep frontend deployment previews separate from production sessions; use a separate OAuth client/environment for previews rather than wildcard origins or redirects. Configure the exact allowed frontend origin and correct Railway reverse-proxy hop count. Rate limit storage is process-local; a horizontally scaled production deployment needs a shared limiter or edge-level equivalent.

Next.js external rewrites are documented in the [official rewrite reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites). Browser verification of the deployed cookie transport remains required.

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

New users are STUDENT / PENDING / NOT_STARTED, without a username. They can view their own session profile and registration-required screen, but no student workspace or learning resources. Privileged accounts use the explicit Phase 3 operator provisioning command or the authenticated Super Admin approval workflow. Browser role selection never assigns privilege.

A fresh opaque session is created after verification; an existing browser session is revoked to prevent fixation. Status and revocation version are rechecked before issuing the cookie. Redirect destinations come only from a fixed server-side role/status policy, never a request URL. Invalid OAuth callbacks return sanitized API errors; the user can return to the login page to restart. Google cancellation never creates an account session.

### Models and indexes

User: googleSubject (immutable, unique), normalized email (unique), emailVerified, displayName, optional avatarUrl, role, optional immutable username, accountStatus, registrationStatus, sessionVersion, lastLoginAt, createdAt, updatedAt. Username uniqueness uses a partial index for strings, allowing multiple unregistered users without usernames. Names are normalized only by reusable utilities; privileged usernames are allocated only by the controlled Phase 3 provisioning/approval workflows. Student allocation remains unimplemented.

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

Session errors return 401; role/lifecycle/CSRF denial returns 403; repository unavailability returns sanitized 503. Suspended/archived users are blocked and sessions revoked. Unauthenticated logout is treated as already signed out by the frontend; failed server revocation is never reported as successful logout. Phase 3 administration endpoints are documented above and enforce their own lifecycle, role, scope and CSRF checks.

### CSRF and frontend route protection

Mutation requests require exact FRONTEND_URL Origin and a session-bound HMAC CSRF token compared in constant time; missing/foreign origins, missing tokens, and cross-site Fetch Metadata are rejected. CSRF token bootstrap is authenticated, non-cacheable and protected by exact credentialed CORS. CORS alone is not the CSRF defense. The HMAC is derived server-side from the stored session hash; JavaScript never needs the authentication cookie value.

Frontend fetch always includes credentials. Mutation helpers bootstrap CSRF before each request, avoiding stale tokens after session rotation. No authentication tokens are stored in localStorage or sessionStorage. TanStack Query owns current-user state; logout cancels and clears cached data and refreshes routing. Auth state refetches on focus and every minute. A client guard hides content during verification and on failure, but the server-side Express access check is the actual authority.

Next.js Proxy checks the relevant Express access endpoint before rendering to issue HTTP redirects for direct navigation, refresh and session expiry. Each role server page then rechecks through the same transport helper before rendering any profile. No profile, role, or authorization decision is trusted from a browser-supplied header. Checks use no-store requests. Missing/expired sessions go to login, denied roles to unauthorized, and lifecycle states to dedicated screens. The role policy is exact (SUPER_ADMIN does not implicitly gain another role's route); college scoping composes with existing backend middleware and current database assignments rather than trusting browser metadata. The extra check adds a backend round trip on protected page requests and closes the time gap before server rendering.

### Verification and outstanding configuration

Unit/integration tests use only test-directory repositories, mocked transport and controlled signed JWT fixtures. They require no live Atlas database. Production imports contain no mock identity provider or in-memory user/session store. The optional Phase 1 live health test requires RUN_CONNECTIVITY_TEST=true and a running API; normal tests skip it.

Actual Google consent/token exchange, Atlas index creation/persistence, deployed cookie transport and authenticated administration browser flows must be verified with real configuration before launch. Login desktop/mobile appearance and light/dark themes were checked locally. Do not represent fixture tests as live Google/Atlas verification. Phase 3 implements Admin approval, explicit Super Admin provisioning and college management. Student registration, courses and attendance remain unimplemented.

## Updating this record

After each implementation phase, preserve these previous phase records and add a new phase section covering scope, architecture, important modules, API changes, environment variable names, actual verification commands/results, unresolved blockers, acceptance criteria and next-phase readiness. Update the current-status table and setup instructions to match the latest implementation. Never claim unexecuted checks passed, and never publish credentials or personal machine information.

When a push is requested, publish application source, tests, lockfiles and safe configuration together with README.md. Keep other Markdown files, secrets, dependencies and generated artifacts ignored. Do not begin a later phase without a separate implementation request.
