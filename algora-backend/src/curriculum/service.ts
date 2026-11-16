import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { LearningService } from '../learning/service.js';
import type { AuditAction, AuditRecord } from '../administration/contracts.js';
import type { UserRecord } from '../auth/types.js';
import type { BatchRecord } from '../learning/contracts.js';
import {
  draftSchema,
  dayInput,
  reorderSchema,
  expectedSchema,
  problemInput,
  problemPatch,
  editorialInput,
  editorialPatch,
  assignmentInput,
  releaseInput,
  querySchema,
  type CurriculumRepository,
  type CurriculumUnit,
  type RevisionRecord,
  type DayRecord,
  type FrozenDay,
  type EditorialRecord,
  type Query,
} from './contracts.js';
const fail = (code: string, message: string, status = 409): never => {
  throw new AppError(status, code, message);
};
const need = <T>(v: T | null): T =>
  v ?? fail('NOT_FOUND', 'Record not found', 404);
export const dayLabel = (day: number) => 'Day ' + String(day).padStart(2, '0');
export const released = (day: DayRecord, now: Date) =>
  day.publicationStatus === 'PUBLISHED' ||
  (day.publicationStatus === 'SCHEDULED' &&
    !!day.publishAt &&
    Date.parse(day.publishAt) <= now.getTime());
