# Railway deployment and LeetCode configuration

## Railway service

| Setting | Value |
| --- | --- |
| Root directory | `/algora-backend` |
| Config file path | `/algora-backend/railway.json` |
| Builder | Railpack, Node 22 from `.nvmrc` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Watch path | `/algora-backend/**` |
| Healthcheck | `/ready`, timeout 60 s |
| Restart | On failure, maximum 5 retries |

Railway's legacy config-file support is scheduled to end on December 1, 2026. Keep the same build, deploy and healthcheck settings on the service itself so they survive the cutoff. [Railway config reference](https://docs.railway.com/config-as-code/reference)

After a deploy, `GET /ready` must return `{"ready":true,"db":"up","startup":"done"}`.

## Environment variables

Core (keep existing secret values):

```dotenv
NODE_ENV=production
MONGODB_URI=<Atlas URI>
GOOGLE_CLIENT_ID=<Google Web OAuth client ID>
SUPER_ADMIN_EMAIL=<Super Admin email>
SESSION_SECRET=<random, at least 32 characters>
# SESSION_SECRET_PREVIOUS=<old secret, only while rotating>
FRONTEND_URL=https://algora-one-wine.vercel.app
TRUST_PROXY_HOPS=1
LOG_LEVEL=info
```

LeetCode (sync requested, but inactive until access is authorised):

```dotenv
LEETCODE_SYNC_ENABLED=true
LEETCODE_SCHEDULER_ENABLED=true
LEETCODE_PROVIDER_PRIORITY=direct,leetcode-query
LEETCODE_DIRECT_ENABLED=false
LEETCODE_QUERY_ENABLED=false
LEETCODE_ALFA_ENABLED=false
LEETCODE_MOCK_ENABLED=false
LEETCODE_ACCESS_BASIS=NONE
LEETCODE_HEALTHCHECK_USERNAME=<your own consenting LeetCode username>
LEETCODE_QUERY_MODE=accepted
LEETCODE_GLOBAL_RATE_PER_MIN=10
LEETCODE_DIRECT_RATE_PER_MIN=10
LEETCODE_QUERY_RATE_PER_MIN=10
LEETCODE_STUDENT_COOLDOWN_SEC=600
LEETCODE_CONCURRENCY=2
LEETCODE_SYNC_INTERVAL_MINUTES=30
LEETCODE_PROVIDER_TIMEOUT_MS=10000
LEETCODE_PROVIDER_FAILURE_THRESHOLD=5
LEETCODE_PROVIDER_RECOVERY_INTERVAL_SEC=120
LEETCODE_MAX_FAILOVER=1
LEETCODE_BOOTCAMP_HOURS=09:30-16:30
LEETCODE_BOOTCAMP_DAYS=1,2,3,4,5
LEETCODE_TZ_OFFSET_MIN=330
LEETCODE_BOOTCAMP_START=2026-12-07
LEETCODE_BOOTCAMP_END=2026-12-11
```

Remove if present: `LEETCODE_PERMISSION_REF`, `LEETCODE_ALFA_PERMISSION_REF`, `LEETCODE_ALFA_BASE_URL`, `LEETCODE_ALFA_CACHE_SEC`, `LEETCODE_ALFA_RATE_PER_MIN`.

Vercel needs `BACKEND_URL=https://<railway-domain>` (read at build time) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## Access and activation

The LeetCode GraphQL endpoint needs no API key. `LEETCODE_ACCESS_BASIS` and `LEETCODE_ACCESS_REF` are Algora's own record of why it may make requests; Algora checks they are complete, not that the rights exist.

| `LEETCODE_ACCESS_BASIS` | Also required | Real providers |
| --- | --- | --- |
| `NONE` | none | Inactive |
| `OWN_RISK` | none | Inactive (internal risk acceptance is not upstream permission) |
| `TERMS`, `WRITTEN_PERMISSION`, `LICENSED_THIRD_PARTY`, `INSTITUTIONAL`, `COMMERCIAL` | `LEETCODE_ACCESS_REF` (up to 200 characters, a document identifier, not a secret) | Authorised |

A provider runs only when all of these hold: `LEETCODE_SYNC_ENABLED=true`, its `LEETCODE_*_ENABLED=true`, an authorised basis, MongoDB transactions available (Atlas), and not paused or disabled by the Super Admin. Authorisation is read at startup. When any condition fails, the rest of Algora keeps working and students see "Verification unavailable".

Activation, once a real access arrangement exists and the owner approves it:

```dotenv
LEETCODE_ACCESS_BASIS=<the basis that is true>
LEETCODE_ACCESS_REF=<identifier of the supporting document>
LEETCODE_DIRECT_ENABLED=true
```

Then in Super Admin → LeetCode integration: **Resume synchronization** if paused, and **Run health check** once. `OK` or `EMPTY_WINDOW` means Railway can reach LeetCode. `UPSTREAM_ACCESS_DENIED` or `UPSTREAM_RATE_LIMITED` means LeetCode or Cloudflare is refusing the requests; synchronization pauses itself and must not be forced.

## Synchronization behaviour

- `LEETCODE_SCHEDULER_ENABLED=true` runs both the scheduler and the queue worker. Keep it on: manual updates also go through the queue. With several API replicas, set it to `false` on the replicas and run `npm run start:worker` as one extra service.
- Automatic sync: 30 minutes after each student's last successful sync, only inside the bootcamp hours, days and term.
- Manual sync: once per 600 s per student, at any time (not limited by bootcamp hours or dates). A manual success resets the automatic timer.
- Every request, from any provider, retry or health check, counts against one shared budget (`LEETCODE_GLOBAL_RATE_PER_MIN`). When demand exceeds it, jobs wait in the queue and students see "Update queued" or "Update delayed".
- HTTP 429, access-denied and Cloudflare challenges pause every provider that depends on LeetCode; Algora does not fail over around them.
- Super Admin runtime settings can pause, disable a provider, or lower limits. They never raise a value above the environment. The settings tab shows where each effective value comes from; **Reset to defaults** returns to the environment values.

## Rollback

- Immediate stop: Super Admin → **Pause synchronization**.
- Configuration stop: `LEETCODE_SYNC_ENABLED=false`.
- Code rollback: redeploy the previous Railway release. New collections and fields are ignored by older code; do not delete `solve_evidence`.
