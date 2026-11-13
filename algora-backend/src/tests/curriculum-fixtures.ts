// Test-only repository. Production uses transactional MongoDB exclusively.
import { AppError } from '../middleware/errors.js';
import { UniqueConflict, type Page } from '../administration/contracts.js';
import { newId } from './administration-fixtures.js';
import { TestLearning } from './learning-fixtures.js';
import type {
  CurriculumRepository,
  CurriculumUnit,
  RevisionRecord,
  DayRecord,
  FrozenDay,
  ProblemRecord,
  EditorialRecord,
  ReleaseRecord,
  AssignmentHistory,
  Query,
} from '../curriculum/contracts.js';
const copy = <T>(v: T): T => structuredClone(v);
export class TestCurriculum implements CurriculumRepository {
  revisions = new Map<string, RevisionRecord>();
  days = new Map<string, DayRecord>();
  frozen = new Map<string, FrozenDay>();
  problems = new Map<string, ProblemRecord>();
  editorials = new Map<string, EditorialRecord>();
  releases = new Map<string, ReleaseRecord>();
  history: AssignmentHistory[] = [];
  constructor(public learning = new TestLearning()) {}
  ensureReady() {
    return this.learning.ensureReady();
  }
  async transaction<T>(work: (tx: CurriculumUnit) => Promise<T>) {
    return this.learning.transaction(async () => {
      const snap = copy({
        revisions: this.revisions,
        days: this.days,
        frozen: this.frozen,
        problems: this.problems,
        editorials: this.editorials,
        releases: this.releases,
        history: this.history,
      });
      try {
        return await work(this.read);
      } catch (e) {
        Object.assign(this, snap);
        throw e;
      }
    });
  }
  private page<T>(items: T[], q: Query): Page<T> {
    return {
      items: copy(items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)),
      total: items.length,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.ceil(items.length / q.pageSize),
    };
  }
  private stamp<T>(d: T) {
    return {
      ...copy(d),
      id: newId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  private draft(id: string) {
    if (this.revisions.get(id)?.status !== 'DRAFT')
      throw new AppError(409, 'IMMUTABLE_CONTENT', 'Draft required');
  }
  private uniqueDay(revision: string, number: number, except?: string) {
    if (
      [...this.days.values()].some(
        (d) =>
          d.curriculumRevisionId === revision &&
          d.dayNumber === number &&
          d.id !== except,
      )
    )
      throw new UniqueConflict('dayNumber');
  }
  get read(): CurriculumUnit {
    return {
      learning: this.learning.read,
      revisions: async (c, q, p) =>
        this.page(
          [...this.revisions.values()]
            .filter(
              (r) =>
                r.courseId === c &&
                (!p || r.status === 'PUBLISHED') &&
                (!q.status || r.status === q.status),
            )
            .sort((a, b) => b.revisionNumber - a.revisionNumber),
          q,
        ),
      revision: async (id) => copy(this.revisions.get(id) ?? null),
      nextRevision: async (c) =>
        Math.max(
          0,
          ...[...this.revisions.values()]
            .filter((r) => r.courseId === c)
            .map((r) => r.revisionNumber),
        ) + 1,
      insertRevision: async (d) => {
        const r = this.stamp(d);
        this.revisions.set(r.id, r);
        return copy(r);
      },
      touchDraft: async (id, expected) => {
        const r = this.revisions.get(id);
        if (!r || r.status !== 'DRAFT' || r.revision !== expected) return false;
        r.revision++;
        return true;
      },
      publishRevision: async (id, expected, actor, snapshot, count) => {
        const r = this.revisions.get(id);
        if (!r || r.status !== 'DRAFT' || r.revision !== expected) return false;
        Object.assign(r, {
          status: 'PUBLISHED',
          revision: expected + 1,
          publishedBy: actor,
          publishedAt: new Date().toISOString(),
          courseSnapshot: copy(snapshot),
          dayCount: count,
        });
        return true;
      },
      days: async (id, q) =>
        this.page(
          [...this.days.values()]
            .filter((d) => d.curriculumRevisionId === id)
            .sort((a, b) => a.dayNumber - b.dayNumber),
          q,
        ),
      allDays: async (id) =>
        copy(
          [...this.days.values()]
            .filter((d) => d.curriculumRevisionId === id)
            .sort((a, b) => a.dayNumber - b.dayNumber),
        ),
      day: async (id) => copy(this.days.get(id) ?? null),
      insertDay: async (d) => {
        this.draft(d.curriculumRevisionId);
        this.uniqueDay(d.curriculumRevisionId, d.dayNumber);
        const day = this.stamp(d);
        this.days.set(day.id, day);
        return copy(day);
      },
      updateDay: async (id, parent, d, actor) => {
        this.draft(parent);
        const old = this.days.get(id);
        if (!old || old.curriculumRevisionId !== parent) return null;
        this.uniqueDay(parent, d.dayNumber, id);
        const day = { ...old, ...copy(d), updatedBy: actor };
        this.days.set(id, day);
        return copy(day);
      },
      removeDay: async (id, parent) => {
        this.draft(parent);
        if (this.days.get(id)?.curriculumRevisionId === parent)
          this.days.delete(id);
      },
      reorder: async (parent, ids) => {
        this.draft(parent);
        ids.forEach((id, i) => {
          this.days.get(id)!.dayNumber = i + 1;
        });
      },
      freezeDay: async (parent, d) => {
        this.draft(parent);
        const key = parent + ':' + d.dayNumber;
        if (this.frozen.has(key)) throw new UniqueConflict('dayNumber');
        this.frozen.set(key, copy(d));
      },
      frozenDays: async (id, q) =>
        this.page(
          [...this.frozen.values()]
            .filter((d) => d.curriculumRevisionId === id)
            .sort((a, b) => a.dayNumber - b.dayNumber),
          q,
        ),
      allFrozenDays: async (id) =>
        copy(
          [...this.frozen.values()]
            .filter((d) => d.curriculumRevisionId === id)
            .sort((a, b) => a.dayNumber - b.dayNumber),
        ),
      frozenDay: async (id, n) => copy(this.frozen.get(id + ':' + n) ?? null),
      problems: async (q) =>
        this.page(
          [...this.problems.values()].filter(
            (p) =>
              (!q.search ||
                p.title.toLowerCase().includes(q.search.toLowerCase())) &&
              (!q.platform || p.platform === q.platform) &&
              (!q.difficulty || p.difficulty === q.difficulty),
          ),
          q,
        ),
      problem: async (id) => copy(this.problems.get(id) ?? null),
      insertProblem: async (d) => {
        if (
          [...this.problems.values()].some(
            (p) =>
              p.platform === d.platform &&
              p.platformProblemId === d.platformProblemId,
          )
        )
          throw new UniqueConflict('platformProblemId');
        const p = this.stamp(d);
        this.problems.set(p.id, p);
        return copy(p);
      },
      updateProblem: async (id, expected, d) => {
        const p = this.problems.get(id);
        if (!p || p.revision !== expected) return null;
        Object.assign(p, copy(d), { revision: expected + 1 });
        return copy(p);
      },
      lockProblem: async (id) => this.problems.has(id),
      editorials: async (id, q, owners) =>
        this.page(
          [...this.editorials.values()].filter(
            (e) =>
              e.problemId === id &&
              (!owners ||
                owners.includes(e.ownerCollegeId ?? '') ||
                (e.ownerCollegeId === null && e.status === 'PUBLISHED')) &&
              (!q.status || e.status === q.status),
          ),
          q,
        ),
      editorial: async (id) => copy(this.editorials.get(id) ?? null),
      nextEditorial: async (id) =>
        Math.max(
          0,
          ...[...this.editorials.values()]
            .filter((e) => e.problemId === id)
            .map((e) => e.versionNumber),
        ) + 1,
      insertEditorial: async (d) => {
        const e = this.stamp(d);
        this.editorials.set(e.id, e);
        return copy(e);
      },
      updateEditorial: async (id, expected, body) => {
        const e = this.editorials.get(id);
        if (!e || e.status !== 'DRAFT' || e.revision !== expected) return null;
        Object.assign(e, { body: copy(body), revision: expected + 1 });
        return copy(e);
      },
      publishEditorial: async (id, expected, actor) => {
        const e = this.editorials.get(id);
        if (!e || e.status !== 'DRAFT' || e.revision !== expected) return null;
        Object.assign(e, {
          status: 'PUBLISHED',
          revision: expected + 1,
          publishedBy: actor,
        });
        return copy(e);
      },
      releases: async (batch, revision) =>
        copy(
          [...this.releases.values()].filter(
            (r) => r.batchId === batch && r.curriculumRevisionId === revision,
          ),
        ),
      putRelease: async (
        batch,
        revision,
        day,
        expected,
        restricted,
        reason,
        actor,
      ) => {
        const key = batch + revision + day,
          old = this.releases.get(key);
        if ((old?.revision ?? 0) !== expected) return null;
        const r = {
          id: old?.id ?? newId(),
          batchId: batch,
          curriculumRevisionId: revision,
          dayId: day,
          restricted,
          reason,
          updatedBy: actor,
          updatedAt: new Date().toISOString(),
          revision: expected + 1,
        };
        this.releases.set(key, r);
        return copy(r);
      },
      assignmentHistory: async (id, q) =>
        this.page(
          this.history.filter((e) => e.batchId === id),
          q,
        ),
      insertAssignmentHistory: async (d) => {
        this.history.push(this.stamp(d));
      },
      studentBatches: async (user, course, q) => {
        const profile = [...this.learning.students.profiles.values()].find(
          (p) => p.userId === user,
        );
        const ids = [...this.learning.enrollments.values()]
          .filter(
            (e) => e.studentProfileId === profile?.id && e.status === 'ACTIVE',
          )
          .map((e) => e.batchId);
        return this.page(
          [...this.learning.batches.values()].filter(
            (b) =>
              b.courseId === course &&
              b.status === 'ACTIVE' &&
              ids.includes(b.id),
          ),
          q,
        );
      },
    };
  }
}
