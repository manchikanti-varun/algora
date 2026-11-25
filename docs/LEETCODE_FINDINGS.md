# LeetCode integration: findings

> **Superseded in part.** The trainer-attested and self-report options below were rejected: they are not implemented and legacy rows never count. Current decision: `LEETCODE_DECISION.md`. Current architecture: `ARCHITECTURE.md`.

Checked on the date of this commit.

## Access restrictions found

| Source | Finding |
|---|---|
| `https://leetcode.com/robots.txt` | `User-agent: *` has `Disallow: /graphql` and `Disallow: /submissions`. |
| `https://leetcode.com/terms/` (last modified 04/05/2024) | "Activities such as crawling, scraping, or spidering any part of the Service ... are strictly forbidden." Also prohibits any process that "operates while you are not logged into the platform." |

## What was and was not tested

- Tested: the PoC harness (`algora-backend/scripts/leetcode-poc.ts`) reads robots.txt, detects the `/graphql` rule, and aborts with exit code 2. No request was sent to `/graphql`.
- **Not tested:** profile data, recent accepted submissions, slug format, timestamps, window size. Testing them means automated calls to a path that robots.txt disallows, and the terms forbid it. I did not do it, and no consenting accounts were available in this session.
- Consequence: **automated verification of LeetCode submissions is not demonstrated and, as things stand, is not permitted.** Behaviours I described earlier (a window of about 20 recent submissions, field names) come from general knowledge of the unofficial API, not from a test.

## Options

1. **Ask LeetCode for written permission** (support@leetcode.com), describing: about 200 students, read-only public data, one request per student per 45 minutes. If granted, set `LEETCODE_WRITTEN_PERMISSION=<reference>`, run the PoC with consenting usernames, and then enable the automated provider.
2. **Trainer-attested verification** (built now): trainers mark a student's problem as verified with an evidence reference, singly or by CSV. Students can self-report, which creates `PENDING` evidence that does not count.
3. **Check at the source:** a trainer spot-checks a student's public LeetCode profile in a normal browser session. That is a manual human action, not automation.

The app is built so evidence has a `source` and an automated provider can be added later without changing progress or leaderboard logic. The automated provider is not implemented. Phase 7 is blocked on option 1.
