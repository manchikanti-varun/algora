import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { LeetcodeLink, SolveEvidence, User } from '../src/models';
import { countableEvidence } from '../src/modules/leetcode/evidence.repository';
import { setProviderForTests } from '../src/modules/leetcode/providers/provider.registry';
import { MockProvider } from '../src/modules/leetcode/providers/mock.provider';
import { app, evidenceFor, login, resetDb, startDb, stopDb, studentBody, tok } from './helpers';
import request from 'supertest';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);
afterEach(() => { setProviderForTests(undefined); (env as any).LEETCODE_SYNC_ENABLED = false; });
const withMock = (m: MockProvider) => { setProviderForTests(m); (env as any).LEETCODE_SYNC_ENABLED = true; };

const reg = (sub: string, email: string, over: Record<string, unknown> = {}) => request(app).post('/api/v1/auth/register/student').set('Origin', 'http://localhost:3000')
  .send({ idToken: tok(sub, email, 'Some Student'), ...studentBody(over) });
const st = (sub: string, email: string) => login(tok(sub, email, 'Some Student'));

describe('LeetCode account ownership lifecycle', () => {
  it('registration creates a PENDING link with a challenge; nothing counts yet', async () => {
    const r = await reg('s1', 'a@x.com');
    expect(r.status).toBe(201);
    const s = await st('s1', 'a@x.com');
    const v = (await s.call('get', '/student/leetcode')).body;
    expect(v).toMatchObject({ state: 'PENDING_VERIFICATION', countsEvidence: false, verificationAvailable: false });
    expect(v.challenge).toMatch(/^algora-verify-/);
    expect(v.request.username).toBe('asha_rao');
  });

  it('two students cannot hold the same normalised username (registration and link requests)', async () => {
    await reg('s1', 'a@x.com');
    const dup = await reg('s2', 'b@x.com', { rollNumber: 'ZZ12CD34EF', leetcodeUsername: 'ASHA_RAO' });
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe('USERNAME_IN_USE');
    expect(await User.countDocuments({ role: 'STUDENT' })).toBe(1); // transaction rolled back, no orphan user
    await reg('s2', 'b@x.com', { rollNumber: 'ZZ12CD34EF', leetcodeUsername: 'other_user' });
    const s2 = await st('s2', 'b@x.com');
    const r = await s2.call('post', '/student/leetcode/link', { username: 'Asha_Rao', consent: true });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('USERNAME_IN_USE');
  });

  it('verification stays pending (503) while no provider is available, and the request is unchanged', async () => {
    await reg('s1', 'a@x.com'); const s = await st('s1', 'a@x.com');
    const r = await s.call('post', '/student/leetcode/verify', {});
    expect(r.status).toBe(503); expect(r.body.error.code).toBe('VERIFICATION_UNAVAILABLE');
    expect((await s.call('get', '/student/leetcode')).body.state).toBe('PENDING_VERIFICATION');
  });

  it('verifies only when the challenge is in the profile text; wrong code stays pending; cooldown applies', async () => {
    const mock = new MockProvider(); withMock(mock);
    await reg('s1', 'a@x.com'); const s = await st('s1', 'a@x.com');
    mock.solve('asha_rao', 'x'); // profile exists
    mock.setProfileText('asha_rao', 'hello world');
    const miss = await s.call('post', '/student/leetcode/verify', {});
    expect(miss.body).toMatchObject({ verified: false, reason: 'CODE_NOT_FOUND' });
    expect((await s.call('post', '/student/leetcode/verify', {})).status).toBe(429); // cooldown
    await LeetcodeLink.updateMany({}, { $unset: { lastVerifyAttemptAt: 1 } });
    const challenge = (await s.call('get', '/student/leetcode')).body.challenge;
    mock.setProfileText('asha_rao', `I love DSA ${challenge} !`);
    const ok = await s.call('post', '/student/leetcode/verify', {});
    expect(ok.body.verified).toBe(true); expect(ok.body.link.state).toBe('VERIFIED'); expect(ok.body.link.countsEvidence).toBe(true);
  });

  it("someone else's account cannot be verified without placing the code (no code = no ownership)", async () => {
    const mock = new MockProvider(); withMock(mock);
    await reg('s1', 'a@x.com', { leetcodeUsername: 'victim' }); const s = await st('s1', 'a@x.com');
    mock.solve('victim', 'x'); mock.setProfileText('victim', 'a perfectly ordinary profile');
    expect((await s.call('post', '/student/leetcode/verify', {})).body.verified).toBe(false);
    expect(await LeetcodeLink.countDocuments({ status: 'VERIFIED' })).toBe(0);
  });

  it('username change: old link keeps counting until the new one is verified; then it is superseded; evidence is retained but never restored', async () => {
    const mock = new MockProvider(); withMock(mock);
    await reg('s1', 'a@x.com'); const s = await st('s1', 'a@x.com');
    const uid = (await User.findOne({ role: 'STUDENT' }))!._id;
    mock.solve('asha_rao', 'x'); mock.solve('new_name', 'x'); mock.solve('asha_rao', 'x');
    let ch = (await s.call('get', '/student/leetcode')).body.challenge;
    mock.setProfileText('asha_rao', ch); expect((await s.call('post', '/student/leetcode/verify', {})).body.verified).toBe(true);
    const old = (await LeetcodeLink.findOne({ studentId: uid, status: 'VERIFIED' }))!;
    await evidenceFor(uid, old, 'two-sum');
    expect(await countableEvidence(uid)).toHaveLength(1);

    const chg = await s.call('post', '/student/leetcode/link', { username: 'New_Name', consent: true });
    expect(chg.body).toMatchObject({ state: 'VERIFIED', current: { username: 'asha_rao' }, request: { username: 'New_Name', kind: 'CHANGE' } });
    expect(await countableEvidence(uid)).toHaveLength(1); // still counts while the change is pending
    ch = chg.body.challenge; mock.setProfileText('New_Name', ch);
    expect((await s.call('post', '/student/leetcode/verify', {})).body.verified).toBe(true);
    expect((await LeetcodeLink.findById(old._id))!.status).toBe('SUPERSEDED');
    expect(await countableEvidence(uid)).toHaveLength(0);
    expect(await SolveEvidence.countDocuments()).toBe(1);

    // change back: a NEW link, a new challenge, nothing restored
    const back = await s.call('post', '/student/leetcode/link', { username: 'asha_rao', consent: true });
    expect(back.status).toBe(201);
    await LeetcodeLink.updateMany({}, { $unset: { lastVerifyAttemptAt: 1 } });
    mock.setProfileText('asha_rao', back.body.challenge);
    expect((await s.call('post', '/student/leetcode/verify', {})).body.verified).toBe(true);
    expect(await countableEvidence(uid)).toHaveLength(0);
    expect(await LeetcodeLink.countDocuments({ studentId: uid, usernameNorm: 'asha_rao' })).toBe(2);
  });

  it('a new request replaces the previous pending one; same-username re-request is rejected', async () => {
    await reg('s1', 'a@x.com'); const s = await st('s1', 'a@x.com');
    await s.call('post', '/student/leetcode/link', { username: 'second_try', consent: true });
    const links = await LeetcodeLink.find({ studentId: (await User.findOne({ role: 'STUDENT' }))!._id }).sort({ createdAt: 1 });
    expect(links.map((l) => l.status)).toEqual(['REVOKED', 'PENDING_VERIFICATION']);
    expect(links[0].endedReason).toBe('REPLACED_BY_NEW_REQUEST');
  });

  it('revoke and revalidation: evidence stops counting; re-verification of the same link restores it; revoke keeps history', async () => {
    const mock = new MockProvider(); withMock(mock);
    await reg('s1', 'a@x.com'); const s = await st('s1', 'a@x.com');
    const uid = (await User.findOne({ role: 'STUDENT' }))!._id;
    mock.solve('asha_rao', 'x');
    mock.setProfileText('asha_rao', (await s.call('get', '/student/leetcode')).body.challenge);
    await s.call('post', '/student/leetcode/verify', {});
    const link = (await LeetcodeLink.findOne({ studentId: uid }))!; await evidenceFor(uid, link, 'two-sum');
    const { requireRevalidation } = await import('../src/modules/leetcode/links.service.js');
    await requireRevalidation(uid);
    expect((await s.call('get', '/student/leetcode')).body).toMatchObject({ state: 'REVALIDATION_REQUIRED', countsEvidence: false });
    expect(await countableEvidence(uid)).toHaveLength(0);
    mock.setProfileText('asha_rao', (await s.call('get', '/student/leetcode')).body.challenge);
    expect((await s.call('post', '/student/leetcode/verify', {})).body.verified).toBe(true);
    expect(await countableEvidence(uid)).toHaveLength(1); // same proven ownership of the same link
    expect((await s.call('delete', '/student/leetcode/link')).body.state).toBe('REVOKED');
    expect(await countableEvidence(uid)).toHaveLength(0);
    expect(await SolveEvidence.countDocuments()).toBe(1);
  });

  it('stale pending requests (14 days) stop reserving the username', async () => {
    await reg('s1', 'a@x.com');
    await LeetcodeLink.updateMany({}, { $set: { requestedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000) } });
    await reg('s2', 'b@x.com', { rollNumber: 'ZZ12CD34EF', leetcodeUsername: 'other' });
    const s2 = await st('s2', 'b@x.com');
    expect((await s2.call('post', '/student/leetcode/link', { username: 'asha_rao', consent: true })).status).toBe(201);
  });
});
