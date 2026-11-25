import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { env } from '../src/config/env';
import { AuditLog, Batch, Enrollment, LeetcodeLink, SolveEvidence, User } from '../src/models';
import { countableEvidence } from '../src/modules/leetcode/evidence.repository';
import { migrateLeetcodeLinks } from '../src/modules/leetcode/link-migration';
import { MockProvider } from '../src/modules/leetcode/providers/mock.provider';
import { setProviderForTests } from '../src/modules/leetcode/providers/provider.registry';
import { app, evidenceFor, login, resetDb, startDb, stopDb, studentBody, tok, verifiedLink } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);
afterEach(() => { setProviderForTests(undefined); (env as any).LEETCODE_SYNC_ENABLED = false; (env as any).LEETCODE_MOCK_ENABLED = false; });

const reg = (sub: string, email: string, over: Record<string, unknown> = {}) => request(app).post('/api/v1/auth/register/student').set('Origin', 'http://localhost:3000')
  .send({ idToken: tok(sub, email, 'Some Student'), ...studentBody(over) });
const st = (sub: string, email: string) => login(tok(sub, email, 'Some Student'));
const uidOf = async (sub: string) => (await User.findOne({ googleSub: sub }))!._id;

describe('simplified LeetCode account linking', () => {
  it('registration links the username immediately: no challenge, no pending state, no provider request', async () => {
    const mock = new MockProvider();
    setProviderForTests(mock);
    (env as any).LEETCODE_SYNC_ENABLED = true;
    const r = await reg('s1', 'a@x.com');
    expect(r.status).toBe(201);
    const s = await st('s1', 'a@x.com');
    const v = (await s.call('get', '/student/leetcode')).body;
    expect(v).toMatchObject({ state: 'LINKED', countsEvidence: true, username: 'asha_rao', current: { username: 'asha_rao' } });
    expect(v.challenge).toBeUndefined();
    expect(v.request).toBeUndefined();
    const link = (await LeetcodeLink.findOne({ studentId: await uidOf('s1') }))!;
    expect(link.status).toBe('LINKED');
    expect(link.isCurrent).toBe(true);
    expect(link.challenge).toBeUndefined();
    expect(mock.calls).toBe(0);
    expect(mock.probeCalls).toBe(0);
  });

  it('duplicate usernames are rejected case-insensitively at registration and when linking', async () => {
    await reg('s1', 'a@x.com');
    const dup = await reg('s2', 'b@x.com', { rollNumber: 'ZZ12CD34EF', leetcodeUsername: 'ASHA_RAO' });
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe('USERNAME_IN_USE');
    expect(await User.countDocuments({ role: 'STUDENT' })).toBe(1);
    await reg('s2', 'b@x.com', { rollNumber: 'ZZ12CD34EF', leetcodeUsername: 'other_user' });
    const s2 = await st('s2', 'b@x.com');
    const r = await s2.call('post', '/student/leetcode/link', { username: 'Asha_Rao', consent: true });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('USERNAME_IN_USE');
  });

  it('linking and changing the username work while synchronization is unavailable', async () => {
    setProviderForTests(null);
    (env as any).LEETCODE_SYNC_ENABLED = false;
    await reg('s1', 'a@x.com');
    const s = await st('s1', 'a@x.com');
    const changed = await s.call('post', '/student/leetcode/link', { username: 'new_name', consent: true });
    expect(changed.status).toBe(201);
    expect(changed.body).toMatchObject({ state: 'LINKED', username: 'new_name' });
    expect((await s.call('get', '/leetcode/sync-status')).body).toMatchObject({ syncEnabled: false, link: { state: 'LINKED' } });
  });

  it('re-linking the same username is rejected; consent is required; invalid usernames are rejected', async () => {
    await reg('s1', 'a@x.com');
    const s = await st('s1', 'a@x.com');
    expect((await s.call('post', '/student/leetcode/link', { username: 'asha_rao', consent: true })).body.error.code).toBe('ALREADY_LINKED');
    expect((await s.call('post', '/student/leetcode/link', { username: 'other_name' })).status).toBe(400);
    expect((await s.call('post', '/student/leetcode/link', { username: 'has space', consent: true })).status).toBe(400);
  });

  it('username change takes effect immediately: old evidence is kept but stops counting and is never transferred', async () => {
    await reg('s1', 'a@x.com');
    const s = await st('s1', 'a@x.com');
    const uid = await uidOf('s1');
    const old = (await LeetcodeLink.findOne({ studentId: uid }))!;
    await evidenceFor(uid, old, 'two-sum');
    expect(await countableEvidence(uid)).toHaveLength(1);

    const chg = await s.call('post', '/student/leetcode/link', { username: 'New_Name', consent: true });
    expect(chg.status).toBe(201);
    expect(chg.body).toMatchObject({ state: 'LINKED', username: 'New_Name' });
    expect((await LeetcodeLink.findById(old._id))!.status).toBe('SUPERSEDED');
    expect(await countableEvidence(uid)).toHaveLength(0); // new account starts from zero
    expect(await SolveEvidence.countDocuments()).toBe(1); // history is preserved

    // Changing back creates a NEW link: the old evidence is not restored.
    const back = await s.call('post', '/student/leetcode/link', { username: 'asha_rao', consent: true });
    expect(back.status).toBe(201);
    expect(await countableEvidence(uid)).toHaveLength(0);
    expect(await LeetcodeLink.countDocuments({ studentId: uid, usernameNorm: 'asha_rao' })).toBe(2);
    expect((await User.findById(uid))!.sync!.lastSuccessAt).toBeFalsy(); // sync state reset for the new account
  });

  it('unlinking revokes the link and stops counting; withdrawing consent deletes all LeetCode data', async () => {
    await reg('s1', 'a@x.com');
    const s = await st('s1', 'a@x.com');
    const uid = await uidOf('s1');
    const link = (await LeetcodeLink.findOne({ studentId: uid }))!;
    await evidenceFor(uid, link, 'two-sum');
    expect((await s.call('delete', '/student/leetcode/link')).body.state).toBe('UNLINKED');
    expect(await countableEvidence(uid)).toHaveLength(0);
    expect(await SolveEvidence.countDocuments()).toBe(1); // kept for audit until consent is withdrawn

    const r = await s.call('delete', '/student/leetcode/data', { confirm: 'DELETE' });
    expect(r.body).toMatchObject({ ok: true, evidence: 1 });
    expect(await SolveEvidence.countDocuments()).toBe(0);
    expect(r.body.link.state).toBe('UNLINKED');
  });

  it('legacy VERIFIED links are shown as LINKED before the migration runs', async () => {
    const u = await User.create({ googleSub: 'legacy', email: 'legacy@x.com', role: 'STUDENT', fullName: 'Legacy', rollNumber: 'LG00000001' });
    await LeetcodeLink.create({ studentId: u._id, username: 'legacy_user', usernameNorm: 'legacy_user', status: 'VERIFIED', isActive: true, isCurrent: true, isPending: false, consentedAt: new Date() });
    const s = await login(tok('legacy', 'legacy@x.com'));
    expect((await s.call('get', '/student/leetcode')).body).toMatchObject({ state: 'LINKED', countsEvidence: true });
  });
});

