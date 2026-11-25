import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User, Enrollment, PendingEnrollment, Batch } from '../src/models';
import { reconcileSuperAdmin } from '../src/modules/auth/superAdmin';
import { sha256 } from '../src/lib/normalize';
import { app, login, resetDb, startDb, stopDb, studentBody, tok } from './helpers';
import { env } from '../src/config/env';
import mongoose from 'mongoose';

const ADMIN = tok('sub-admin', 'admin@example.com', 'Admin');
const post = (url: string, body: object) => request(app).post(`/api/v1${url}`).set('Origin', 'http://localhost:3000').send(body);

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

describe('Super Admin', () => {
  it('is created on first login (email normalised) and recognised afterwards', async () => {
    const a = await login(ADMIN);
    expect(a.res.body.user.role).toBe('SUPER_ADMIN');
    expect(JSON.stringify(a.res.body)).not.toContain('sub-admin');
    await login(ADMIN);
    expect(await User.countDocuments({ role: 'SUPER_ADMIN' })).toBe(1);
  });

  it('does not grant admin to any other email', async () => {
    const r = await login(tok('sub-x', 'mallory@example.com'));
    expect(r.res.body.status).toBe('REGISTRATION_REQUIRED');
    expect(r.cookie).toBeUndefined();
  });

  it('refuses a different Google account with the admin email', async () => {
    await login(ADMIN);
    const r = await post('/auth/google', { idToken: tok('other-sub', 'admin@example.com') });
    expect(r.status).toBe(409);
  });

  it('does not elevate a pre-existing account that has the admin email', async () => {
    await User.create({ googleSub: 'sub-admin', email: 'admin@example.com', role: 'STUDENT', fullName: 'S', rollNumber: 'ZZ00000000' });
    const r = await post('/auth/google', { idToken: ADMIN });
    expect(r.status).toBe(409);
    expect((await User.findOne({ email: 'admin@example.com' }))!.role).toBe('STUDENT');
  });

  it('revokes the previous admin and kills their session when the env email changes', async () => {
    const a = await login(ADMIN);
    expect((await a.call('get', '/auth/me')).status).toBe(200);
    const original = env.SUPER_ADMIN_EMAIL;
    (env as any).SUPER_ADMIN_EMAIL = 'new@example.com';
    try {
      expect((await a.call('get', '/auth/me')).status).toBe(401); // per-request revalidation
      expect(await reconcileSuperAdmin()).toBe(1);
      const old = await User.findOne({ email: 'admin@example.com' });
      expect(old!.status).toBe('REVOKED');
      const again = await post('/auth/google', { idToken: ADMIN });
      expect(again.status).toBe(403);
      const n = await login(tok('sub-new', 'new@example.com'));
      expect(n.res.body.user.role).toBe('SUPER_ADMIN');
    } finally {
      (env as any).SUPER_ADMIN_EMAIL = original;
    }
  });

  it('database rejects a second active super admin', async () => {
    await login(ADMIN);
    await expect(User.create({ googleSub: 's2', email: 'b@example.com', role: 'SUPER_ADMIN', fullName: 'B' })).rejects.toThrow();
  });
});

