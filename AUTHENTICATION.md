# Authentication and session security

Phase 2 implements identity and authorization infrastructure only. Database unavailability is intentional until Atlas is configured. There is no production in-memory authentication fallback or privileged development account.

## Deployment and cookie strategy

The browser communicates with `/backend/*` on the frontend origin. A fixed Next.js external rewrite forwards requests to `${BACKEND_API_BASE_URL}/*` on Express. This is a transport rewrite, not a Next.js authentication implementation; no Next.js API handlers, OAuth callbacks, token issuance or session databases are introduced. Server-rendered protected pages call Express directly with only the session cookie and `cache: no-store`.

This small transport layer is necessary to support unrelated Vercel/Railway hostnames without relying on browser third-party cookies. Use it even if custom subdomains become available. Public browser requests use `NEXT_PUBLIC_API_BASE_URL=/backend`; direct cross-site production browser authentication is deliberately unsupported. No `SameSite=None` workaround is used.

Production cookies are host-only `__Host-algora_session` and `__Host-algora_oauth`, with Path=/, Secure, HttpOnly and SameSite=Lax. No Domain attribute is set. Local HTTP development uses `algora_session` / `algora_oauth` without Secure. The callback must be the frontend origin plus `/backend/auth/google/callback`, so cookies are issued through the same public host used for protected pages. Do not configure the public callback as the Railway hostname. TLS must be enabled on both production hosts. Vercel must forward Cookie and Set-Cookie without caching or logging them. Verify this behavior on the actual deployment before launch.

The rewrite target is trusted server configuration, never user input. This introduces one extra frontend-to-backend hop. Keep frontend deployment previews separate from production sessions; use a separate OAuth client/environment for previews rather than wildcard origins or redirects. Configure the exact allowed frontend origin and correct Railway reverse-proxy hop count. Rate limit storage is process-local; a horizontally scaled production deployment needs a shared limiter or edge-level equivalent.

Next.js external rewrites are documented in the [official rewrite reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites). Browser verification of the deployed cookie transport remains required.

## Google Cloud setup

1. Create or select a Google Cloud project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure Google Auth Platform branding, audience/consent, and permitted test users while the application is in testing mode.
3. Create an OAuth client with application type **Web application**.
4. Add the exact authorized redirect URI: frontend origin followed by `/backend/auth/google/callback`. For local development this is `http://localhost:3000/backend/auth/google/callback`; production uses your actual HTTPS frontend origin. Avoid wildcard redirects.
5. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI together on the backend. Never put the client secret in NEXT_PUBLIC variables, Git, screenshots, or chat.
6. Set FRONTEND_URL to the exact frontend origin and include that origin in CORS_ORIGINS. Configure MongoDB and restart the backend. The login page enables Google only when the backend reports configuration and auth storage ready.

Refer to Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) for credential/consent setup and exact redirect matching. Only openid, email and profile scopes are requested. No Google API access or refresh tokens are retained.

## Environment contract

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

## Identity and OAuth sequence

GET /auth/google rejects custom redirects and browser role overrides, checks configuration/storage, and generates state, nonce and PKCE using openid-client. State and browser-binding tokens are hashed in the OAuth transaction store. The verifier and nonce are stored only in the short-lived transaction; the browser receives an opaque HttpOnly binding cookie. Each transaction expires after ten minutes.

The callback atomically consumes a transaction matching state, browser binding and explicit expiry. It checks for a verifier before exchanging the code. The library sends S256 PKCE and validates expected state/nonce, Google issuer, client audience, token time claims and RS256 signature through Google JWKS. Signature checking is explicitly enabled with [enableNonRepudiationChecks](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md). A verified email and stable Google subject are required.

Only the stable Google subject identifies an existing account. Email collisions with another subject are rejected, never automatically linked. Atomic subject upsert plus unique indexes handle concurrent first login. Only profile fields and lastLoginAt are updated on later Google login; role, account/registration status and username are not accepted from Google/browser profile input.

New users are STUDENT / PENDING / NOT_STARTED, without a username. They can view their own session profile and registration-required screen, but no student workspace or learning resources. Existing privileged accounts must already have been securely provisioned/approved; Phase 2 supplies no provisioning or approval route.

A fresh opaque session is created after verification; an existing browser session is revoked to prevent fixation. Status and revocation version are rechecked before issuing the cookie. Redirect destinations come only from a fixed server-side role/status policy, never a request URL. Invalid OAuth callbacks return sanitized API errors; the user can return to the login page to restart. Google cancellation never creates an account session.

## Models and indexes

User: googleSubject (immutable, unique), normalized email (unique), emailVerified, displayName, optional avatarUrl, role, optional immutable username, accountStatus, registrationStatus, sessionVersion, lastLoginAt, createdAt, updatedAt. Username uniqueness uses a partial index for strings, allowing multiple unregistered users without usernames. Names are normalized only by reusable utilities; no username allocation occurs in this phase.