describe('trainer correction of a linked username', () => {
  async function world() {
    const admin = await login(tok('sub-admin', 'admin@example.com', 'Admin'));
    const b = (await admin.call('post', '/batches', { name: 'B', status: 'ACTIVE', college: 'JNTU' })).body;
    const other = (await admin.call('post', '/batches', { name: 'Other', status: 'ACTIVE', college: 'OU' })).body;
    await reg('s1', 'a@x.com');
    await admin.call('post', `/batches/${b._id}/enrollments`, { rollNumber: 'AB12CD34EF' });
    await User.create({ googleSub: 't1', email: 't1@x.com', role: 'TRAINER', fullName: 'Trainer One', trainerId: 'tr_t1' });
    const tid = (await User.findOne({ trainerId: 'tr_t1' }))!._id;
    await admin.call('post', `/batches/${b._id}/trainers`, { trainerId: String(tid) });
    const trainer = await login(tok('t1', 't1@x.com', 'Trainer One'));
    return { admin, trainer, b, other, uid: await uidOf('s1') };
  }

  it('corrects a username immediately, records an audit entry and keeps evidence isolated', async () => {
    const w = await world();
    const old = (await LeetcodeLink.findOne({ studentId: w.uid }))!;
    await evidenceFor(w.uid, old, 'two-sum');
    const r = await w.trainer.call('post', `/students/${w.uid}/leetcode/username`, { username: 'corrected_name', reason: 'Typo reported by student' });
    expect(r.status).toBe(200);
    expect((await LeetcodeLink.findById(old._id))!.status).toBe('SUPERSEDED');
    expect((await LeetcodeLink.findOne({ studentId: w.uid, isCurrent: true }))!.username).toBe('corrected_name');
    expect(await countableEvidence(w.uid)).toHaveLength(0);
    const a = await AuditLog.findOne({ action: 'student.leetcode.username_corrected' }).lean();
    expect(a?.metadata).toMatchObject({ from: 'asha_rao', to: 'corrected_name', reason: 'Typo reported by student' });
  });

  it('refuses without standing consent, and a trainer cannot touch a student outside their batches', async () => {
    const w = await world();
    const u = await User.create({ googleSub: 'noconsent', email: 'nc@x.com', role: 'STUDENT', fullName: 'No Consent', rollNumber: 'NC00000001' });
    await Enrollment.create({ studentId: u._id, batchId: w.b._id });
    await LeetcodeLink.create({ studentId: u._id, username: 'nc_user', usernameNorm: 'nc_user', status: 'LINKED', isActive: true, isCurrent: true, isPending: false, consentedAt: null });
    const refused = await w.trainer.call('post', `/students/${u._id}/leetcode/username`, { username: 'other', reason: 'Correction' });
    expect(refused.status).toBe(409); expect(refused.body.error.code).toBe('CONSENT_REQUIRED');
    const outsider = await User.create({ googleSub: 'outsider', email: 'out@x.com', role: 'STUDENT', fullName: 'Outsider', rollNumber: 'OU00000001' });
    await verifiedLink(outsider._id, 'outsider');
    expect((await w.trainer.call('post', `/students/${outsider._id}/leetcode/username`, { username: 'x', reason: 'Correction' })).status).toBe(404);
  });
});

