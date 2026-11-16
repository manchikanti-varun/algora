import { config } from 'dotenv';
import mongoose from 'mongoose';
import {
  configurationChecks,
  API_VERSION,
  type OperationalCheck,
} from '../operations/checks.js';
import { inspectDatabase } from '../operations/database.js';
config({ quiet: true });
const raw = { ...process.env };
// Operators may load a local frontend env file explicitly; no env values are emitted.
const configuration = configurationChecks(
  raw,
  process.versions.node,
  !process.argv.includes('--local'),
);
const checks = [...configuration];
if (
  process.argv.includes('--database') &&
  checks.find((c) => c.check === 'Database configuration')?.status === 'PASS'
) {
  let connection: mongoose.Connection | undefined;
  try {
    connection = await mongoose
      .createConnection(raw.MONGODB_URI!, {
        autoCreate: false,
        autoIndex: false,
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        maxPoolSize: 2,
      })
      .asPromise();
    checks.push(...(await inspectDatabase(connection)));
  } catch {
    checks.push({
      check: 'Live database',
      status: 'BLOCKED',
      guidance:
        'Connection unavailable. Check network, credentials and Atlas access without publishing the URI.',
    });
  } finally {
    await connection?.close().catch(() => {
      checks.push({
        check: 'Database probe cleanup',
        status: 'BLOCKED',
        guidance:
          'Connection cleanup did not complete; review operator connectivity.',
      });
    });
  }
} else
  checks.push({
    check: 'Live database',
    status: raw.MONGODB_URI ? 'NOT TESTED' : 'BLOCKED',
    guidance:
      'Run preflight --database with operator configuration. This probe is read-only.',
  });
if (
  process.argv.includes('--http') &&
  checks.find((c) => c.check === 'Backend API URL')?.status === 'PASS'
) {
  try {
    const r = await fetch(
      raw.BACKEND_API_BASE_URL!.replace(/\/$/, '') + '/health',
      { signal: AbortSignal.timeout(5000), redirect: 'error' },
    );
    const body: unknown = await r.json();
    checks.push({
      check: 'API compatibility',
      status:
        r.ok &&
        r.headers.get('x-algora-api-version') === API_VERSION &&
        typeof body === 'object' &&
        body !== null &&
        'success' in body &&
        body.success === true
          ? 'PASS'
          : 'FAIL',
      guidance:
        'Health and API contract header must match. Redirects are rejected.',
    });
  } catch {
    checks.push({
      check: 'API compatibility',
      status: 'BLOCKED',
      guidance:
        'The configured backend could not be checked. Verify endpoint access and HTTPS.',
    });
  }
} else
  checks.push({
    check: 'API compatibility',
    status: 'NOT TESTED',
    guidance: 'Run preflight --http to check the configured backend contract.',
  });
for (const [check, present] of [
  ['Live Google OAuth', !!raw.GOOGLE_CLIENT_ID],
  ['Deployed browser cookies', !!raw.FRONTEND_URL],
  ['Real camera', false],
  ['Live Codeforces verification', !!raw.CODEFORCES_CLIENT_ID],
] as const)
  checks.push({
    check,
    status: present ? 'NOT TESTED' : 'BLOCKED',
    guidance:
      'Complete the documented real-environment acceptance flow. Configuration or unit tests do not prove live acceptance.',
  } satisfies OperationalCheck);
console.log(
  JSON.stringify(
    {
      configurationReady: configuration.every((c) => c.status === 'PASS'),
      productionAccepted: false,
      checks,
    },
    null,
    2,
  ),
);
process.exitCode = checks.some((c) => c.status === 'FAIL')
  ? 1
  : checks.some((c) => c.status !== 'PASS')
    ? 2
    : 0;
