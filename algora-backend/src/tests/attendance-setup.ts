import { randomBytes, randomUUID } from 'node:crypto';
import { TestAttendance } from './attendance-fixtures.js';
import { AttendanceService } from '../attendance/service.js';
import { LearningService } from '../learning/service.js';
import { CurriculumService } from '../curriculum/service.js';
import { StudentService } from '../students/service.js';
import { QrVault } from '../students/crypto.js';
import { AdministrationService } from '../administration/service.js';
import { testUser, collegeInput } from './administration-fixtures.js';
import { courseInput, batchInput } from './learning-fixtures.js';
import { registrationInput } from './student-fixtures.js';
export async function setupAttendance() {
  const repo = new TestAttendance(),
    learning = new LearningService(repo.curriculum.learning),
    curriculum = new CurriculumService(repo.curriculum, learning),
    service = new AttendanceService(repo, learning),
    owner = testUser({
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      username: 'sa-owner',
    }),
    admin = testUser({
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      username: 'ad-scanner',
    });
  const users = repo.curriculum.learning.students.admin.auth.users;
  users.set(owner.id, owner);
  users.set(admin.id, admin);
  const college = (
    await new AdministrationService(
      repo.curriculum.learning.students.admin,
    ).createCollege(owner.id, collegeInput, 'test')
  ).id;
  await repo.curriculum.learning.students.admin.read.putAssignment(
    admin.id,
    { collegeId: college, permissions: ['college.view', 'attendance.manage'] },
    owner.id,
  );
  const c = await learning.saveCourse(owner.id, courseInput, undefined, 'test');
  await learning.courseStatus(
    owner.id,
    c.id,
    'PUBLISHED',
    { expectedRevision: 0, confirmed: true },
    'test',
  );
  const b = await learning.saveBatch(
    owner.id,
    batchInput(college, c.id),
    undefined,
    'test',
  );
  await learning.batchStatus(
    owner.id,
    b.id,
    'ACTIVE',
    { expectedRevision: 0, confirmed: true },
    'test',
  );
  const r = await curriculum.newDraft(owner.id, c.id, {}, 'test'),
    day = await curriculum.saveDay(
      owner.id,
      c.id,
      r.id,
      undefined,
      {
        dayNumber: 100,
        title: 'Arrays and maps',
        publicationStatus: 'PUBLISHED',
        expectedRevision: 0,
      },
      'test',
    );
  await curriculum.publish(
    owner.id,
    c.id,
    r.id,
    { expectedRevision: 1, confirmed: true },
    'test',
  );
  const impact = await curriculum.assignmentPreview(owner.id, b.id, r.id);
  await curriculum.assign(
    owner.id,
    b.id,
    {
      curriculumRevisionId: r.id,
      expectedBatchRevision: impact.batchRevision,
      expectedPreviousRevisionId: null,
      impactFingerprint: impact.impactFingerprint,
      reason: 'Reviewed initial curriculum delivery',
      confirmed: true,
    },
    'test',
  );
  const vault = new QrVault(
      'test',
      JSON.stringify({ test: randomBytes(32).toString('base64') }),
    ),
    students = new StudentService(repo.curriculum.learning.students, vault);
  let counter = 0;
  async function addStudent(
    verified = true,
    enrolled = true,
    targetCollege = college,
  ) {
    const user = testUser();
    users.set(user.id, user);
    const roll = 'R' + String(++counter).padStart(9, '0');
    let profile = await students.register(
      user.id,
      {
        ...registrationInput(targetCollege),
        rollNumber: roll,
        fullName: 'Example Learner',
      },
      'test',
    );
    if (verified)
      profile = await students.verify(
        owner.id,
        profile.id,
        {
          expectedRevision: profile.revision,
          method: 'AUTHORIZED_MANUAL',
          evidenceReference: 'Institutional registrar reviewed evidence',
          confirmed: true,
        },
        false,
        'test',
      );
    if (enrolled)
      await learning.manual(
        owner.id,
        b.id,
        { rollNumber: roll, requestKey: randomUUID(), confirmed: true },
        'test',
      );
    const credential = await repo.curriculum.read.learning.students.credential(
      profile.id,
    );
    return { user, profile, token: credential ? vault.reveal(credential) : '' };
  }
  async function session(
    type: 'MORNING' | 'AFTERNOON' = 'MORNING',
    open = true,
  ) {
    const s = await service.create(
      admin.id,
      b.id,
      { learningDayId: day.day.id, sessionType: type },
      'test',
    );
    return open
      ? (await service.transition(
          admin.id,
          b.id,
          s.id,
          'open',
          {
            expectedRevision: s.revision,
            confirmed: true,
            reason: 'Open the authorized in-person session',
          },
          'test',
        ))!
      : s;
  }
  return {
    repo,
    learning,
    curriculum,
    service,
    students,
    vault,
    owner,
    admin,
    college,
    course: c.id,
    batch: b.id,
    revision: r.id,
    day: day.day.id,
    addStudent,
    session,
  };
}