Session: userId reference to User, tokenHash (unique SHA-256 hash), version, expiresAt (TTL index), revokedAt, createdAt, updatedAt. A compound userId/revokedAt index supports revocation. The raw 256-bit random token exists only transiently during issuance and in the HttpOnly cookie, never in responses, logs or browser storage.

OAuthTransaction: unique stateHash, browserHash, verifier, nonce, expiresAt with TTL. Atomic find-and-delete plus explicit expiry prevents replay independent of delayed MongoDB TTL cleanup.

Auth indexes are created after connection before auth storage is considered ready. Failures keep authentication/readiness unavailable. Do not bypass this check or enable login before indexes exist. Plan index changes carefully for existing production datasets; Phase 2 starts without user data. User status changes increment sessionVersion; logout-all does the same and revokes session rows. Every request reloads current User and compares versions, so revocation remains effective even if an older session row is inserted during a race.

## API contract

All routes below are under `/api/v1/auth` on Express and `/backend/auth` from the browser. All auth responses are non-cacheable. Errors use `{ success: false, error: { code, message, requestId } }`; JSON success uses `{ success: true, data: ... }`.

| Method/path | Behavior |
| --- | --- |
| GET /status | Public availability/message for the login button. No credentials or infrastructure details. 200 with available=false when not ready. |
| GET /google | Public OAuth entry, rate-limited; sets transient browser binding cookie and redirects to Google. 503 when configuration/storage unavailable. No request redirect parameters accepted. |
| GET /google/callback | Validates single-use transaction and identity, creates session and redirects to a fixed frontend route. 400/401 on invalid transactions/identity; 503 on storage/provider unavailability. |
| GET /me | Requires valid session; safe own-user profile plus fixed destination. No subject, hashes, token, version or raw OAuth data. |
| GET /csrf | Requires session; session-bound CSRF token, for subsequent mutation headers. |
| POST /logout | Requires session, exact Origin and X-CSRF-Token; revokes current session and clears cookie. |
| POST /logout-all | Same protection; increments revocation version, revokes all devices and clears cookie. |
| POST /refresh | Same protection; atomically rotates the cookie token and CSRF derivation, preserving absolute expiry. |
| GET /access/student | Session + STUDENT + verified registration + ACTIVE account. Returns authorized=true and safe own-user profile only. |
| GET /access/admin | Session + ADMIN + ACTIVE account. No college/admin business data. |
| GET /access/super-admin | Session + SUPER_ADMIN + ACTIVE account. No privileged business operations. |

Session errors return 401; role/lifecycle/CSRF denial returns 403; repository unavailability returns sanitized 503. Suspended/archived users are blocked and sessions revoked. Unauthenticated logout is treated as already signed out by the frontend; failed server revocation is never reported as successful logout. Non-auth business endpoints do not exist.

## CSRF and frontend route protection

Mutation requests require exact FRONTEND_URL Origin and a session-bound HMAC CSRF token compared in constant time; missing/foreign origins, missing tokens, and cross-site Fetch Metadata are rejected. CSRF token bootstrap is authenticated, non-cacheable and protected by exact credentialed CORS. CORS alone is not the CSRF defense. The HMAC is derived server-side from the stored session hash; JavaScript never needs the authentication cookie value.

Frontend fetch always includes credentials. Mutation helpers bootstrap CSRF before each request, avoiding stale tokens after session rotation. No authentication tokens are stored in localStorage or sessionStorage. TanStack Query owns current-user state; logout cancels and clears cached data and refreshes routing. Auth state refetches on focus and every minute. A client guard hides content during verification and on failure, but the server-side Express access check is the actual authority.

Next.js Proxy checks the relevant Express access endpoint before rendering to issue HTTP redirects for direct navigation, refresh and session expiry. Each role server page then rechecks through the same transport helper before rendering any profile. No profile, role, or authorization decision is trusted from a browser-supplied header. Checks use no-store requests. Missing/expired sessions go to login, denied roles to unauthorized, and lifecycle states to dedicated screens. The role policy is exact (SUPER_ADMIN does not implicitly gain another role's route); future college scoping must compose with existing backend middleware rather than trusting browser metadata. The extra check adds a backend round trip on protected page requests and closes the time gap before server rendering.

## Verification and outstanding configuration

Unit/integration tests use only test-directory repositories, mocked transport and controlled signed JWT fixtures. They require no live Atlas database. Production imports contain no mock identity provider or in-memory user/session store. The optional Phase 1 live health test requires RUN_CONNECTIVITY_TEST=true and a running API; normal tests skip it.

Actual Google consent/token exchange, Atlas index creation/persistence, deployed cookie transport, responsive appearance and browser theme behavior must be verified with real configuration before launch. Do not represent fixture tests as live Google/Atlas verification. No Admin approval, Super Admin provisioning, student registration, college/course management or attendance features are implemented.