describe('link migration', () => {
  async function seedStudent(n: string) {
    return User.create({ googleSub: `m-${n}`, email: `${n}@m.com`, role: 'STUDENT', fullName: `M ${n}`, rollNumber: `M${n.toUpperCase().padEnd(9, '0')}` });
  }
  const legacy = (studentId: any, over: Record<string, unknown>) => LeetcodeLink.create({
    studentId, username: `legacy_${over.usernameNormSuffix ?? 'user'}`, usernameNorm: `legacy_${over.usernameNormSuffix ?? 'user'}`, isActive: true, isCurrent: false, isPending: false,
    consentedAt: new Date(), challenge: 'algora-verify-x', ...over,
  });

  it('is a dry run by default and converts consented legacy links idempotently, preserving evidence', async () => {
    const u = await seedStudent('one');
    const link = await legacy(u._id, { status: 'VERIFIED', isCurrent: true });
    await evidenceFor(u._id, link, 'two-sum');

    const dry = await migrateLeetcodeLinks(false);
    expect(dry.counts.verified_converted).toBe(1);
    expect((await LeetcodeLink.findOne({ studentId: u._id }))!.status).toBe('VERIFIED'); // untouched
    expect(dry.counts.evidenceRowsPreserved).toBe(1);

    const applied = await migrateLeetcodeLinks(true);
    expect(applied.counts.verified_converted).toBe(1);
    const after = (await LeetcodeLink.findById(link._id))!;
    expect(after.status).toBe('LINKED');
    expect(after.isCurrent).toBe(true);
    expect(after.challenge).toBeUndefined();
    expect(after.linkedAt).toBeTruthy();
    expect(await countableEvidence(u._id)).toHaveLength(1); // evidence still counts

    const again = await migrateLeetcodeLinks(true);
    expect(again.counts.legacyLinksFound).toBe(0);
    expect(again.counts.verified_converted).toBeUndefined();
  });

  it('promotes a consented pending change, supersedes the link it replaces, and skips pending without consent', async () => {
    const u = await seedStudent('two');
    const current = await legacy(u._id, { status: 'VERIFIED', isCurrent: true, usernameNormSuffix: 'current' });
    const pending = await legacy(u._id, { status: 'PENDING_VERIFICATION', isCurrent: false, isPending: true, replacesLinkId: current._id, usernameNormSuffix: 'pending' });
    const nc = await seedStudent('three');
    const noConsent = await legacy(nc._id, { status: 'PENDING_VERIFICATION', isPending: true, consentedAt: null, usernameNormSuffix: 'noconsent' });

    const r = await migrateLeetcodeLinks(true);
    expect(r.counts.pending_promoted).toBe(1);
    expect(r.counts.superseded_replaced_link).toBe(1);
    expect(r.counts.skipped_no_consent).toBe(1);
    expect((await LeetcodeLink.findById(current._id))!.status).toBe('SUPERSEDED');
    const p = (await LeetcodeLink.findById(pending._id))!;
    expect(p.status).toBe('LINKED'); expect(p.isCurrent).toBe(true); expect(p.isPending).toBe(false);
    expect((await LeetcodeLink.findById(noConsent._id))!.status).toBe('PENDING_VERIFICATION');
  });

  it('does not promote a pending change whose predecessor has been revoked', async () => {
    const u = await seedStudent('six');
    const revoked = await legacy(u._id, { status: 'REVOKED', isActive: false, usernameNormSuffix: 'revoked' });
    const pending = await legacy(u._id, { status: 'PENDING_VERIFICATION', replacesLinkId: revoked._id, usernameNormSuffix: 'pending' });
    const report = await migrateLeetcodeLinks(true);
    expect(report.counts.skipped_inactive_predecessor).toBe(1);
    expect(report.conflicts[0]).toMatchObject({ linkId: String(pending._id), studentId: String(u._id) });
    expect(await LeetcodeLink.countDocuments({ studentId: u._id, isCurrent: true })).toBe(0);
  });

  it('never reactivates revoked links and never takes a username held by another student', async () => {
    const a = await seedStudent('four');
    const b = await seedStudent('five');
    await legacy(a._id, { status: 'REVOKED', isActive: false, usernameNormSuffix: 'revoked' });
    await legacy(a._id, { status: 'LINKED', isCurrent: true, username: 'taken', usernameNorm: 'taken' });
    // The unique index normally makes this impossible; simulate a legacy row that escaped it.
    await legacy(b._id, { status: 'PENDING_VERIFICATION', isPending: true, isActive: false, username: 'TAKEN', usernameNorm: 'taken' });
    const r = await migrateLeetcodeLinks(true);
    expect(r.counts.skipped_username_conflict).toBe(1);
    expect(await LeetcodeLink.countDocuments({ status: 'REVOKED' })).toBe(1);
  });
});