describe('Sessions and CSRF', () => {
  it('rejects invalid Google tokens and unauthenticated /me', async () => {
    expect((await post('/auth/google', { idToken: 'garbage-garbage-garbage-1' })).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });
  it('rejects unsafe requests without CSRF token or from a foreign origin', async () => {
    const a = await login(ADMIN);
    const noCsrf = await request(app).patch('/api/v1/trainers/507f1f77bcf86cd799439011/suspend').set('Origin', 'http://localhost:3000').set('Cookie', a.cookie!);
    expect(noCsrf.status).toBe(403);
    const evil = await request(app).post('/api/v1/auth/google').set('Origin', 'http://evil.com').send({ idToken: ADMIN });
    expect(evil.status).toBe(403);
  });
});

describe('Trainer workflow', () => {
  const T = tok('sub-t', 'rahul@example.com', 'Rahul Sharma');
  const reqBody = { idToken: T, fullName: 'Rahul Sharma' };

  it('request -> pending -> approve -> trainer login; unique IDs for duplicate names', async () => {
    expect((await post('/auth/google', { idToken: T })).body.status).toBe('REGISTRATION_REQUIRED');
    expect((await post('/trainer-requests', reqBody)).status).toBe(201);
    expect((await post('/auth/google', { idToken: T })).body.status).toBe('PENDING_APPROVAL');

    const admin = await login(ADMIN);
    const list = await admin.call('get', '/trainer-requests?status=PENDING_APPROVAL');
    expect(list.body.items).toHaveLength(1);
    const ap = await admin.call('patch', `/trainer-requests/${list.body.items[0]._id}/approve`);
    expect(ap.body.trainerId).toBe('tr_rahulsharma');

    const t = await login(T);
    expect(t.res.body.user.role).toBe('TRAINER');

    // Duplicate name
    await post('/trainer-requests', { idToken: tok('sub-t2', 'r2@example.com'), fullName: 'Rahul  Sharma' });
    const l2 = await admin.call('get', '/trainer-requests?status=PENDING_APPROVAL');
    const ap2 = await admin.call('patch', `/trainer-requests/${l2.body.items[0]._id}/approve`);
    expect(ap2.body.trainerId).toBe('tr_rahulsharma2');
    expect((await admin.call('patch', `/trainer-requests/${l2.body.items[0]._id}/approve`)).status).toBe(409);
  });

  it('trainer cannot approve; student cannot hit admin routes', async () => {
    await post('/trainer-requests', reqBody);
    const admin = await login(ADMIN);
    const id = (await admin.call('get', '/trainer-requests')).body.items[0]._id;
    await admin.call('patch', `/trainer-requests/${id}/approve`);
    const t = await login(T);
    expect((await t.call('patch', `/trainer-requests/${id}/approve`)).status).toBe(403);
    expect((await t.call('get', '/trainers')).status).toBe(403);
  });

  it('rejection is reported at login; suspension kills sessions and blocks login', async () => {
    await post('/trainer-requests', reqBody);
    const admin = await login(ADMIN);
    const id = (await admin.call('get', '/trainer-requests')).body.items[0]._id;
    await admin.call('patch', `/trainer-requests/${id}/reject`, { reason: 'No' });
    const r = await post('/auth/google', { idToken: T });
    expect(r.body).toMatchObject({ status: 'REJECTED', reason: 'No' });

    await post('/trainer-requests', reqBody); // resubmit
    const id2 = (await admin.call('get', '/trainer-requests?status=PENDING_APPROVAL')).body.items[0]._id;
    await admin.call('patch', `/trainer-requests/${id2}/approve`);
    const t = await login(T);
    expect((await t.call('get', '/auth/me')).status).toBe(200);
    const trainerUser = await User.findOne({ role: 'TRAINER' });
    expect((await admin.call('patch', `/trainers/${trainerUser!._id}/suspend`)).status).toBe(200);
    expect((await t.call('get', '/auth/me')).status).toBe(401);
    expect((await post('/auth/google', { idToken: T })).status).toBe(403);
  });
});

describe('Student registration', () => {
  const S = tok('sub-s', 'asha@example.com', 'Asha Rao');
  it('registers, normalises roll number, enforces global uniqueness', async () => {
    const r = await post('/auth/register/student', { idToken: S, ...studentBody() });
    expect(r.status).toBe(201);
    expect(r.body.user.rollNumber).toBe('AB12CD34EF');
    expect(r.body.user.role).toBe('STUDENT');
    const dup = await post('/auth/register/student', { idToken: tok('sub-s2', 'b@example.com'), ...studentBody({ college: 'Other College' }) });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ROLL_NUMBER_TAKEN');
  });
  it('validates input and ignores client-supplied role', async () => {
    expect((await post('/auth/register/student', { idToken: S, ...studentBody({ rollNumber: 'short' }) })).status).toBe(400);
    const r = await post('/auth/register/student', { idToken: S, ...studentBody(), role: 'SUPER_ADMIN' });
    expect(r.body.user.role).toBe('STUDENT');
  });
  it('admin email cannot register as student', async () => {
    expect((await post('/auth/register/student', { idToken: ADMIN, ...studentBody() })).status).toBe(403);
  });

  describe('pending enrollment claims', () => {
    async function reserve(extra: object = {}) {
      const admin = await User.create({ googleSub: 'a', email: 'a@x.com', role: 'TRAINER', fullName: 'T' });
      const batch = await Batch.create({ name: 'B', createdBy: admin._id });
      await PendingEnrollment.create({ batchId: batch._id, rollNumber: 'AB12CD34EF', claimCodeHash: sha256('SECRET'), createdBy: admin._id, ...extra });
      return batch;
    }
    it('blocks claiming a reserved roll number without email match or code', async () => {
      await reserve();
      const r = await post('/auth/register/student', { idToken: S, ...studentBody() });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('ROLL_NUMBER_RESERVED');
      expect(await User.countDocuments({ role: 'STUDENT' })).toBe(0);
    });
    it('activates enrollment with the correct claim code', async () => {
      const b = await reserve();
      const r = await post('/auth/register/student', { idToken: S, ...studentBody({ claimCode: 'SECRET' }) });
      expect(r.status).toBe(201);
      expect(r.body.enrolledBatches).toBe(1);
      expect(await Enrollment.countDocuments({ batchId: b._id, status: 'ACTIVE' })).toBe(1);
      expect((await PendingEnrollment.findOne())!.status).toBe('CLAIMED');
    });
    it('activates enrollment when the verified email matches', async () => {
      await reserve({ email: 'asha@example.com' });
      expect((await post('/auth/register/student', { idToken: S, ...studentBody() })).body.enrolledBatches).toBe(1);
    });
    it('rejects a wrong claim code', async () => {
      await reserve();
      expect((await post('/auth/register/student', { idToken: S, ...studentBody({ claimCode: 'nope' }) })).status).toBe(403);
    });
  });
});

describe('Environment', () => {
  it('refuses to load with a missing/invalid SUPER_ADMIN_EMAIL', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const saved = process.env.SUPER_ADMIN_EMAIL;
    process.env.SUPER_ADMIN_EMAIL = 'not-an-email';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('../src/config/env.js')).rejects.toThrow('Invalid environment');
    delete process.env.SUPER_ADMIN_EMAIL;
    vi.resetModules();
    await expect(import('../src/config/env.js')).rejects.toThrow('Invalid environment');
    spy.mockRestore();
    process.env.SUPER_ADMIN_EMAIL = saved;
  });
});
