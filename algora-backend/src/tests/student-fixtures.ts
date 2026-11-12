// Test-only transactional storage. Production uses MongoDB exclusively.
import { AppError } from '../middleware/errors.js';
import { UniqueConflict, type Page } from '../administration/contracts.js';
import type {
  StudentRepository,
  StudentUnit,
  StudentProfileRecord,
  Credential,
  CorrectionRecord,
  StudentList,
} from '../students/contracts.js';
import {
  TestAdministrationRepository,
  newId,
} from './administration-fixtures.js';
const clone = <T>(v: T): T => structuredClone(v);
export class TestStudents implements StudentRepository {
  profiles = new Map<string, StudentProfileRecord>();
  rolls = new Map<string, string>();
  credentials = new Map<string, Credential>();
  corrections = new Map<string, CorrectionRecord>();
  constructor(public admin = new TestAdministrationRepository()) {}
  ensureReady() {
    return this.admin.ensureReady();
  }
  async transaction<T>(work: (tx: StudentUnit) => Promise<T>): Promise<T> {
    return this.admin.transaction(async () => {
      const snap = clone({
        profiles: this.profiles,
        rolls: this.rolls,
        credentials: this.credentials,
        corrections: this.corrections,
      });
      try {
        return await work(this.read);
      } catch (e) {
        Object.assign(this, snap);
        throw e;
      }
    });
  }
  private page<T>(items: T[], o: StudentList): Page<T> {
    return {
      items: clone(items.slice((o.page - 1) * o.pageSize, o.page * o.pageSize)),
      total: items.length,
      page: o.page,
      pageSize: o.pageSize,
      totalPages: Math.ceil(items.length / o.pageSize),
    };
  }
  get read(): StudentUnit {
    return {
      admin: this.admin.read,
      profile: async (id) => clone(this.profiles.get(id) ?? null),
      own: async (id) =>
        clone([...this.profiles.values()].find((p) => p.userId === id) ?? null),
      profiles: async (o, scope) =>
        this.page(
          [...this.profiles.values()].filter(
            (p) =>
              (!scope || scope.includes(p.collegeId)) &&
              (!o.collegeId || o.collegeId === p.collegeId) &&
              (!o.status || o.status === p.verificationStatus) &&
              (!o.search ||
                (p.fullName + ' ' + p.rollNumber)
                  .toLowerCase()
                  .includes(o.search.toLowerCase())),
          ),
          o,
        ),
      insert: async (data) => {
        if ([...this.profiles.values()].some((p) => p.userId === data.userId))
          throw new UniqueConflict('userId');
        if (
          [...this.profiles.values()].some(
            (p) => p.rollNumber === data.rollNumber,
          )
        )
          throw new UniqueConflict('rollNumber');
        const p = {
          ...clone(data),
          id: newId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.profiles.set(p.id, p);
        return clone(p);
      },
      update: async (id, revision, patch) => {
        const p = this.profiles.get(id);
        if (!p || p.revision !== revision) return null;
        const n = {
          ...p,
          ...clone(patch),
          revision: revision + 1,
          updatedAt: new Date().toISOString(),
        };
        if (n.studentUsername !== p.studentUsername)
          throw new AppError(409, 'IMMUTABLE', 'Username immutable');
        if (
          [...this.profiles.values()].some(
            (x) => x.id !== id && x.rollNumber === n.rollNumber,
          )
        )
          throw new UniqueConflict('rollNumber');
        this.profiles.set(id, n);
        return clone(n);
      },
      registration: async (id, status) => {
        const u = this.admin.auth.users.get(id)!;
        u.registrationStatus = status;
        if (u.role === 'STUDENT' && u.accountStatus === 'PENDING')
          u.accountStatus = 'ACTIVE';
      },
      lockCollege: async (id) =>
        this.admin.colleges.get(id)?.status === 'ACTIVE',
      reserveRoll: async (roll, id) => {
        const old = this.rolls.get(roll);
        if (old && old !== id) throw new UniqueConflict('rollNumber');
        this.rolls.set(roll, id);
      },
      rollOwner: async (roll) => this.rolls.get(roll) ?? null,
      credential: async (id) => clone(this.credentials.get(id) ?? null),
      putCredential: async (c) => {
        this.credentials.set(c.profileId, clone(c));
      },
      correction: async (id) => clone(this.corrections.get(id) ?? null),
      corrections: async (o, scope, ownId) =>
        this.page(
          [...this.corrections.values()].filter(
            (c) =>
              (!scope || scope.includes(c.sourceCollegeId)) &&
              (!ownId || c.requesterUserId === ownId) &&
              (!o.collegeId || o.collegeId === c.sourceCollegeId),
          ),
          o,
        ),
      pendingCorrection: async (id) =>
        clone(
          [...this.corrections.values()].find(
            (c) => c.studentProfileId === id && c.status === 'PENDING',
          ) ?? null,
        ),
      insertCorrection: async (data) => {
        if (
          [...this.corrections.values()].some(
            (c) =>
              c.studentProfileId === data.studentProfileId &&
              c.status === 'PENDING',
          )
        )
          throw new UniqueConflict('studentProfileId');
        const c = {
          ...clone(data),
          id: newId(),
          createdAt: new Date().toISOString(),
        };
        this.corrections.set(c.id, c);
        return clone(c);
      },
      reviewCorrection: async (id, status, actor, note) => {
        const c = this.corrections.get(id);
        if (!c || c.status !== 'PENDING') return null;
        Object.assign(c, {
          status,
          reviewedBy: actor,
          reviewedAt: new Date().toISOString(),
          reviewNote: note,
        });
        return clone(c);
      },
    };
  }
}
export const registrationInput = (collegeId: string) => ({
  fullName: 'Alice Morgan',
  rollNumber: '23a91a05b2',
  phoneNumber: '+1 202 555 0123',
  collegeId,
  department: 'CSE',
  yearOfStudy: 2,
  leetCodeUsername: 'Alice_1',
  codeforcesUsername: 'Alice.1',
  codechefUsername: 'alice_1',
  confirmed: true,
});
