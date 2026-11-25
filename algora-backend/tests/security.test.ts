import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { User } from '../src/models';
import { app, login, resetDb, startDb, stopDb, tok } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);
const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');

describe('security hardening', () => {
  it('logout invalidates the session server-side (a copied cookie stops working)', async () => {
    const a = await login(ADMIN);
    expect((await a.call('get', '/auth/me')).status).toBe(200);
    expect((await a.call('post', '/auth/logout')).status).toBe(204);
    // replay the old cookie
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', a.cookie!)).status).toBe(401);
  });

  it('rate limits: auth 20/min per client, keyed by user when signed in; JSON 429 body', async () => {
    (env as any).NODE_ENV = 'development';
    try {
      let last = 0;
      for (let i = 0; i < 22; i++) last = (await request(app).post('/api/v1/auth/google').set('Origin', 'http://localhost:3000').send({ idToken: 'garbage-garbage-garbage-1' })).status;
      expect(last).toBe(429);
      const r = await request(app).post('/api/v1/trainer-requests').set('Origin', 'http://localhost:3000').send({ idToken: 'x'.repeat(25), fullName: 'X' });
      expect(r.status).toBe(429); // same anonymous client, shared auth limiter
      expect(r.body.error.code).toBe('RATE_LIMITED');
    } finally { (env as any).NODE_ENV = 'test'; }
  });

  it('unknown routes, malformed JSON and bad ids return safe errors without internals', async () => {
    const a = await login(ADMIN);
    const nf = await a.call('get', '/does-not-exist');
    expect(nf.status).toBe(404);
    const bad = await request(app).post('/api/v1/auth/google').set('Origin', 'http://localhost:3000').set('content-type', 'application/json').send('{"idToken":');
    expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).not.toMatch(/stack|at .*\.ts/);
    expect((await a.call('get', '/batches/not-an-id')).status).toBe(400);
    expect((await a.call('get', '/batches/{"$gt":""}')).status).toBe(400); // operator injection via path
  });

  it('query operator injection is impossible: bracket keys are not parsed into objects and unknown keys are dropped', async () => {
    const a = await login(ADMIN);
    await User.create({ googleSub: 's', email: 's@x.com', role: 'STUDENT', fullName: 'Plain Name', rollNumber: 'AAAAAAAAAA' });
    const r = await a.call('get', '/students?q[$regex]=.*&status[$ne]=X');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1); // behaves exactly like no filter; nothing reached MongoDB as an operator
    expect((await a.call('get', '/analytics/students?batchId=%7B%22%24ne%22%3A1%7D')).status).toBe(400); // JSON in a value fails id validation
  });

  it('regex search input is escaped (no ReDoS / wildcard expansion)', async () => {
    const a = await login(ADMIN);
    await User.create({ googleSub: 's', email: 's@x.com', role: 'STUDENT', fullName: 'Plain Name', rollNumber: 'AAAAAAAAAA' });
    expect((await a.call('get', '/students?q=.*')).body.total).toBe(0);
    expect((await a.call('get', '/students?q=(a%2B)%2B%24')).status).toBe(200);
  });

  it('public responses never expose SUPER_ADMIN_EMAIL, googleSub or session internals', async () => {
    const r = await request(app).post('/api/v1/auth/google').set('Origin', 'http://localhost:3000').send({ idToken: tok('x1', 'someone@x.com') });
    expect(JSON.stringify(r.body)).not.toContain('admin@example.com');
    const a = await login(ADMIN);
    const me = await a.call('get', '/auth/me');
    expect(JSON.stringify(me.body)).not.toMatch(/googleSub|sessionVersion|sub-admin/);
    const h = await request(app).get('/health');
    expect(h.body).toEqual({ ok: true, db: 'up' });
    expect(h.headers['x-powered-by']).toBeUndefined();
  });
});