export function studentDay(day: FrozenDay) {
  return {
    id: day.id,
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    learningObjectives: day.learningObjectives,
    topics: day.topics,
    resources: day.resources
      .filter((r) => r.visibility === 'STUDENT')
      .map(({ visibility, ...r }) => {
        void visibility;
        return r;
      }),
    problemAssignments: day.problemAssignments.map((a) => ({
      problemId: a.problemId,
      category: a.category,
      instructorNote: a.instructorNote,
      problem: {
        id: a.problem.id,
        platform: a.problem.platform,
        platformProblemId: a.problem.platformProblemId,
        title: a.problem.title,
        url: a.problem.url,
        difficulty: a.problem.difficulty,
        topics: a.problem.topics,
        description: a.problem.description,
      },
      editorialAvailable: a.editorialVisibility === 'VISIBLE' && !!a.editorial,
      ...(a.editorialVisibility === 'VISIBLE' && a.editorial
        ? {
            editorial: {
              id: a.editorial.id,
              versionNumber: a.editorial.versionNumber,
              body: a.editorial.body,
            },
          }
        : {}),
    })),
  };
}
export class CurriculumService {
  constructor(
    private repo: CurriculumRepository,
    private authority: LearningService,
    private now: () => Date = () => new Date(),
  ) {}
  private async parent(tx: CurriculumUnit, id: string, course: string) {
    const r = need(await tx.revision(id));
    if (r.courseId !== course) fail('NOT_FOUND', 'Revision not found', 404);
    return r;
  }
  private async draft(tx: CurriculumUnit, r: RevisionRecord, expected: number) {
    if (r.status !== 'DRAFT')
      fail(
        'IMMUTABLE_CONTENT',
        'Published curriculum is immutable; clone it to a new draft',
      );
    if (!(await tx.touchDraft(r.id, expected)))
      fail('STALE_STATE', 'Curriculum changed; refresh and retry');
  }
  private audit(
    tx: CurriculumUnit,
    u: UserRecord,
    action: AuditAction,
    targetType: AuditRecord['targetType'],
    targetId: string,
    requestId: string,
    collegeId?: string,
    before?: string,
    after?: string,
    count?: number,
  ) {
    return tx.learning.students.admin.audit({
      actorUserId: u.id,
      actorName: u.displayName,
      action,
      targetType,
      targetId,
      requestId,
      collegeId,
      metadata: { before, after, count },
    });
  }
  async revisions(actor: string, course: string, q: Query) {
    await this.repo.ensureReady();
    await this.authority.authorizeCourseEditor(
      this.repo.read.learning,
      actor,
      course,
    );
    return this.repo.read.revisions(course, q);
  }
  async revision(actor: string, course: string, id: string, q: Query) {
    await this.repo.ensureReady();
    await this.authority.authorizeCourseEditor(
      this.repo.read.learning,
      actor,
      course,
    );
    const r = await this.parent(this.repo.read, id, course);
    return {
      revision: r,
      days:
        r.status === 'DRAFT'
          ? await this.repo.read.days(id, q)
          : await this.repo.read.frozenDays(id, q),
    };
  }
  async newDraft(
    actor: string,
    course: string,
    input: unknown,
    requestId: string,
  ) {
    const d = draftSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, c } = await this.authority.authorizeCourseEditor(
        tx.learning,
        actor,
        course,
        true,
      );
      const source = d.sourceRevisionId
        ? await this.parent(tx, d.sourceRevisionId, course)
        : null;
      if (source && source.status !== 'PUBLISHED')
        fail('CLONE_PUBLISHED_ONLY', 'Clone a published immutable revision');
      const r = await tx.insertRevision({
        courseId: course,
        revisionNumber: await tx.nextRevision(course),
        status: 'DRAFT',
        revision: 0,
        createdBy: u.id,
        dayCount: 0,
        ...(source ? { sourceRevisionId: source.id } : {}),
      });
      if (source) {
        for (const old of await tx.allFrozenDays(source.id)) {
          const { id, createdAt, updatedAt, problemAssignments, ...fields } =
            old;
          void id;
          void createdAt;
          void updatedAt;
          await tx.insertDay({
            ...fields,
            curriculumRevisionId: r.id,
            createdBy: u.id,
            updatedBy: u.id,
            problemAssignments: problemAssignments.map(
              ({ problem, editorial, ...a }) => {
                void problem;
                void editorial;
                return a;
              },
            ),
          });
        }
      }
      await this.audit(
        tx,
        u,
        source ? 'CURRICULUM_CLONED' : 'CURRICULUM_DRAFT_CREATED',
        'CURRICULUM',
        r.id,
        requestId,
        c.ownerCollegeId ?? undefined,
        source?.id,
        'DRAFT',
      );
      return r;
    });
  }
  async saveDay(
    actor: string,
    course: string,
    revision: string,
    target: string | undefined,
    input: unknown,
    requestId: string,
  ) {
    const { expectedRevision, ...d } = dayInput.parse(input);
    if (
      d.publicationStatus === 'SCHEDULED' &&
      Date.parse(d.publishAt!) <= this.now().getTime()
    )
      fail(
        'SCHEDULE_NOT_FUTURE',
        'Choose a future server-relative publication time',
        400,
      );
    return this.repo.transaction(async (tx) => {
      const { u, c } = await this.authority.authorizeCourseEditor(
          tx.learning,
          actor,
          course,
          true,
        ),
        r = await this.parent(tx, revision, course);
      await this.draft(tx, r, expectedRevision);
      if (target) {
        const old = need(await tx.day(target));
        if (old.curriculumRevisionId !== r.id)
          fail('NOT_FOUND', 'Learning Day not found', 404);
      }
      for (const a of d.problemAssignments) {
        need(await tx.problem(a.problemId));
        if (a.editorialId) {
          const e = need(await tx.editorial(a.editorialId));
          if (e.problemId !== a.problemId || e.status !== 'PUBLISHED')
            fail(
              'EDITORIAL_INELIGIBLE',
              'Select the published editorial of this problem',
            );
          await this.readEditorial(tx, actor, e);
        }
        if (a.editorialVisibility === 'VISIBLE' && !a.editorialId)
          fail(
            'EDITORIAL_REQUIRED',
            'Choose an editorial before making it visible',
            400,
          );
      }
      const result = target
        ? need(await tx.updateDay(target, r.id, d, u.id))
        : await tx.insertDay({
            ...d,
            courseId: course,
            curriculumRevisionId: r.id,
            createdBy: u.id,
            updatedBy: u.id,
          });
      for (const action of [
        target ? 'LEARNING_DAY_UPDATED' : 'LEARNING_DAY_CREATED',
        'TOPICS_UPDATED',
        'RESOURCES_UPDATED',
        'PROBLEM_ASSIGNMENTS_UPDATED',
      ] as const)
        await this.audit(
          tx,
          u,
          action,
          'LEARNING_DAY',
          result.id,
          requestId,
          c.ownerCollegeId ?? undefined,
          undefined,
          action === 'LEARNING_DAY_UPDATED' ? d.publicationStatus : undefined,
        );
      return { day: result, revision: expectedRevision + 1 };
    });
  }
  async preview(
    actor: string,
    course: string,
    revision: string,
    dayId: string,
  ) {
    await this.repo.ensureReady();
    const tx = this.repo.read;
    await this.authority.authorizeCourseEditor(tx.learning, actor, course);
    const r = await this.parent(tx, revision, course);
    let frozen: FrozenDay;
    if (r.status === 'DRAFT') {
      const day = need(await tx.day(dayId));
      if (day.curriculumRevisionId !== r.id)
        fail('NOT_FOUND', 'Learning Day not found', 404);
      const items = [];
      for (const a of day.problemAssignments) {
        const problem = need(await tx.problem(a.problemId)),
          editorial = a.editorialId
            ? need(await tx.editorial(a.editorialId))
            : null;
        if (editorial) await this.readEditorial(tx, actor, editorial);
        items.push({ ...a, problem, editorial });
      }
      frozen = { ...day, problemAssignments: items };
    } else
      frozen =
        (await tx.allFrozenDays(r.id)).find((d) => d.id === dayId) ??
        fail('NOT_FOUND', 'Learning Day not found', 404);
    return {
      preview: studentDay(frozen),
      currentlyReleasedBySchedule: released(frozen, this.now()),
      serverTime: this.now().toISOString(),
    };
  }
  async removeDay(
    actor: string,
    course: string,
    revision: string,
    target: string,
    input: unknown,
    requestId: string,
  ) {
    const d = expectedSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, c } = await this.authority.authorizeCourseEditor(
          tx.learning,
          actor,
          course,
          true,
        ),
        r = await this.parent(tx, revision, course),
        day = need(await tx.day(target));
      if (day.curriculumRevisionId !== r.id)
        fail('NOT_FOUND', 'Learning Day not found', 404);
      await this.draft(tx, r, d.expectedRevision);
      await tx.removeDay(day.id, r.id);
      await this.audit(
        tx,
        u,
        'LEARNING_DAY_REMOVED',
        'LEARNING_DAY',
        day.id,
        requestId,
        c.ownerCollegeId ?? undefined,
      );
      return { removed: true };
    });
  }
  async reorder(
    actor: string,
    course: string,
    revision: string,
    input: unknown,
    requestId: string,
  ) {
    const d = reorderSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, c } = await this.authority.authorizeCourseEditor(
          tx.learning,
          actor,
          course,
          true,
        ),
        r = await this.parent(tx, revision, course),
        days = await tx.allDays(r.id);
      if (
        days.length !== d.dayIds.length ||
        days.some((day) => !d.dayIds.includes(day.id))
      )
        fail(
          'INVALID_ORDER',
          'Reorder must include each current day exactly once',
          400,
        );
      await this.draft(tx, r, d.expectedRevision);
      await tx.reorder(r.id, d.dayIds);
      await this.audit(
        tx,
        u,
        'LEARNING_DAYS_REORDERED',
        'CURRICULUM',
        r.id,
        requestId,
        c.ownerCollegeId ?? undefined,
        undefined,
        undefined,
        days.length,
      );
      return { revision: d.expectedRevision + 1 };
    });
  }
  async publish(
    actor: string,
    course: string,
    revision: string,
    input: unknown,
    requestId: string,
  ) {
    const d = expectedSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, c } = await this.authority.authorizeCourseEditor(
          tx.learning,
          actor,
          course,
          true,
        ),
        r = await this.parent(tx, revision, course);
      if (r.status !== 'DRAFT' || r.revision !== d.expectedRevision)
        fail('STALE_STATE', 'Only the current draft revision can be published');
      const days = await tx.allDays(r.id);
      if (!days.length)
        fail(
          'EMPTY_CURRICULUM',
          'Add at least one Learning Day before publishing',
          400,
        );
      for (const day of days) {
        const assignments = [];
        for (const a of day.problemAssignments) {
          const p = need(await tx.problem(a.problemId));
          const e = a.editorialId
            ? need(await tx.editorial(a.editorialId))
            : null;
          if (e) {
            await this.readEditorial(tx, actor, e);
            if (e.status !== 'PUBLISHED' || e.problemId !== p.id)
              fail(
                'EDITORIAL_INELIGIBLE',
                'Editorial snapshot must be published and match the problem',
              );
          }
          if (a.editorialVisibility === 'VISIBLE' && !e)
            fail(
              'EDITORIAL_REQUIRED',
              'Visible assignments require a published editorial',
            );
          assignments.push({ ...a, problem: p, editorial: e });
        }
        const frozen = { ...day, problemAssignments: assignments };
        if (Buffer.byteLength(JSON.stringify(frozen), 'utf8') > 1024 * 1024)
          fail(
            'DAY_TOO_LARGE',
            'A published day snapshot must fit within 1 MiB',
            400,
          );
        await tx.freezeDay(r.id, frozen);
      }
      const snap = {
        title: c.title,
        code: c.code,
        slug: c.slug,
        description: c.description,
        difficulty: c.difficulty,
        courseRevision: c.revision,
      };
      if (
        !(await tx.publishRevision(
          r.id,
          d.expectedRevision,
          u.id,
          snap,
          days.length,
        ))
      )
        fail('STALE_STATE', 'Curriculum changed before publication');
      await this.audit(
        tx,
        u,
        'CURRICULUM_PUBLISHED',
        'CURRICULUM',
        r.id,
        requestId,
        c.ownerCollegeId ?? undefined,
        'DRAFT',
        'PUBLISHED',
        days.length,
      );
      return need(await tx.revision(r.id));
    });
  }
  async problems(actor: string, q: Query) {
    await this.repo.ensureReady();
    const { u, owners } = await this.authority.authorizeCatalog(
      this.repo.read.learning,
      actor,
    );
    const page = await this.repo.read.problems(q);
    return {
      ...page,
      items: page.items.map((p) => ({
        ...p,
        canManage:
          u.role === 'SUPER_ADMIN' ||
          owners?.includes(p.ownerCollegeId ?? '') === true,
      })),
    };
  }
  async problem(actor: string, id: string) {
    await this.repo.ensureReady();
    const { u, owners } = await this.authority.authorizeCatalog(
      this.repo.read.learning,
      actor,
    );
    const p = need(await this.repo.read.problem(id));
    return {
      ...p,
      canManage:
        u.role === 'SUPER_ADMIN' ||
        owners?.includes(p.ownerCollegeId ?? '') === true,
    };
  }
  async saveProblem(
    actor: string,
    input: unknown,
    target: string | undefined,
    requestId: string,
  ) {
    const data = target ? problemPatch.parse(input) : problemInput.parse(input);
    return this.repo.transaction(async (tx) => {
      const old = target ? need(await tx.problem(target)) : null;
      const { u } = await this.authority.authorizeCatalog(
        tx.learning,
        actor,
        old?.ownerCollegeId ?? data.ownerCollegeId,
        true,
      );
      if (
        old &&
        (old.ownerCollegeId !== data.ownerCollegeId ||
          old.platform !== data.platform ||
          old.platformProblemId !== data.platformProblemId ||
          old.url !== data.url)
      )
        fail(
          'IMMUTABLE_PROBLEM_IDENTITY',
          'Canonical problem identity and ownership cannot be replaced',
        );
      const { expectedRevision, ...fields } = data as typeof data & {
        expectedRevision?: number;
      };
      const p = old
        ? await tx.updateProblem(old.id, expectedRevision!, {
            title: fields.title,
            difficulty: fields.difficulty,
            topics: fields.topics,
            description: fields.description,
            updatedBy: u.id,
          })
        : await tx.insertProblem({
            ...fields,
            revision: 0,
            createdBy: u.id,
            updatedBy: u.id,
          });
      const saved = p ?? fail('STALE_STATE', 'Problem metadata changed');
      await this.audit(
        tx,
        u,
        old ? 'PROBLEM_UPDATED' : 'PROBLEM_CREATED',
        'CODING_PROBLEM',
        saved.id,
        requestId,
        saved.ownerCollegeId ?? undefined,
      );
      return saved;
    });
  }
  private async readEditorial(
    tx: CurriculumUnit,
    actor: string,
    e: EditorialRecord,
    write = false,
  ) {
    const { u, owners } = await this.authority.authorizeCatalog(
      tx.learning,
      actor,
      e.ownerCollegeId,
      write,
    );
    if (
      u.role !== 'SUPER_ADMIN' &&
      !owners?.includes(e.ownerCollegeId ?? '') &&
      !(e.ownerCollegeId === null && e.status === 'PUBLISHED' && !write)
    )
      fail(
        'EDITORIAL_FORBIDDEN',
        'This editorial is outside your ownership scope',
        403,
      );
    return u;
  }
  async editorials(actor: string, problem: string, q: Query) {
    await this.repo.ensureReady();
    need(await this.repo.read.problem(problem));
    const { u, owners } = await this.authority.authorizeCatalog(
      this.repo.read.learning,
      actor,
    );
    const page = await this.repo.read.editorials(problem, q, owners);
    return {
      ...page,
      items: page.items.map((e) => ({
        ...e,
        canManage:
          u.role === 'SUPER_ADMIN' ||
          owners?.includes(e.ownerCollegeId ?? '') === true,
      })),
    };
  }
  async editorial(actor: string, problem: string, id: string) {
    await this.repo.ensureReady();
    const e = need(await this.repo.read.editorial(id));
    if (e.problemId !== problem) fail('NOT_FOUND', 'Editorial not found', 404);
    await this.readEditorial(this.repo.read, actor, e);
    return e;
  }
  async saveEditorial(
    actor: string,
    problem: string,
    target: string | undefined,
    input: unknown,
    requestId: string,
  ) {
    const d = target
      ? editorialPatch.parse(input)
      : editorialInput.parse(input);
    return this.repo.transaction(async (tx) => {
      need(await tx.problem(problem));
      await tx.lockProblem(problem);
      const old = target ? need(await tx.editorial(target)) : null;
      const { u } = await this.authority.authorizeCatalog(
        tx.learning,
        actor,
        old?.ownerCollegeId ?? d.ownerCollegeId,
        true,
      );
      if (
        old &&
        (old.problemId !== problem || old.ownerCollegeId !== d.ownerCollegeId)
      )
        fail('NOT_FOUND', 'Editorial not found', 404);
      if (old && old.status !== 'DRAFT')
        fail(
          'IMMUTABLE_CONTENT',
          'Published editorials are immutable; clone into a new draft',
        );
      const expected = target
        ? editorialPatch.parse(input).expectedRevision
        : 0;
      const e = old
        ? await tx.updateEditorial(old.id, expected, d.body)
        : await tx.insertEditorial({
            problemId: problem,
            versionNumber: await tx.nextEditorial(problem),
            ownerCollegeId: d.ownerCollegeId,
            body: d.body,
            revision: 0,
            status: 'DRAFT',
            createdBy: u.id,
          });
      const result = e ?? fail('STALE_STATE', 'Editorial changed');
      await this.audit(
        tx,
        u,
        old ? 'EDITORIAL_UPDATED' : 'EDITORIAL_CREATED',
        'EDITORIAL',
        result.id,
        requestId,
        result.ownerCollegeId ?? undefined,
        undefined,
        result.status,
      );
      return result;
    });
  }
  async publishEditorial(
    actor: string,
    problem: string,
    id: string,
    input: unknown,
    requestId: string,
  ) {
    const d = expectedSchema.parse(input);
    return this.repo.transaction(async (tx) => {
      const e = need(await tx.editorial(id));
      if (e.problemId !== problem)
        fail('NOT_FOUND', 'Editorial not found', 404);
      const u = await this.readEditorial(tx, actor, e, true);
      const result =
        (await tx.publishEditorial(e.id, d.expectedRevision, u.id)) ??
        fail('STALE_STATE', 'Editorial is published or changed');
      await this.audit(
        tx,
        u,
        'EDITORIAL_PUBLISHED',
        'EDITORIAL',
        e.id,
        requestId,
        e.ownerCollegeId ?? undefined,
        'DRAFT',
        'PUBLISHED',
      );
      return result;
    });
  }
  async cloneEditorial(
    actor: string,
    problem: string,
    id: string,
    requestId: string,
  ) {
    return this.repo.transaction(async (tx) => {
      const old = need(await tx.editorial(id));
      if (old.problemId !== problem || old.status !== 'PUBLISHED')
        fail('EDITORIAL_INELIGIBLE', 'Clone a published editorial');
      const u = await this.readEditorial(tx, actor, old, true);
      await tx.lockProblem(problem);
      const e = await tx.insertEditorial({
        problemId: problem,
        versionNumber: await tx.nextEditorial(problem),
        ownerCollegeId: old.ownerCollegeId,
        body: old.body,
        revision: 0,
        status: 'DRAFT',
        sourceEditorialId: old.id,
        createdBy: u.id,
      });
      await this.audit(
        tx,
        u,
        'EDITORIAL_CREATED',
        'EDITORIAL',
        e.id,
        requestId,
        e.ownerCollegeId ?? undefined,
        old.id,
        'DRAFT',
      );
      return e;
    });
  }
  private impact(b: BatchRecord, r: RevisionRecord) {
    const previous = b.curriculumRevisionId ?? null;
    const summary = {
      batchId: b.id,
      batchRevision: b.revision,
      previousRevisionId: previous,
      newRevisionId: r.id,
      newDayCount: r.dayCount,
      activeMemberships: b.seatCount,
      batchStatus: b.status,
    };
    return {
      ...summary,
      impactFingerprint: createHash('sha256')
        .update(JSON.stringify(summary))
        .digest('hex'),
    };
  }
  async batch(actor: string, batch: string, q: Query) {
    await this.repo.ensureReady();
    const tx = this.repo.read;
    const { b } = await this.authority.authorizeBatchManager(
      tx.learning,
      actor,
      batch,
    );
    const assigned = b.curriculumRevisionId
      ? await this.parent(tx, b.curriculumRevisionId, b.courseId)
      : null;
    return {
      batch: b,
      assignedRevision: assigned,
      options: await tx.revisions(
        b.courseId,
        { ...q, status: 'PUBLISHED' },
        true,
      ),
      releases: assigned ? await tx.releases(b.id, assigned.id) : [],
    };
  }
  async assignmentPreview(actor: string, batch: string, revision: string) {
    await this.repo.ensureReady();
    const { b } = await this.authority.authorizeBatchManager(
      this.repo.read.learning,
      actor,
      batch,
    );
    const r = await this.parent(this.repo.read, revision, b.courseId);
    if (r.status !== 'PUBLISHED')
      fail('REVISION_NOT_PUBLISHED', 'Choose a published curriculum revision');
    return this.impact(b, r);
  }
  async assign(
    actor: string,
    batch: string,
    input: unknown,
    requestId: string,
  ) {
    const d = assignmentInput.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.authority.authorizeBatchManager(
        tx.learning,
        actor,
        batch,
        true,
      );
      if (!['DRAFT', 'ACTIVE'].includes(b.status))
        fail(
          'BATCH_CLOSED',
          'Completed and archived curriculum history cannot change',
        );
      const r = await this.parent(tx, d.curriculumRevisionId, b.courseId);
      if (r.status !== 'PUBLISHED')
        fail('REVISION_NOT_PUBLISHED', 'Choose a published revision');
      if (b.curriculumRevisionId !== r.id && (await tx.hasAttendance(b.id)))
        fail(
          'ATTENDANCE_HISTORY_LOCKED',
          'Curriculum replacement is blocked once attendance exists',
        );
      if (b.curriculumRevisionId !== r.id && (await tx.hasProgress(b.id)))
        fail(
          'CODING_HISTORY_LOCKED',
          'Curriculum replacement is blocked once coding sync or progress exists',
        );
      const impact = this.impact(b, r);
      if (
        b.revision !== d.expectedBatchRevision ||
        (b.curriculumRevisionId ?? null) !== d.expectedPreviousRevisionId ||
        impact.impactFingerprint !== d.impactFingerprint
      )
        fail('STALE_IMPACT', 'Batch or impact changed; review again');
      if (b.curriculumRevisionId === r.id)
        return { assigned: true, unchanged: true };
      need(
        await tx.learning.updateBatch(b.id, b.revision, {
          curriculumRevisionId: r.id,
          updatedBy: u.id,
        }),
      );
      await tx.insertAssignmentHistory({
        batchId: b.id,
        previousRevisionId: b.curriculumRevisionId ?? null,
        newRevisionId: r.id,
        actorUserId: u.id,
        reason: d.reason,
        activeMemberships: b.seatCount,
      });
      await this.audit(
        tx,
        u,
        b.status === 'ACTIVE'
          ? 'BATCH_CURRICULUM_UPGRADED'
          : 'BATCH_CURRICULUM_ASSIGNED',
        'BATCH',
        b.id,
        requestId,
        b.collegeId,
        b.curriculumRevisionId ?? 'UNASSIGNED',
        r.id,
        b.seatCount,
      );
      return { assigned: true, unchanged: false };
    });
  }
  async batchDays(actor: string, batch: string, q: Query) {
    await this.repo.ensureReady();
    const { b } = await this.authority.authorizeBatchManager(
      this.repo.read.learning,
      actor,
      batch,
    );
    if (!b.curriculumRevisionId)
      return {
        items: [],
        total: 0,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: 0,
      };
    const data = await this.repo.read.frozenDays(b.curriculumRevisionId, q);
    return {
      ...data,
      items: data.items.map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        publicationStatus: d.publicationStatus,
      })),
    };
  }
  async history(actor: string, batch: string, q: Query) {
    await this.repo.ensureReady();
    await this.authority.authorizeBatchManager(
      this.repo.read.learning,
      actor,
      batch,
    );
    return this.repo.read.assignmentHistory(batch, q);
  }
  async release(
    actor: string,
    batch: string,
    dayId: string,
    input: unknown,
    requestId: string,
  ) {
    const d = releaseInput.parse(input);
    return this.repo.transaction(async (tx) => {
      const { u, b } = await this.authority.authorizeBatchManager(
        tx.learning,
        actor,
        batch,
        true,
      );
      if (!['DRAFT', 'ACTIVE'].includes(b.status) || !b.curriculumRevisionId)
        fail('BATCH_CLOSED', 'A current assigned curriculum is required');
      const day =
        (await tx.allFrozenDays(b.curriculumRevisionId!)).find(
          (v) => v.id === dayId,
        ) ?? fail('NOT_FOUND', 'Assigned Learning Day not found', 404);
      const control =
        (await tx.putRelease(
          b.id,
          b.curriculumRevisionId!,
          day.id,
          d.expectedRevision,
          d.restricted,
          d.reason,
          u.id,
        )) ?? fail('STALE_STATE', 'Release control changed');
      await this.audit(
        tx,
        u,
        d.restricted ? 'LEARNING_DAY_RESTRICTED' : 'LEARNING_DAY_UNRESTRICTED',
        'LEARNING_DAY',
        day.id,
        requestId,
        b.collegeId,
        undefined,
        d.restricted ? 'RESTRICTED' : 'ORIGINAL_SCHEDULE',
      );
      return control;
    });
  }
  private async studentContext(actor: string, batch: string) {
    await this.repo.ensureReady();
    const access = await this.authority.effective(actor, batch);
    const id = access.batch.curriculumRevisionId;
    if (!id) return { ...access, revision: null };
    const r = need(await this.repo.read.revision(id));
    if (r.status !== 'PUBLISHED' || r.courseId !== access.batch.courseId)
      fail(
        'CURRICULUM_UNAVAILABLE',
        'Assigned published curriculum is unavailable',
        403,
      );
    return { ...access, revision: r };
  }
  async studentBatch(actor: string, batch: string, q: Query) {
    const context = await this.studentContext(actor, batch),
      b = context.batch;
    if (!context.revision)
      return {
        batch: {
          id: b.id,
          name: b.name,
          courseId: b.courseId,
          courseTitle: b.snapshot.title,
          collegeId: b.collegeId,
        },
        revision: null,
        days: {
          items: [],
          total: 0,
          page: q.page,
          pageSize: q.pageSize,
          totalPages: 0,
        },
        message: 'Curriculum not assigned',
      };
    const r = context.revision,
      controls = await this.repo.read.releases(b.id, r.id),
      now = this.now();
    const visible = (await this.repo.read.allFrozenDays(r.id)).filter(
      (d) =>
        released(d, now) &&
        !controls.some((c) => c.dayId === d.id && c.restricted),
    );
    const items = visible
      .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
      .map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        topics: d.topics.map((t) => t.title),
        resourceCount: d.resources.filter((v) => v.visibility === 'STUDENT')
          .length,
        problemCount: d.problemAssignments.length,
      }));
    const college = await this.repo.read.learning.students.admin.college(
      b.collegeId,
    );
    return {
      batch: {
        id: b.id,
        name: b.name,
        courseId: b.courseId,
        courseTitle: r.courseSnapshot?.title ?? b.snapshot.title,
        collegeId: b.collegeId,
        collegeName: college?.name,
      },
      revision: {
        id: r.id,
        revisionNumber: r.revisionNumber,
        courseSnapshot: r.courseSnapshot,
      },
      days: {
        items,
        total: visible.length,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.ceil(visible.length / q.pageSize),
      },
      message: visible.length ? '' : 'No Learning Days are released yet',
    };
  }
  async studentDay(actor: string, batch: string, number: number) {
    const c = await this.studentContext(actor, batch);
    if (!c.revision)
      fail('CURRICULUM_NOT_ASSIGNED', 'Curriculum not assigned', 404);
    const r = need(c.revision),
      day = need(await this.repo.read.frozenDay(r.id, number));
    if (
      !released(day, this.now()) ||
      (await this.repo.read.releases(batch, r.id)).some(
        (v) => v.dayId === day.id && v.restricted,
      )
    )
      fail('DAY_UNAVAILABLE', 'Learning Day is not currently released', 404);
    return {
      batch: { id: c.batch.id, name: c.batch.name, courseId: c.batch.courseId },
      revision: { id: r.id, revisionNumber: r.revisionNumber },
      day: studentDay(day),
    };
  }
  async studentEditorial(
    actor: string,
    batch: string,
    number: number,
    problem: string,
  ) {
    const data = await this.studentDay(actor, batch, number);
    const assignment = data.day.problemAssignments.find(
      (p) => p.problemId === problem,
    );
    if (!assignment?.editorial)
      fail('NOT_FOUND', 'Editorial is not available', 404);
    return assignment!.editorial;
  }
  async studentCourse(actor: string, course: string, q: Query) {
    await this.repo.ensureReady();
    const candidates = await this.repo.read.studentBatches(actor, course, q);
    const batches = [];
    for (const b of candidates.items) {
      try {
        await this.authority.effective(actor, b.id);
        const r = b.curriculumRevisionId
          ? await this.repo.read.revision(b.curriculumRevisionId)
          : null;
        batches.push({
          id: b.id,
          name: b.name,
          curriculumRevision:
            r?.status === 'PUBLISHED'
              ? { id: r.id, revisionNumber: r.revisionNumber }
              : null,
        });
      } catch (e) {
        if (!(e instanceof AppError && [403, 404].includes(e.status))) throw e;
      }
    }
    if (!batches.length)
      fail(
        'ENROLLMENT_REQUIRED',
        'A current authorized course enrollment is required',
        403,
      );
    const c = need(await this.repo.read.learning.course(course));
    return {
      course: {
        id: c.id,
        title: c.title,
        description: c.description,
        difficulty: c.difficulty,
      },
      batches: { ...candidates, items: batches },
    };
  }
}
export const defaultQuery = querySchema.parse({});
