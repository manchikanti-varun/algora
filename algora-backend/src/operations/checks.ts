export type CheckStatus =
  'PASS' | 'FAIL' | 'BLOCKED' | 'NOT CONFIGURED' | 'NOT TESTED';
export interface OperationalCheck {
  check: string;
  status: CheckStatus;
  guidance: string;
}
export const API_VERSION = '1';
export function configurationChecks(
  raw: Record<string, string | undefined>,
  node = process.versions.node,
  production = true,
): OperationalCheck[] {
  const checks: OperationalCheck[] = [];
  const add = (check: string, status: CheckStatus, guidance: string) =>
    checks.push({ check, status, guidance });
  const present = (name: string) =>
    !!raw[name] && !/^(?:your[-_ ]|replace|changeme|<)/i.test(raw[name]!);
  const url = (name: string) => {
    try {
      const u = new URL(raw[name] ?? '');
      return !u.username &&
        !u.password &&
        !u.hash &&
        !u.search &&
        ['https:', 'http:'].includes(u.protocol)
        ? u
        : null;
    } catch {
      return null;
    }
  };
  const major = Number(node.split('.')[0]);
  add(
    'Node runtime',
    major >= 22 && major < 27 ? 'PASS' : 'FAIL',
    'Use the package engine range Node 22 through 26.',
  );
  add(
    'Runtime mode',
    !production || raw.NODE_ENV === 'production' ? 'PASS' : 'FAIL',
    'Set NODE_ENV to production on the backend deployment.',
  );
  const front = url('FRONTEND_URL'),
    back = url('BACKEND_API_BASE_URL');
  add(
    'Frontend origin',
    front &&
      front.origin === raw.FRONTEND_URL &&
      (!production || front.protocol === 'https:')
      ? 'PASS'
      : present('FRONTEND_URL')
        ? 'FAIL'
        : 'NOT CONFIGURED',
    'Set FRONTEND_URL to the exact HTTPS frontend origin, without a path or trailing slash.',
  );
  add(
    'Backend API URL',
    back &&
      back.pathname === '/api/v1' &&
      (!production || back.protocol === 'https:')
      ? 'PASS'
      : present('BACKEND_API_BASE_URL')
        ? 'FAIL'
        : 'NOT CONFIGURED',
    'Set BACKEND_API_BASE_URL to the HTTPS Railway API ending in /api/v1 in frontend and operator configuration. Rebuild the frontend after changing it.',
  );
  add(
    'Browser API path',
    raw.NEXT_PUBLIC_API_BASE_URL === '/backend' ? 'PASS' : 'FAIL',
    'Use NEXT_PUBLIC_API_BASE_URL=/backend for the existing same-origin rewrite.',
  );
  const origins = (raw.CORS_ORIGINS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  add(
    'CORS allowlist',
    front &&
      origins.includes(front.origin) &&
      origins.every((v) => {
        try {
          const u = new URL(v);
          return u.origin === v && (!production || u.protocol === 'https:');
        } catch {
          return false;
        }
      })
      ? 'PASS'
      : 'FAIL',
    'List exact frontend origins in CORS_ORIGINS. Do not use wildcards or paths.',
  );
  add(
    'Proxy trust',
    !production || raw.TRUST_PROXY_HOPS === '1' ? 'PASS' : 'FAIL',
    'Use one trusted Railway proxy hop. Verify observed client routing in staging; never blindly trust arbitrary forwarded chains.',
  );
  add(
    'Declared replica count',
    Number(raw.APP_REPLICAS ?? 1) === 1 ? 'PASS' : 'FAIL',
    'Keep one HTTP replica while request rate limits use an in-memory store. Multi-replica deployment needs a reviewed shared rate-limit store.',
  );
  add(
    'Rate-limit capacity',
    !production ||
      (Number(raw.API_RATE_LIMIT ?? 2400) >= 1200 &&
        Number(raw.LOGIN_RATE_LIMIT ?? 480) >= 240)
      ? 'PASS'
      : 'FAIL',
    'Use bounded bootcamp request and login budgets; verify shared campus IP behavior in staging.',
  );
  let mongo = false;
  try {
    const u = new URL(raw.MONGODB_URI ?? '');
    mongo =
      ['mongodb:', 'mongodb+srv:'].includes(u.protocol) &&
      u.pathname.length > 1 &&
      (!production ||
        ((u.protocol === 'mongodb+srv:' ||
          u.searchParams.get('tls') === 'true' ||
          u.searchParams.get('ssl') === 'true') &&
          u.searchParams.get('tls') !== 'false' &&
          u.searchParams.get('ssl') !== 'false'));
  } catch {
    /* status only */
  }
  add(
    'Database configuration',
    mongo ? 'PASS' : present('MONGODB_URI') ? 'FAIL' : 'NOT CONFIGURED',
    'Configure MONGODB_URI with an explicit database name. The URI is never emitted.',
  );
  const google = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ].every(present);
  add(
    'Google OAuth configuration',
    google ? 'PASS' : 'NOT CONFIGURED',
    'Configure the Google client ID, secret and redirect URI together.',
  );
  add(
    'Google callback',
    google &&
      front &&
      raw.GOOGLE_REDIRECT_URI === front.origin + '/backend/auth/google/callback'
      ? 'PASS'
      : google
        ? 'FAIL'
        : 'BLOCKED',
    'Register the exact frontend same-origin /backend/auth/google/callback URL in Google.',
  );
  add(
    'Cookie policy',
    !production || raw.NODE_ENV === 'production' ? 'PASS' : 'FAIL',
    'Production code uses __Host cookies, HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain. Browser transport still requires live acceptance.',
  );
  add(
    'QR key ring',
    qrKeyAvailable(raw.QR_ACTIVE_KEY_ID, raw.QR_ENCRYPTION_KEYS)
      ? 'PASS'
      : 'NOT CONFIGURED',
    'Configure QR_ACTIVE_KEY_ID and a valid 32-byte base64 key ring. Retain old decryption keys; never rotate credentials for routine profile changes.',
  );
  const coding = [
    'CODEFORCES_CLIENT_ID',
    'CODEFORCES_CLIENT_SECRET',
    'CODEFORCES_REDIRECT_URI',
  ].every(present);
  add(
    'Codeforces configuration',
    coding && raw.CODEFORCES_CLIENT_SECRET!.length >= 32
      ? 'PASS'
      : 'NOT CONFIGURED',
    'Configure supported Codeforces OIDC settings; unsupported providers remain unavailable.',
  );
  add(
    'Codeforces callback',
    coding &&
      front &&
      raw.CODEFORCES_REDIRECT_URI ===
        front.origin + '/backend/coding/accounts/codeforces/callback'
      ? 'PASS'
      : coding
        ? 'FAIL'
        : 'BLOCKED',
    'Use the exact frontend same-origin Codeforces callback.',
  );
  add(
    'Coding worker',
    raw.CODING_SYNC_ENABLED === 'true' ? 'PASS' : 'NOT CONFIGURED',
    'Enable the durable worker after database and provider configuration are accepted.',
  );
  add(
    'Preview routes',
    raw.ENABLE_PREVIEW_ROUTES !== 'true' ? 'PASS' : 'FAIL',
    'Disable preview routes for production.',
  );
  return checks;
}
import { qrKeyAvailable } from '../students/keyring.js';
