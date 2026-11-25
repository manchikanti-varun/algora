# Deployment (staging and production)

The short version with exact variables and the go-live checklist is in `PRODUCTION.md`.

Topology: Next.js on Vercel → (same-origin `/api/v1/*` rewrite) → Express on Railway → MongoDB Atlas. No other services.

## 1. Google OAuth client (needed before anyone can sign in)

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, app name "Algora", support email, your domain. Add test users while in Testing mode, or publish.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorized JavaScript origins:** `http://localhost:3000`, your Vercel staging URL (e.g. `https://algora-staging.vercel.app`), and the production domain. No redirect URIs are needed (Google Identity Services ID-token flow).
4. Copy the client ID into both `GOOGLE_CLIENT_ID` (Railway) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel). The client secret is not used.

## 2. MongoDB Atlas

1. Create a project and an M0 (free) or M10 cluster in a region near Railway's (e.g. `ap-south-1` with Railway `asia-southeast1`).
2. Database user with `readWrite` on database `algora` only.
3. Network access: Railway egress IPs are not static on all plans; allow `0.0.0.0/0` only with a strong password, or use a Railway static outbound IP and allow just that.
4. Connection string: `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/algora?retryWrites=true&w=majority`. Atlas is always a replica set, so fenced transactions work.
5. Indexes are created at backend start-up (`syncIndexes`). Back up before the first production deploy: Atlas → Backup (M10+) or `mongodump`.

## 3. Railway (backend)

1. New project → Deploy from GitHub → choose the repo, **root directory `algora-backend`**. `railway.json` sets build (`npm ci && npm run build`), start (`npm start`) and health check (`/health`).
2. Variables (see `algora-backend/.env.example` for all):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas connection string |
| `GOOGLE_CLIENT_ID` | from step 1 |
| `SUPER_ADMIN_EMAIL` | the single Super Admin's Google email |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `FRONTEND_URL` | exact Vercel origin, e.g. `https://algora-staging.vercel.app` (no trailing slash) |
| `TRUST_PROXY_HOPS` | `1` |
| `LEETCODE_SYNC_ENABLED` | `false` (until authorised) |
| `LEETCODE_PROVIDER` | `none` |

3. Generate a Railway domain (Settings → Networking). This is `BACKEND_URL` for Vercel. Browsers never call it directly.
4. One instance is enough for 200 students (see load test). If you scale the API to more replicas later, set `LEETCODE_SCHEDULER_ENABLED=false` on the API and add a second service from the same repo with start command `npm run start:worker`.

The backend refuses to start if any required variable is missing or invalid, if `SUPER_ADMIN_EMAIL` is not an email, if the mock provider is configured in production, or if a real provider is enabled without `LEETCODE_PERMISSION_REF`.

## 4. Vercel (frontend)

1. Import the repo, **root directory `algora-frontend`**, framework Next.js.
2. Environment variables (Production and Preview): `BACKEND_URL=https://<railway-domain>` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id>`.
3. `BACKEND_URL` is read at **build time** (rewrites). Changing it requires a redeploy.
4. Every Vercel preview URL is a different origin. CSRF and CORS only accept `FRONTEND_URL`, so test previews against a staging backend whose `FRONTEND_URL` matches, or use one fixed staging domain.

## 5. Staging verification checklist (manual, in a real browser)

Nothing below has been run against real Google or Atlas yet. Tick each item in staging:

- [ ] `GET https://<railway>/health` returns `{"ok":true,"db":"up"}` and `/ready` returns `{"ready":true,…}`.
- [ ] The Google button renders and sign-in completes with no CSP errors in the browser console (first real test of the CSP's Google allowances).
- [ ] `/trainer/login` with the `SUPER_ADMIN_EMAIL` account → lands on `/manage/dashboard`. Sign out, sign in again → same account (no duplicate).
- [ ] A different Google account on `/trainer/login` → access-request form → request appears under Trainers → approve → that account signs in to `/manage`.
- [ ] Suspend the trainer → their next click returns them to the login page.
- [ ] New Google account on `/login` → registration; a second account with the same roll number is rejected.
- [ ] Enroll an unregistered roll number → claim code → register with it → enrolled automatically.
- [ ] Cookie `algora_session` is `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to the Vercel domain (DevTools → Application → Cookies).
- [ ] A POST from the browser console without `x-csrf-token` returns 403.
- [ ] Railway logs show `x-forwarded-for` client IPs being used (rate limits per client, not per proxy). If every request shows the same IP, adjust `TRUST_PROXY_HOPS`.
- [ ] Integration health page says verification is disabled; student dashboard says verification is unavailable.

## 6. Enabling LeetCode verification later

Only after written permission and a passing live PoC (`LIVE_POC_RUNBOOK.md`). The exact per-provider steps are in `LEETCODE_PROVIDERS.md` §5. In short:
1. Set `LEETCODE_PERMISSION_REF`, the agreed `LEETCODE_GLOBAL_RATE_PER_MIN`, `LEETCODE_CONTACT` and a consenting `LEETCODE_HEALTHCHECK_USERNAME`.
2. Enable one or more of `LEETCODE_DIRECT_ENABLED`, `LEETCODE_ALFA_ENABLED` (plus base URL and permission ref), `LEETCODE_QUERY_ENABLED`, then set `LEETCODE_SYNC_ENABLED=true`.
3. Open **Integration health**, run a health check, and confirm each enabled provider is `OK`.

Production refuses to start if the mock provider is enabled, if a real provider is enabled without `LEETCODE_PERMISSION_REF`, or if Alfa is enabled without a base URL and permission reference.
