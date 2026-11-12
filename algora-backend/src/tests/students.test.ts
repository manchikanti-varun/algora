import { beforeEach, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { StudentService } from '../students/service.js';
import { QrVault } from '../students/crypto.js';
import {
  registerSchema,
  rollSchema,
  studentUsername,
  studentListSchema,
  phoneSchema,
} from '../students/contracts.js';
import { AdministrationService } from '../administration/service.js';
import {
  testUser,
  collegeInput,
  accessInput,
  approvalInput,
  newId,
} from './administration-fixtures.js';
import { TestStudents, registrationInput } from './student-fixtures.js';
let repo: TestStudents,
  s: StudentService,
  admin: AdministrationService,
  student: ReturnType<typeof testUser>,
  owner: ReturnType<typeof testUser>,
  college: string;
const o = studentListSchema.parse({});
const vault = () =>
  new QrVault(
    'test',
    JSON.stringify({ test: randomBytes(32).toString('base64') }),
  );
beforeEach(async () => {
  repo = new TestStudents();
  s = new StudentService(repo, vault());
  admin = new AdministrationService(repo.admin);
  student = testUser();
  owner = testUser({
    role: 'SUPER_ADMIN',
    username: 'sa-owner',
    accountStatus: 'ACTIVE',
  });
  repo.admin.auth.users.set(student.id, student);
  repo.admin.auth.users.set(owner.id, owner);
  college = (await admin.createCollege(owner.id, collegeInput, 'test')).id;
});
async function registered() {
  return s.register(student.id, registrationInput(college), 'test');
}
async function reviewer(permission = true, target = college) {
  const u = testUser({
    role: 'ADMIN',
    username: 'ad-reviewer',
    accountStatus: 'ACTIVE',
  });
  repo.admin.auth.users.set(u.id, u);
  await repo.admin.read.putAssignment(
    u.id,
    {
      collegeId: target,
      permissions: permission
        ? ['college.view', 'student.view', 'student.verify']
        : ['college.view', 'student.view'],
    },
    owner.id,
  );
  return u;
}
describe('student validation', () => {
  it.each([
    '23A91A05B2',
    '24CS001A12',
    '22B81A1234',
    '23a91a05b2',
    ' 23a91a05b2 ',
  ])('normalizes valid roll %s', (v) =>
    expect(rollSchema.parse(v)).toBe(v.trim().toUpperCase()),
  );
  it.each([
    '23A91A05B',
    '23A91A05B22',
    '23A91A-5B2',
    '23A91A 5B2',
    'ABC@123456',
    '２3A91A05B2',
    'ſ3A91A05B2',
  ])('rejects invalid roll %s', (v) =>
    expect(rollSchema.safeParse(v).success).toBe(false),
  );
  it.each([
    'fullName',
    'rollNumber',
    'phoneNumber',
    'collegeId',
    'department',
    'yearOfStudy',
    'leetCodeUsername',
    'codeforcesUsername',
    'codechefUsername',
  ])('requires %s', (field) => {
    const value: Record<string, unknown> = registrationInput(college);
    delete value[field];
    expect(registerSchema.safeParse(value).success).toBe(false);
  });
  it('rejects trusted identity/privilege mass assignment', () => {
    for (const field of [
      'email',
      'userId',
      'role',
      'verificationStatus',
      'studentUsername',
    ])
      expect(
        registerSchema.safeParse({
          ...registrationInput(college),
          [field]: 'spoof',
        }).success,
      ).toBe(false);
  });
  it('normalizes international E.164 and rejects missing country/invalid/extension', () => {
    expect(phoneSchema.parse('+44 20 7946 0018')).toBe('+442079460018');
    for (const v of ['2025550123', '+123', '+1 202 555 0123 ext 12'])
      expect(phoneSchema.safeParse(v).success).toBe(false);
  });
  it('generates safe bounded usernames including non-Latin fallback', () => {
    expect(studentUsername('23A91A05B2', 'Varun Manchikanti')).toBe(
      '23a91a05b2-varun-manchikanti',
    );
    expect(studentUsername('23A91A05B2', '李明')).toBe('23a91a05b2-student');
    expect(
      studentUsername('23A91A05B2', 'Élodie ' + 'A'.repeat(120)).length,
    ).toBeLessThanOrEqual(80);
  });
});
describe('registration and separate identity', () => {
  it('creates one profile without changing Google display name or assigning a User username', async () => {
    const p = await s.register(
      student.id,
      { ...registrationInput(college), fullName: 'Registered Learner' },
      'test',
    );
    expect(p.verificationStatus).toBe('PENDING_VERIFICATION');
    expect(repo.admin.auth.users.get(student.id)).toMatchObject({
      displayName: 'Alice Morgan',
      role: 'STUDENT',
      registrationStatus: 'PENDING_VERIFICATION',
      accountStatus: 'ACTIVE',
    });
    expect(repo.admin.auth.users.get(student.id)?.username).toBeUndefined();
    expect(p.studentUsername).toBe('23a91a05b2-registered-learner');
  });
  it('rejects repeat registration for same canonical user', async () => {
    await registered();
    await expect(registered()).rejects.toMatchObject({
      code: 'ALREADY_REGISTERED',
    });
    expect(repo.profiles.size).toBe(1);
  });
  it('enforces globally unique roll across colleges and concurrent submissions', async () => {
    const other = testUser();
    repo.admin.auth.users.set(other.id, other);
    const college2 = (
      await admin.createCollege(
        owner.id,
        {
          ...collegeInput,
          code: 'SECOND',
          slug: 'second-institute',
          name: 'Second Institute',
        },
        'test',
      )
    ).id;
    const results = await Promise.allSettled([
      registered(),
      s.register(other.id, registrationInput(college2), 'test'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.profiles.size).toBe(1);
  });
  it('rejects inactive college and privileged registration', async () => {
    repo.admin.colleges.get(college)!.status = 'INACTIVE';
    await expect(registered()).rejects.toMatchObject({
      code: 'COLLEGE_UNAVAILABLE',
    });
    await expect(
      s.register(owner.id, registrationInput(college), 'test'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rolls back registration, credentials and reservations when audit fails', async () => {
    repo.admin.failAudit = true;
    await expect(registered()).rejects.toBeDefined();
    expect(repo.profiles.size).toBe(0);
    expect(repo.rolls.size).toBe(0);
    expect(repo.credentials.size).toBe(0);
    expect(repo.admin.auth.users.get(student.id)?.registrationStatus).toBe(
      'NOT_STARTED',
    );
  });
  it('preserves student identity on explicit Phase 3 Admin approval', async () => {
    const p = await registered();
    const req = await admin.submit(student.id, accessInput(college), 'test');
    await admin.approve(owner.id, req.id, approvalInput(college), 'test');
    expect(repo.admin.auth.users.get(student.id)).toMatchObject({
      role: 'ADMIN',
      username: 'ad-alicemorgan',
    });
    expect((await repo.read.own(student.id))?.studentUsername).toBe(
      p.studentUsername,
    );
    expect(repo.admin.auth.users.size).toBe(2);
    await expect(s.me(student.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('allows unregistered Admin requests and safe unavailable storage', async () => {
    expect(
      (await admin.submit(student.id, accessInput(college), 'test')).status,
    ).toBe('PENDING');
    repo.admin.available = false;
    await expect(registered()).rejects.toMatchObject({ status: 503 });
  });
});
describe('verification scope and correction reviews', () => {
  it('requires dedicated permission and active assigned college', async () => {
    const p = await registered(),
      u = await reviewer(false);
    await expect(
      s.verify(
        u.id,
        p.id,
        {
          expectedRevision: p.revision,
          method: 'AUTHORIZED_MANUAL',
          evidenceReference: 'Checked by authorized registrar reference',
          confirmed: true,
        },
        false,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'COLLEGE_FORBIDDEN' });
    expect((await repo.read.profile(p.id))?.verificationStatus).toBe(
      'PENDING_VERIFICATION',
    );
  });
  it('rejects cross-college directory/detail/verification and suspended Admin', async () => {
    const p = await registered(),
      u = await reviewer(true, newId());
    expect((await s.directory(u.id, o)).items).toHaveLength(0);
    await expect(s.detail(u.id, p.id)).rejects.toMatchObject({
      code: 'COLLEGE_FORBIDDEN',
    });
    repo.admin.auth.users.get(u.id)!.accountStatus = 'SUSPENDED';
    await expect(s.directory(u.id, o)).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    });
  });
  it('requires evidence, manual confirmation; never claims an imported roster', async () => {
    const p = await registered();
    await expect(
      s.verify(
        owner.id,
        p.id,
        {
          expectedRevision: p.revision,
          method: 'COLLEGE_ROSTER',
          evidenceReference: '',
          confirmed: true,
        },
        false,
        'test',
      ),
    ).rejects.toBeDefined();
    const result = await s.verify(
      owner.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference: 'Authorized registrar evidence reference',
        confirmed: true,
      },
      false,
      'test',
    );
    expect(result.verificationStatus).toBe('VERIFIED');
    expect(result).not.toHaveProperty('verificationEvidence');
    expect(repo.admin.auth.users.get(student.id)?.registrationStatus).toBe(
      'VERIFIED',
    );
  });
  it('uses revision guards for competing verification', async () => {
    const p = await registered();
    const input = {
      expectedRevision: p.revision,
      method: 'AUTHORIZED_MANUAL',
      evidenceReference: 'Authorized registrar evidence reference',
      confirmed: true,
    };
    const results = await Promise.allSettled([
      s.verify(owner.id, p.id, input, false, '1'),
      s.verify(owner.id, p.id, input, false, '2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('separates direct contact changes from protected identity fields', async () => {
    const p = await registered();
    await expect(
      s.edit(
        student.id,
        { ...registrationInput(college), expectedRevision: p.revision },
        'test',
      ),
    ).rejects.toBeDefined();
    const {
      phoneNumber,
      leetCodeUsername,
      codeforcesUsername,
      codechefUsername,
    } = registrationInput(college);
    const n = await s.edit(
      student.id,
      {
        phoneNumber,
        leetCodeUsername,
        codeforcesUsername,
        codechefUsername,
        expectedRevision: p.revision,
      },
      'test',
    );
    expect(n.studentUsername).toBe(p.studentUsername);
  });
  it('rejects duplicate pending correction and non-owner cancellation', async () => {
    const p = await registered();
    const input = {
      requestedChanges: { fullName: 'Alice Newname' },
      reason: 'Registered name requires correction',
      expectedRevision: p.revision,
    };
    const c = await s.requestCorrection(student.id, input, 'test');
    await expect(
      s.requestCorrection(student.id, input, 'test'),
    ).rejects.toMatchObject({ code: 'CORRECTION_PENDING' });
    const other = testUser();
    repo.admin.auth.users.set(other.id, other);
    await expect(s.cancel(other.id, c.id, 'test')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await s.cancel(student.id, c.id, 'test');
    expect((await s.ownCorrections(student.id, o)).items[0]?.status).toBe(
      'CANCELLED',
    );
  });
  it('approves identity changes, preserves username/QR and historical roll reservation, resets verification', async () => {
    const p = await registered();
    const verified = await s.verify(
      owner.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference: 'Authorized registrar evidence reference',
        confirmed: true,
      },
      false,
      'test',
    );
    const oldQr = await s.qr(student.id);
    const c = await s.requestCorrection(
      student.id,
      {
        requestedChanges: {
          rollNumber: '24CS001A12',
          fullName: 'Alice Newname',
        },
        reason: 'College registrar confirmed revised details',
        expectedRevision: verified.revision,
      },
      'test',
    );
    await s.review(
      owner.id,
      c.id,
      {
        expectedRevision: verified.revision,
        reviewNote: 'Approved after institutional record review',
        confirmed: true,
      },
      true,
      'test',
    );
    const next = (await s.me(student.id)).profile;
    expect(next).toMatchObject({
      rollNumber: '24CS001A12',
      fullName: 'Alice Newname',
      studentUsername: p.studentUsername,
      verificationStatus: 'PENDING_VERIFICATION',
    });
    expect(next.verifiedAt).toBeUndefined();
    expect((await s.qr(student.id)).token).toBe(oldQr.token);
    expect((await s.availability(student.id, p.rollNumber)).available).toBe(
      false,
    );
    expect(repo.admin.audits.map((a) => a.action)).toContain(
      'STUDENT_IDENTITY_CORRECTED',
    );
  });
  it('roll correction rejects duplicate reservation and rolls back request state', async () => {
    const p = await registered();
    repo.rolls.set('24CS001A12', newId());
    const c = await s.requestCorrection(
      student.id,
      {
        requestedChanges: { rollNumber: '24CS001A12' },
        reason: 'College registrar reviewed the roll number',
        expectedRevision: p.revision,
      },
      'test',
    );
    await expect(
      s.review(
        owner.id,
        c.id,
        {
          expectedRevision: p.revision,
          reviewNote: 'Reviewed the institutional record carefully',
          confirmed: true,
        },
        true,
        'test',
      ),
    ).rejects.toMatchObject({ code: 'ROLL_UNAVAILABLE' });
    expect(repo.corrections.get(c.id)?.status).toBe('PENDING');
  });
  it('cross-college correction review denied and transfers require Super Admin', async () => {
    const p = await registered();
    const nextCollege = (
      await admin.createCollege(
        owner.id,
        {
          ...collegeInput,
          code: 'SECOND',
          slug: 'second-institute',
          name: 'Second Institute',
        },
        'test',
      )
    ).id;
    const c = await s.requestCorrection(
      student.id,
      {
        requestedChanges: { collegeId: nextCollege },
        reason: 'Student transferred to another institution',
        expectedRevision: p.revision,
      },
      'test',
    );
    const u = await reviewer();
    const input = {
      expectedRevision: p.revision,
      reviewNote: 'Institutional transfer records confirmed',
      confirmed: true,
    };
    await expect(
      s.review(u.id, c.id, input, true, 'test'),
    ).rejects.toMatchObject({ code: 'TRANSFER_REQUIRES_SUPER_ADMIN' });
    await s.review(owner.id, c.id, input, true, 'test');
    expect((await repo.read.profile(p.id))?.collegeId).toBe(nextCollege);
  });
  it('only one concurrent correction approval succeeds', async () => {
    const p = await registered();
    const c = await s.requestCorrection(
      student.id,
      {
        requestedChanges: { department: 'Biomedical' },
        reason: 'Correct department confirmed by college',
        expectedRevision: p.revision,
      },
      'test',
    );
    const input = {
      expectedRevision: p.revision,
      reviewNote: 'Reviewed registrar correction documentation',
      confirmed: true,
    };
    const r = await Promise.allSettled([
      s.review(owner.id, c.id, input, true, '1'),
      s.review(owner.id, c.id, input, true, '2'),
    ]);
    expect(r.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  });
});
describe('opaque permanent QR', () => {
  it('stores encrypted material and hash, never plaintext, stable across login/profile reads', async () => {
    const p = await registered(),
      a = await s.qr(student.id),
      b = await s.qr(student.id);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).toBe(b.token);
    expect(a.token).not.toContain(p.rollNumber);
    const stored = repo.credentials.get(p.id)!;
    expect(JSON.stringify(stored)).not.toContain(a.token);
    expect(stored.tokenHash).toBe(QrVault.hash(a.token));
    expect(JSON.stringify(repo.admin.audits)).not.toContain(a.token);
  });
  it('rotates atomically and concurrent old-version rotation loses', async () => {
    const p = await registered(),
      old = await s.qr(student.id);
    const input = { expectedVersion: p.qrCredentialVersion, confirmed: true };
    const results = await Promise.allSettled([
      s.rotate(student.id, input, '1'),
      s.rotate(student.id, input, '2'),
    ]);
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    const next = await s.qr(student.id);
    expect(next.token).not.toBe(old.token);
    expect(repo.credentials.get(p.id)?.tokenHash).not.toBe(
      QrVault.hash(old.token),
    );
    expect((await s.me(student.id)).profile.studentUsername).toBe(
      p.studentUsername,
    );
  });
  it('fails safely without key and permits registration with unavailable issuance', async () => {
    const unavailable = new StudentService(repo, new QrVault(undefined, '{}'));
    const p = await unavailable.register(
      student.id,
      registrationInput(college),
      'test',
    );
    expect(p.qrCredentialVersion).toBe(0);
    await expect(unavailable.qr(student.id)).rejects.toMatchObject({
      code: 'QR_NOT_ISSUED',
    });
    await expect(
      unavailable.rotate(
        student.id,
        { expectedVersion: 0, confirmed: true },
        'test',
      ),
    ).rejects.toMatchObject({ code: 'QR_UNAVAILABLE' });
    expect(repo.credentials.size).toBe(0);
  });
  it('authenticated encryption detects ciphertext/AAD tampering and supports retained key IDs', () => {
    const v = vault(),
      c = v.issue(newId(), 1);
    expect(v.reveal(c)).toHaveLength(43);
    expect(() => v.reveal({ ...c, version: 2 })).toThrow();
    expect(() =>
      v.reveal({ ...c, ciphertext: randomBytes(43).toString('base64') }),
    ).toThrow();
    expect(v.issue(c.profileId, 2).nonce).not.toBe(c.nonce);
  });
  it('does not reveal another identity QR and rolls back failed rotation audit', async () => {
    const p = await registered();
    const other = testUser();
    repo.admin.auth.users.set(other.id, other);
    await expect(s.qr(other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const old = await s.qr(student.id);
    repo.admin.failAudit = true;
    await expect(
      s.rotate(
        student.id,
        { expectedVersion: p.qrCredentialVersion, confirmed: true },
        'test',
      ),
    ).rejects.toBeDefined();
    expect((await s.qr(student.id)).token).toBe(old.token);
  });
});

it('prevents a promoted Admin from verifying or approving corrections to their own student identity', async () => {
  const p = await registered();
  const c = await s.requestCorrection(
    student.id,
    {
      requestedChanges: { department: 'Biomedical' },
      reason: 'Registrar confirmed correct academic department',
      expectedRevision: p.revision,
    },
    'test',
  );
  const req = await admin.submit(student.id, accessInput(college), 'test');
  await admin.approve(
    owner.id,
    req.id,
    {
      ...approvalInput(college),
      assignments: [
        {
          collegeId: college,
          permissions: ['college.view', 'student.view', 'student.verify'],
        },
      ],
    },
    'test',
  );
  expect((await s.detail(student.id, p.id)).canVerify).toBe(false);
  await expect(
    s.verify(
      student.id,
      p.id,
      {
        expectedRevision: p.revision,
        method: 'AUTHORIZED_MANUAL',
        evidenceReference: 'Claimed institutional verification evidence',
        confirmed: true,
      },
      false,
      'test',
    ),
  ).rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
  await expect(
    s.review(
      student.id,
      c.id,
      {
        expectedRevision: p.revision,
        reviewNote: 'Claimed institutional correction approval',
        confirmed: true,
      },
      true,
      'test',
    ),
  ).rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
});
