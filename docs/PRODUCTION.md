# Going to production

The code is prepared for production. What remains is your configuration and the checks that need real accounts: Google OAuth, Atlas, Railway and Vercel. Setup details for each service are in `DEPLOYMENT.md` §1–4.

## 1. Railway (backend) variables

Root directory `algora-backend`. Build, start and health check come from `railway.json`.

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `MONGODB_URI` | yes | Atlas `mongodb+srv://…/algora?retryWrites=true&w=majority` (must not be localhost) |
| `GOOGLE_CLIENT_ID` | yes | Web OAuth client id (`…apps.googleusercontent.com`) |
| `SUPER_ADMIN_EMAIL` | yes | the one Super Admin's Google email |
| `SESSION_SECRET` | yes | `openssl rand -base64 48`. Placeholders such as "changeme" are refused. |
| `FRONTEND_URL` | yes | exact Vercel origin, `https://…`, no trailing slash |
| `TRUST_PROXY_HOPS` | no | `1` (Railway edge). Check in staging logs that client IPs appear. |
| `LOG_LEVEL` | no | `info` |
| `SESSION_SECRET_PREVIOUS` | no | only while rotating secrets (see §5) |
| `LEETCODE_SYNC_ENABLED` | no | `false` until LeetCode permission and the live PoC (`LEETCODE_PROVIDERS.md` §5) |

Railway sets `PORT` itself. Do **not** set `ALLOW_LOCAL_MONGODB`, `LEETCODE_MOCK_ENABLED` or any `*_ENABLED=true` LeetCode provider flag without the permission reference.

## 2. Vercel (frontend) variables

Root directory `algora-frontend`. Set these for **Production** (and Preview, pointing at a staging backend):

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://<your-railway-domain>` (read at **build** time; redeploy after changing it) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | the same client id as `GOOGLE_CLIENT_ID` |

A Vercel production build **fails on purpose** if either is missing, or if `BACKEND_URL` is not https.

## 3. What the code enforces in production (verified)

Verified by running the compiled backend (`node dist/server.js`) with `NODE_ENV=production`:

- **Start-up refuses** when `SUPER_ADMIN_EMAIL` is missing or invalid, `SESSION_SECRET` is short or a placeholder, `FRONTEND_URL` is not https, `MONGODB_URI` is localhost, the mock provider is enabled, a real LeetCode provider lacks `LEETCODE_PERMISSION_REF`, or Alfa lacks its base URL or permission reference. Each refusal is logged as a JSON line listing every problem.
- **Probes:** `GET /health` (liveness, used by Railway) and `GET /ready` (DB ping plus start-up finished).
- **CORS and CSRF:** CORS headers go only to `FRONTEND_URL`. Unsafe requests from other origins, or with no origin, get 403. A fake Google token is rejected by the real Google verifier.
- **Logging:** structured JSON logs with a request id on every response (`x-request-id`), and no cookies, tokens, request bodies or emails. 500 responses contain only a request id.
- **Shutdown:** SIGTERM drains the server and disconnects MongoDB, with a 15 s hard stop. Keep-alive is tuned above proxy idle timeouts.
- **Frontend headers:**
  - CSP (Google Identity Services allowed: `accounts.google.com/gsi/*`), HSTS, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, nosniff.
  - Referrer-Policy, Permissions-Policy (FedCM allowed for Google), `Cross-Origin-Opener-Policy: same-origin-allow-popups`.
  - `noindex` plus a `robots.txt` that disallows everything.
- **Error pages:** a custom 404, a route error page and a global error page.
- **Dependencies:** `npm audit --omit=dev` shows 0 vulnerabilities in both apps. Node is pinned to `>=20.11 <27` (`.nvmrc`: 22).
- **CI:** `.github/workflows/ci.yml` type-checks, tests, builds and audits both apps on every push and pull request.

## 4. Backups

- **Atlas M10+:** turn on Cloud Backup with continuous or daily snapshots.
- **Atlas M0 (free):** there are no automatic backups. Run `MONGODB_URI=… npm run backup` from a machine with MongoDB Database Tools, at least daily during a bootcamp. Store the archives off the machine. This was tested: backup, then restore into a separate database, all documents restored.
- **Restore drill before go-live:** restore into `algora_restore` (command in `scripts/ops/backup.sh`), check the counts, then drop it.

## 5. Operations

- **Monitoring:**
  - Railway health check on `/health` (restarts on failure). Add an uptime monitor on `https://<vercel>/` and on `/health`.
  - Search Railway logs for `"level":"error"`. Every error carries a `reqId`, which users see in error responses.
- **Integration health:** the LeetCode page in the Super Admin portal, once verification is enabled.
- **Rotating `SESSION_SECRET` without signing everyone out:**
  1. Set `SESSION_SECRET_PREVIOUS` to the current value.
  2. Set `SESSION_SECRET` to a new value and deploy.
  3. After 7 days (the session lifetime), remove `SESSION_SECRET_PREVIOUS`.
- **Changing the Super Admin:** change `SUPER_ADMIN_EMAIL` and redeploy. The previous admin is revoked at start-up.
- **Scaling:** one instance handles 200 students comfortably (measured). For more than one instance, set `LEETCODE_SCHEDULER_ENABLED=false` on the API and run `npm run start:worker` as a second service. In-process rate limits (`express-rate-limit`) are per instance.

## 6. Go-live checklist (needs your accounts)

1. [ ] Google OAuth client created; authorised JavaScript origins include the Vercel URL.
2. [ ] Atlas cluster, user with `readWrite` on `algora`, network access, backup plan (§4).
3. [ ] Railway and Vercel variables set (§1–2); both deploy green; `https://<railway>/ready` returns `ready: true`.
4. [ ] Staging checklist in a real browser (`DEPLOYMENT.md` §5). This is the first time real Google sign-in and the CSP's Google allowances are exercised.
5. [ ] Load check against staging: `LOAD_STUDENTS=200 node tests/load/run.mjs` is for local runs only. For staging, run a short manual pilot instead; never load-test LeetCode.
6. [ ] Restore drill done.
7. [ ] Pilot with one batch. Course management, batches, enrollment and chapter unlocking work without LeetCode verification.
8. [ ] LeetCode verification enabled only after written permission and the live PoC.
