import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { app, login, resetDb, startDb, stopDb, tok } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

describe('production hardening', () => {
  it('every response carries a request id; a well-formed upstream id is reused, a malformed one replaced', async () => {
    const a = await request(app).get('/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request(app).get('/health').set('x-request-id', 'vercel-abc12345')).headers['x-request-id']).toBe('vercel-abc12345');
    expect((await request(app).get('/health').set('x-request-id', 'bad id with spaces')).headers['x-request-id']).not.toBe('bad id with spaces');
  });
  it('/ready reports DB and start-up state', async () => {
    const r = await request(app).get('/ready');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ready: true, db: 'up', startup: 'done' });
  });
  it('500 responses expose only a request id', async () => {
    const r = await request(app).post('/api/v1/auth/google').set('Origin', 'http://localhost:3000').set('content-type', 'application/json').send('{"idToken": 1}');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|\.ts:/);
  });
  it('session secret rotation: cookies and CSRF tokens signed with the previous secret keep working, then stop when it is removed', async () => {
    const a = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    const old = env.SESSION_SECRET;
    (env as any).SESSION_SECRET = 'n'.repeat(20) + 'rotated-secret-value-xyz';
    (env as any).SESSION_SECRET_PREVIOUS = old;
    try {
      expect((await a.call('get', '/auth/me')).status).toBe(200);
      expect((await a.call('post', '/colleges', { name: 'Rotation College' })).status).toBe(201); // old CSRF token accepted
      (env as any).SESSION_SECRET_PREVIOUS = undefined;
      expect((await a.call('get', '/auth/me')).status).toBe(401);
    } finally { (env as any).SESSION_SECRET = old; (env as any).SESSION_SECRET_PREVIOUS = undefined; }
  });
  it('helmet security headers are present and x-powered-by is not', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('only the configured origin receives CORS headers', async () => {
    const ok = await request(app).options('/api/v1/auth/me').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).options('/api/v1/auth/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
