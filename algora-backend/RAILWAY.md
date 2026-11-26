# Railway recovery and LeetCode configuration

The restart originated in the application's environment parser before Express or MongoDB startup. The production validator treated missing optional access information as a fatal error. The patched server and optional worker keep core startup validation strict and evaluate LeetCode activation independently. A production MongoDB server without transaction support can serve core routes while synchronization stays inactive.

## Railway service

| Setting | Value |
| --- | --- |
| Root directory | `/algora-backend` |
| Config file path | `/algora-backend/railway.json` |
| Builder | Railpack, with Node 22 from .nvmrc |
| Build command | `npm run build` |
| Start command | `npm start` |
| Watch path | `/algora-backend/**` |
| Healthcheck | `/ready`, timeout 60 seconds |
| Restart | On failure, maximum 5 retries |

Use the existing Railway service and deployment branch. Railway's legacy config-file support is scheduled to end on December 1, 2026. Keep the equivalent build, deploy and healthcheck settings on the service so they persist after the cutoff. The config path is relative to the repository root, independent of the build root. [Railway config reference](https://docs.railway.com/config-as-code/reference) · [Railway build settings](https://docs.railway.com/builds/build-configuration)

Preserve the existing secret values on redeploy.

```dotenv
NODE_ENV=production
MONGODB_URI=<existing Atlas MongoDB URI>
GOOGLE_CLIENT_ID=<existing Google Web OAuth client ID>
SUPER_ADMIN_EMAIL=<existing Super Admin email>
SESSION_SECRET=<existing random secret of at least 32 characters>
FRONTEND_URL=https://algora-one-wine.vercel.app
TRUST_PROXY_HOPS=1

LEETCODE_SYNC_ENABLED=false
LEETCODE_ACCESS_BASIS=NONE
LEETCODE_DIRECT_ENABLED=false
LEETCODE_QUERY_ENABLED=false
LEETCODE_ALFA_ENABLED=false
LEETCODE_MOCK_ENABLED=false
```

Use the actual production frontend origin if the service has a custom domain. Verify the proxy hop count against the service deployment. Railway injects `PORT`. Leave all other integration settings unset for core-only operation, including optional references. Defaults and optional controls are in [.env.example](.env.example). Follow existing session rotation procedures if rotating a secret. [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)

Deploy the backend first. Confirm that Railway accepts `GET /ready`, that `GET /health` reports database connectivity, and that an existing signed-in persona can load courses and batches. A student can save their username while sync is inactive. Deploy the frontend update for clearer diagnostics. Monitor startup logs and Super Admin → Integration health. No database migration or additional service is required for this fix. Rolling back to the old backend can restore the crash if its LeetCode switches remain on.

## Access and activation

- Boolean switches accept `true` or `false`. Blank optional settings are treated as unset. The priority is a comma-separated list of `direct`, `leetcode-query`, `alfa` and optionally `mock` in development.
- `LEETCODE_ACCESS_BASIS` accepts `NONE`, `OWN_RISK`, `TERMS`, `WRITTEN_PERMISSION`, `LICENSED_THIRD_PARTY`, `INSTITUTIONAL`, or `COMMERCIAL`. The last five require `LEETCODE_ACCESS_REF` containing a reference up to 200 characters covering the data source and intended use. Store document identifiers here rather than secrets. Algora validates completeness and does not verify the underlying rights.
- A legacy `LEETCODE_PERMISSION_REF` can supply the reference only when `WRITTEN_PERMISSION` is explicitly configured. Migrate to `LEETCODE_ACCESS_REF` and remove the legacy variable. The backend no longer reads its unused `GOOGLE_CLIENT_SECRET` or `BACKEND_URL`. The frontend still reads `BACKEND_URL` for its proxy.
- `OWN_RISK` is a recorded owner decision. It leaves external providers unauthorized. Provider health is observed separately from access and activation. A healthy historical response cannot grant access or activate a provider.
- Missing or malformed access, invalid operational settings, a disabled provider, and missing production transaction support leave the applicable providers inactive. Invalid provider-specific options affect only that provider. An invalid health-check username disables probes. An invalid scheduler switch disables scheduling in that process. Student linking is independent.
- After obtaining an applicable access arrangement and separately approving activation, set `LEETCODE_SYNC_ENABLED=true`, and enable only the providers named in that arrangement with `LEETCODE_DIRECT_ENABLED=true` and/or `LEETCODE_QUERY_ENABLED=true`. Direct precedes Query by default. Use `LEETCODE_QUERY_MODE=accepted` for Track A. Match `LEETCODE_GLOBAL_RATE_PER_MIN` and any per-provider ceilings to the approved limits. Leave Alfa and mock disabled. For an approved Alfa deployment, use its HTTPS `LEETCODE_ALFA_BASE_URL` and a separate `LEETCODE_ALFA_PERMISSION_REF` for that relay.
- Use `LEETCODE_SCHEDULER_ENABLED=false` during a controlled manual test. The optional health-check username must belong to a consenting account. No production live test was performed as part of this recovery.

## Alternatives reviewed

Direct and LeetCode Query are implemented and tested with controlled fixtures. They share LeetCode as their upstream. Alfa is a community relay. API.SH publishes a recent-accepted-submissions REST endpoint sourced from public LeetCode pages, with 1,000 free credits per month. Even polling 200 students once per weekday would use over 4,000 calls in a typical month. Its public documentation does not establish independent evidence provenance or an applicable grant from LeetCode. Account-export tools read the account or LeetCode APIs and do not provide a trusted, independent automatic feed by username. The LeetCode API Platform login page does not publicly establish submission coverage, terms or quotas for this use. No qualifying independent provider was identified or added. [LeetCode terms](https://leetcode.com/terms/) · [LeetCode API Platform](https://leet.ai/) · [Alfa repository](https://github.com/alfaarghya/alfa-leetcode-api) · [API.SH LeetCode API](https://api.sh/leetcode-api)
