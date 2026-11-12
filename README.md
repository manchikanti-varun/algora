# Algora — Where Logic Grows

Phase 2: independent Next.js frontend and Express API with Google OpenID Connect, MongoDB-backed sessions, CSRF protection and role-based access checks. No approval, provisioning, registration, courses or attendance workflows exist. Nothing has been deployed automatically.

## Local development

Use Node.js 22 LTS (`.nvmrc`) and npm.

Open two PowerShell terminals from this directory:

```powershell
cd algora-backend
npm ci
Copy-Item .env.example .env
# Set MONGODB_URI to your local MongoDB or Atlas connection string.
npm run dev
```

```powershell
cd algora-frontend
npm ci
Copy-Item .env.example .env.local
# Optional: set ENABLE_PREVIEW_ROUTES=true to view development shells.
npm run dev
```

Frontend: http://localhost:3000. API: http://localhost:5000/api/v1. The browser uses `/backend`, a same-origin rewrite to Express. Set frontend `BACKEND_API_BASE_URL` to the real backend API base; keep `NEXT_PUBLIC_API_BASE_URL=/backend`.

See [AUTHENTICATION.md](AUTHENTICATION.md) for OAuth setup, cookies, environment configuration, API contracts, model/index details, and limitations. With Google or MongoDB unavailable, login stays unavailable and no session is created.

The footer indicator requests the real HTTP health endpoint. It reports liveness, not database readiness. Click it to retry; it refreshes every 30 seconds. With MongoDB unavailable, health remains 200 and readiness returns 503. The server retries database connection every five seconds, logging no connection strings.

## Routes

- `/`: landing page; future platform capabilities are labeled as planned.
- `/login`: Google sign-in with backend availability checking and session-expired messaging.
- `/student`, `/admin`, `/super-admin`: server-verified role workspaces; Express enforces the authoritative permission check before any user profile is rendered.
- `/registration-required`, `/account-pending`: session-verified account lifecycle screens; no registration or approval workflows yet.
- `/account-suspended`, `/unauthorized`: safe public explanations without user data.
- `/preview/student`, `/preview/admin`, `/preview/super-admin`: interactive navigation shells, available only when both NODE_ENV=development and ENABLE_PREVIEW_ROUTES=true. Production always returns 404. These routes implement no access control and contain no user data.
- `GET /api/v1/health`: HTTP liveness, 200.
- `GET /api/v1/ready`: MongoDB connected plus successful ping, 200; otherwise 503. Unexpected failures use the sanitized error envelope.

Success responses use `{ success: true, data: ... }`. Errors use `{ success: false, error: { code, message, requestId } }`. Every request receives a generated X-Request-ID header. Logs contain request ID, HTTP status and duration, without bodies, query strings, credentials, or raw exception messages.

## Environment

Frontend `.env.local`:

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_API_BASE_URL | Browser API prefix; use `/backend` for same-origin authentication. No secrets. |
| BACKEND_API_BASE_URL | Server-only Express API base, including `/api/v1`, used by the rewrite and server-side route verification. Required in production. |
| ENABLE_PREVIEW_ROUTES | Server-only switch, defaults false; only effective in development. |

Backend `.env`:

| Variable | Purpose |
| --- | --- |
| MONGODB_URI | Required MongoDB connection URI; secret, backend only. |
| NODE_ENV | development, test, production; default development. |
| PORT | Railway-assigned port, or 5000 locally. |
| CORS_ORIGINS | Comma-separated exact frontend origins; no wildcard. |
| TRUST_PROXY_HOPS | Default 0. Set to verified reverse proxy hop count for hosting; review your Railway topology before using 1. |
| LOG_LEVEL | Pino log level; default info. |

Keep environment files untracked. Never put a database URI in NEXT_PUBLIC variables. Atlas requires a database user, network access rules, and valid TLS connectivity. Production credentials should use a dedicated least-privilege database account.

## Checks

Run independently inside each app:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Frontend production builds require BACKEND_API_BASE_URL and use NEXT_PUBLIC_API_BASE_URL=/backend. Prettier is available as `npm run format`. Lockfiles pin installed versions; use npm ci in CI. Automated authentication tests require neither Google credentials nor Atlas. Real integrations must be verified separately.

## Deployment preparation

For an optional real API-client integration check, start the backend and run this inside the frontend:

```powershell
$env:RUN_CONNECTIVITY_TEST='true'
npm test
```

Both apps pin a patched minimatch range through a scoped npm override for lint-tool dependency advisories. Frontend ESLint 9 is retained for the Next.js plugins' declared peer compatibility; npm emits a deprecation notice. Full dependency audits were clean at implementation time.

Vercel: choose `algora-frontend` as root, set NEXT_PUBLIC_API_BASE_URL=/backend and server-only BACKEND_API_BASE_URL to the Railway HTTPS API base including `/api/v1`. Use npm ci and npm run build. Configure the Google callback through the frontend `/backend/auth/google/callback` path. Preview shells are unavailable in production.

Railway: choose `algora-backend` as root, configure environment variables, build with npm ci and npm run build, start with npm start. `railway.json` uses `/api/v1/health` for process liveness; use `/api/v1/ready` for dependency monitoring. The API binds 0.0.0.0 and the assigned PORT. SIGINT/SIGTERM close HTTP connections and MongoDB with a 10-second forced shutdown deadline. No persistent filesystem storage is used.

Only canonical User, Session and short-lived OAuthTransaction models exist. There are no course, attendance, college, approval, or student-registration models. No email/password or OTP login exists. Mock repositories and identity fixtures are confined to automated tests.
