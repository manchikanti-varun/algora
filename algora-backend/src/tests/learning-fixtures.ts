// Automated test fixture only; production uses the MongoDB repository.
import { UniqueConflict, type Page } from '../administration/contracts.js';
import { TestStudents } from './student-fixtures.js';
import { newId } from './administration-fixtures.js';
import {
  currentStatuses,
  type LearningUnit,
  type LearningRepository,
  type CourseRecord,
  type BatchRecord,
  type EnrollmentRecord,
  type ImportRecord,
  type HistoryRecord,
  type List,
} from '../learning/contracts.js';
const copy = <T>(v: T): T => structuredClone(v);
export class TestLearning implements LearningRepository {
  courses = new Map<string, CourseRecord>();
  batches = new Map<string, BatchRecord>();
  enrollments = new Map<string, EnrollmentRecord>();
  imports = new Map<string, ImportRecord>();
  events: HistoryRecord[] = [];
  constructor(public students = new TestStudents()) {}
  ensureReady() {
    return this.students.ensureReady();
  }
  async transaction<T>(work: (tx: LearningUnit) => Promise<T>) {
    return this.students.transaction(async () => {
      const snap = copy({
        courses: this.courses,
        batches: this.batches,
        enrollments: this.enrollments,
        imports: this.imports,
        events: this.events,
      });
      try {
        return await work(this.read);
      } catch (e) {
        Object.assign(this, snap);
        throw e;
      }
    });
  }
  private page<T>(items: T[], o: List): Page<T> {
    return {
      items: copy(items.slice((o.page - 1) * o.pageSize, o.page * o.pageSize)),
      total: items.length,
      page: o.page,
      pageSize: o.pageSize,
      totalPages: Math.ceil(items.length / o.pageSize),
    };
  }
  private stamp<T>(data: T) {
    return {
      ...copy(data),
      id: newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  get read(): LearningUnit {
    return {
      students: this.students.read,
      course: async (id) => copy(this.courses.get(id) ?? null),
      courses: async (o, colleges, managed) =>
        this.page(
          [...this.courses.values()].filter(
            (c) =>
              (!colleges ||
                (c.status === 'PUBLISHED' &&
                  (c.scope === 'PLATFORM' ||
                    colleges.includes(c.ownerCollegeId ?? '') ||
                    c.sharedCollegeIds.some((id) => colleges.includes(id)))) ||
                managed.includes(c.ownerCollegeId ?? '')) &&
              (!o.status || c.status === o.status) &&
              (!o.scope || c.scope === o.scope) &&
              (!o.collegeId || c.ownerCollegeId === o.collegeId) &&
              (!o.difficulty || c.difficulty === o.difficulty) &&
              (!o.search ||
                c.title.toLowerCase().includes(o.search.toLowerCase())),
          ),
          o,
        ),
      insertCourse: async (data) => {
        if (
          [...this.courses.values()].some(
            (c) => c.code === data.code || c.slug === data.slug,
          )
        )
          throw new UniqueConflict('code');
        const c = this.stamp(data);
        this.courses.set(c.id, c);
        return copy(c);
      },
      updateCourse: async (id, revision, patch) => {
        const c = this.courses.get(id);
        if (!c || c.revision !== revision) return null;
        const n = { ...c, ...copy(patch), revision: revision + 1 };
        if (
          [...this.courses.values()].some(
            (x) => x.id !== id && (x.code === n.code || x.slug === n.slug),
          )
        )
          throw new UniqueConflict('code');
        this.courses.set(id, n);
        return copy(n);
      },
      batch: async (id) => copy(this.batches.get(id) ?? null),
      batches: async (o, colleges) =>
        this.page(
          [...this.batches.values()].filter(
            (b) =>
              (!colleges || colleges.includes(b.collegeId)) &&
              (!o.collegeId || o.collegeId === b.collegeId) &&
              (!o.courseId || o.courseId === b.courseId) &&
              (!o.status || o.status === b.status) &&
              (!o.search ||
                b.name.toLowerCase().includes(o.search.toLowerCase())),
          ),
          o,
        ),
      insertBatch: async (data) => {
        if (
          [...this.batches.values()].some(
            (b) => b.collegeId === data.collegeId && b.code === data.code,
          )
        )
          throw new UniqueConflict('code');
        const b = this.stamp(data);
        this.batches.set(b.id, b);
        return copy(b);
      },
      updateBatch: async (id, revision, patch) => {
        const b = this.batches.get(id);
        if (!b || b.revision !== revision) return null;
        const n = { ...b, ...copy(patch), revision: revision + 1 };
        this.batches.set(id, n);
        return copy(n);
      },
      lockBatch: async (id) => this.batches.has(id),
      lockCourse: async (id) => this.courses.has(id),
      seat: async (id, delta) => {
        const b = this.batches.get(id);
        if (
          !b ||
          (delta === 1 &&
            (!['DRAFT', 'ACTIVE'].includes(b.status) ||
              (b.capacity !== null && b.seatCount >= b.capacity))) ||
          (delta === -1 && b.seatCount === 0)
        )
          return false;
        b.seatCount += delta;
        return true;
      },
      profileByRoll: async (roll) =>
        copy(
          [...this.students.profiles.values()].find(
            (p) => p.rollNumber === roll,
          ) ?? null,
        ),
      enrollment: async (id) => copy(this.enrollments.get(id) ?? null),
      current: async (batch, roll, profile) =>
        copy(
          [...this.enrollments.values()].find(
            (e) =>
              e.batchId === batch &&
              currentStatuses.includes(e.status as never) &&
              (e.rollNumber === roll ||
                (profile && e.studentProfileId === profile)),
          ) ?? null,
        ),
      prior: async (batch, roll) =>
        copy(
          [...this.enrollments.values()].find(
            (e) => e.batchId === batch && e.rollNumber === roll,
          ) ?? null,
        ),
      enrollments: async (batch, o, history) =>
        this.page(
          [...this.enrollments.values()].filter(
            (e) =>
              e.batchId === batch &&
              (history || currentStatuses.includes(e.status as never)) &&
              (!o.status || o.status === e.status) &&
              (!o.search || e.rollNumber.includes(o.search.toUpperCase())),
          ),
          o,
        ),
      ownEnrollments: async (profile, o) =>
        this.page(
          [...this.enrollments.values()].filter(
            (e) =>
              e.studentProfileId === profile &&
              currentStatuses.includes(e.status as never),
          ),
          o,
        ),
      insertEnrollment: async (data) => {
        if (
          [...this.enrollments.values()].some(
            (e) =>
              e.batchId === data.batchId &&
              currentStatuses.includes(e.status as never) &&
              (e.rollNumber === data.rollNumber ||
                (data.studentProfileId &&
                  e.studentProfileId === data.studentProfileId)),
          )
        )
          throw new UniqueConflict('rollNumber');
        const e = this.stamp(data);
        this.enrollments.set(e.id, e);
        return copy(e);
      },
      updateEnrollment: async (id, revision, patch) => {
        const e = this.enrollments.get(id);
        if (!e || e.revision !== revision) return null;
        const n = { ...e, ...copy(patch), revision: revision + 1 };
        this.enrollments.set(id, n);
        return copy(n);
      },
      history: async (data) => {
        this.events.push(this.stamp(data));
      },
      histories: async (batch, o) =>
        this.page(
          this.events.filter((e) => e.batchId === batch),
          o,
        ),
      importByHash: async (token) =>
        copy(
          [...this.imports.values()].find((i) => i.tokenHash === token) ?? null,
        ),
      importByKey: async (actor, batch, key) =>
        copy(
          [...this.imports.values()].find(
            (i) =>
              i.actorUserId === actor &&
              i.batchId === batch &&
              i.requestKey === key,
          ) ?? null,
        ),
      insertImport: async (data) => {
        if (
          [...this.imports.values()].some(
            (i) =>
              i.actorUserId === data.actorUserId &&
              i.batchId === data.batchId &&
              i.requestKey === data.requestKey,
          )
        )
          throw new UniqueConflict('requestKey');
        const i = this.stamp(data);
        this.imports.set(i.id, i);
        return copy(i);
      },
      completeImport: async (id, results) => {
        const i = this.imports.get(id)!;
        i.status = 'COMPLETED';
        i.results = copy(results);
      },
      reconciliationRows: async (kind, target, cursor) => {
        const p =
          kind === 'USER'
            ? await this.students.read.own(target)
            : this.students.profiles.get(target);
        return copy(
          [...this.enrollments.values()]
            .filter(
              (e) =>
                currentStatuses.includes(e.status as never) &&
                (!cursor || e.id > cursor) &&
                (kind === 'BATCH'
                  ? e.batchId === target
                  : kind === 'COLLEGE'
                    ? e.collegeId === target
                    : kind === 'COURSE'
                      ? this.batches.get(e.batchId)?.courseId === target
                      : !!p &&
                        (e.studentProfileId === p.id ||
                          e.rollNumber === p.rollNumber)),
            )
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, 50),
        );
      },
    };
  }
}
export const courseInput = {
  title: 'DSA Fundamentals',
  code: 'DSA-101',
  slug: 'dsa-fundamentals',
  description: 'A structured introduction to data structures and algorithms.',
  shortDescription: 'Build solid foundations.',
  difficulty: 'BEGINNER' as const,
  estimatedDurationDays: 6,
  tags: ['DSA'],
  scope: 'PLATFORM' as const,
  ownerCollegeId: null,
  sharedCollegeIds: [],
};
export const batchInput = (
  collegeId: string,
  courseId: string,
  code = 'NOV-2026',
) => ({
  collegeId,
  courseId,
  name: 'DSA November Cohort',
  code,
  description: 'College-specific delivery',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  capacity: 200,
});
