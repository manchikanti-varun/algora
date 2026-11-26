import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app';
import { College, syncAllIndexes } from '../src/models';
import { registryFields } from '../src/modules/colleges/registry';

// Fake Google verification: token format "tok|sub|email|name"
vi.mock('../src/modules/auth/google', () => ({
  verifyGoogleIdToken: async (t: string) => {
    const [p, sub, email, name] = t.split('|');
    if (p !== 'tok') {
      const { unauthorized } = await import('../src/lib/errors.js');
      throw unauthorized('Invalid Google credential');
    }
    return { sub, email, name: name ?? 'Test User' };
  },
}));

let mongod: MongoMemoryReplSet;
export async function startDb() {
  // Replica set: transactions (fenced writes) need it and so does Atlas.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  await syncAllIndexes();
}
export async function stopDb() {
  await mongoose.disconnect();
  await mongod.stop();
}
export async function resetDb() {
  (await import('../src/modules/progress/progress.service.js')).clearBoardCache();
  (await import('../src/modules/leetcode/integration-settings.js')).invalidateSettings();
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
  defaultCollegeId = String((await seedCollege('JNTU', 'JNTU'))._id);
}

/** Create a canonical college the way an administrator would. */
export async function seedCollege(name: string, code: string, aliases: string[] = []) {
  return College.create(await registryFields({ name, code, aliases }));
}

export async function otherCollege(name = 'Other College', code = 'OTHER') {
  return seedCollege(name, code);
}

let defaultCollegeId = '';
export const collegeId = () => defaultCollegeId;

export const app = createApp();
// Leaderboard memoisation is a production optimisation; tests assert immediate consistency.
process.env.ALGORA_BOARD_CACHE = 'off';
export const tok = (sub: string, email: string, name = 'Test User') => `tok-${'x'.repeat(20)}`.replace(/^tok-.*/, `tok|${sub}|${email}|${name}`).padEnd(20, ' ');

export const studentBody = (over: Record<string, unknown> = {}) => ({
  firstName: 'Asha', lastName: 'Rao', rollNumber: 'ab12cd34ef', collegeId: defaultCollegeId,
  mobile: '9876543210', leetcodeUsername: 'asha_rao', leetcodeConsent: true, ...over,
});

/** Login and return an agent-like helper that carries cookie + csrf. */
export async function login(idToken: string) {
  const res = await request(app).post('/api/v1/auth/google').set('Origin', 'http://localhost:3000').send({ idToken });
  const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0];
  const csrf = res.body.csrfToken as string | undefined;
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown) => {
    let r = request(app)[method](`/api/v1${url}`).set('Origin', 'http://localhost:3000');
    if (cookie) r = r.set('Cookie', cookie);
    if (csrf) r = r.set('X-CSRF-Token', csrf);
    return body === undefined ? r : r.send(body as object);
  };
  return { res, call, cookie, csrf };
}

import { LeetcodeLink, linkFlags, SolveEvidence, User } from '../src/models';
import { resetTxSupportCache } from '../src/lib/lease';
resetTxSupportCache();

/** Create a LINKED LeetCode account for a student (test shortcut for the linking flow). */
export async function verifiedLink(studentId: any, username: string) {
  const link = await LeetcodeLink.create({ studentId, username, usernameNorm: username.toLowerCase(), status: 'LINKED', ...linkFlags('LINKED'), kind: 'INITIAL', linkedAt: new Date(), consentedAt: new Date() });
  await User.updateOne({ _id: studentId }, { $set: { leetcodeUsername: username } });
  return link;
}
/** Write counting evidence the way a sync would (MOCK_DEV source), tied to the link. */
export async function evidenceFor(studentId: any, link: any, slug: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  return SolveEvidence.updateOne(
    { studentId, linkId: link._id, slug, leetcodeUsername: link.usernameNorm, source: 'MOCK_DEV' },
    { $set: { status: 'VERIFIED', provider: 'mock', lastVerifiedAt: now, ...extra }, $setOnInsert: { firstVerifiedAt: now } }, { upsert: true });
}
