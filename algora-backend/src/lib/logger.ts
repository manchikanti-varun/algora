import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

/**
 * Structured JSON logs (one line per event) for Railway's log search. Never logs cookies, tokens, request bodies or emails.
 * Level via LOG_LEVEL (debug|info|warn|error, default info). Development/test print the same JSON.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
const quiet = process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TESTS;

function serializeError(e: unknown) {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack?.split('\n').slice(0, 8).join('\n'), code: (e as { code?: unknown }).code };
  return { message: String(e) };
}
function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (quiet || ORDER[level] < min) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v instanceof Error ? serializeError(v) : v])) });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}
export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};

declare global { namespace Express { interface Request { id?: string } } }

/** Request id (reused from a trusted upstream header if well-formed) + one access-log line per request. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/ready') return;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const level: Level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 429 ? 'warn' : 'info';
    write(level, 'request', { reqId: req.id, method: req.method, path: req.baseUrl + req.path, status: res.statusCode, ms: Math.round(ms), user: req.user ? String(req.user._id) : undefined, role: req.user?.role });
  });
  next();
};
