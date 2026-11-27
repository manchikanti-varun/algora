import { createHash } from 'node:crypto';
import { notFound } from '../../lib/errors';
import { Batch, BatchChapterAccess, BatchCourse, CatalogProblem, Chapter, Course, Problem, type UserDoc } from '../../models';
import { AiBatch, AiPractice } from '../../models/ai';
import { trainerBatchIds } from '../access';
import { studentContexts } from '../student/contexts';
import { settings } from './runtime';

export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function batchAiAvailable(controls: {
  enabled?: boolean | null; courseIds?: string[]; startsAt?: Date | null; endsAt?: Date | null;
  startMinute?: number | null; endMinute?: number | null;
} | null, courseId: string, now = new Date()) {
  const minute = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  const start = controls?.startMinute;
  const end = controls?.endMinute;
  const inWindow = start == null || end == null || (start <= end ? minute >= start && minute < end : minute >= start || minute < end);
  return !!controls?.enabled && (!controls.courseIds?.length || controls.courseIds.includes(courseId))
    && (!controls.startsAt || controls.startsAt <= now) && (!controls.endsAt || controls.endsAt > now) && inWindow;
}

export async function studentProblem(user: UserDoc, batchCourseId: string, problemId: string) {
  const context = (await studentContexts(user._id)).find(({ bc }) => String(bc._id) === batchCourseId);
  if (!context) throw notFound('Practice problem not found');
  const problem = await Problem.findOne({ _id: problemId, courseId: context.course._id, status: 'ACTIVE' }).lean();
  if (!problem) throw notFound('Practice problem not found');
  const [chapter, visible, catalog, controls] = await Promise.all([
    Chapter.findOne({ _id: problem.chapterId, courseId: context.course._id, status: 'ACTIVE' }).lean(),
    BatchChapterAccess.findOne({ batchCourseId, chapterId: problem.chapterId, isVisible: true }, 'studentAiEnabled').lean(),
    problem.catalogId ? CatalogProblem.findById(problem.catalogId).lean() : CatalogProblem.findOne({ platform: 'leetcode', slug: problem.slug }).lean(),
    AiBatch.findById(String(context.bc.batchId)).lean(),
  ]);
  if (!chapter || !visible) throw notFound('Practice problem not found');
  const allowed = visible.studentAiEnabled === true && !!catalog && batchAiAvailable(controls, String(context.course._id));
  return {
    batchId: String(context.bc.batchId), courseId: String(context.course._id), chapterId: String(chapter._id), problemId,
    course: context.course.title, chapter: chapter.title, title: problem.title, difficulty: problem.difficulty,
    slug: problem.slug, url: problem.url, number: catalog?.problemNumber, topics: catalog?.topics ?? [],
    catalogId: catalog ? String(catalog._id) : undefined, allowed, daily: controls?.daily,
  };
}

export async function practice(user: UserDoc) {
  const saved = await AiPractice.findById(String(user._id)).lean();
  if (!saved?.batchCourseId || !saved.problemId) return null;
  try {
    const problem = await studentProblem(user, saved.batchCourseId, saved.problemId);
    return { ...problem, allowed: problem.allowed && (await settings('STUDENT_MENTOR')).enabled, batchCourseId: saved.batchCourseId };
  }
  catch (error) {
    if (!(error instanceof Error && 'status' in error && error.status === 404)) throw error;
    await AiPractice.deleteOne({ _id: saved._id, batchCourseId: saved.batchCourseId, problemId: saved.problemId });
    return null;
  }
}

export async function staffCourses(user: UserDoc) {
  if (user.role === 'SUPER_ADMIN') return {};
  const batches = await Batch.find({ _id: { $in: await trainerBatchIds(user) }, status: { $ne: 'ARCHIVED' } }, '_id').lean();
  const assignments = await BatchCourse.distinct('courseId', { batchId: { $in: batches.map((batch) => batch._id) }, status: 'ACTIVE' });
  return { _id: { $in: assignments } };
}

export async function staffCourse(user: UserDoc, courseId: string) {
  const course = await Course.findOne({ $and: [{ _id: courseId, status: { $ne: 'ARCHIVED' } }, await staffCourses(user)] }).lean();
  if (!course) throw notFound('Course not found');
  return course;
}

export async function staffChapter(user: UserDoc, chapterId: string) {
  const chapter = await Chapter.findOne({ _id: chapterId, status: 'ACTIVE' }).lean();
  if (!chapter) throw notFound('Chapter not found');
  const course = await staffCourse(user, String(chapter.courseId));
  const assigned = await Problem.find({ chapterId, courseId: course._id, status: 'ACTIVE' }).sort({ order: 1, _id: 1 }).limit(501).lean();
  const catalog = await CatalogProblem.find({ $or: [
    { _id: { $in: assigned.flatMap((item) => item.catalogId ? [item.catalogId] : []) } },
    { platform: 'leetcode', slug: { $in: assigned.filter((item) => !item.catalogId).map((item) => item.slug) } },
  ] }).lean();
  const byId = new Map(catalog.map((problem) => [String(problem._id), problem]));
  const bySlug = new Map(catalog.filter((problem) => problem.platform === 'leetcode').map((problem) => [problem.slug, problem]));
  const problems = assigned.map((problem) => {
    const item = problem.catalogId ? byId.get(String(problem.catalogId)) : bySlug.get(problem.slug);
    const metadata = { title: item?.title ?? problem.title, slug: problem.slug, url: item?.url ?? problem.url,
      difficulty: item?.difficulty ?? problem.difficulty, number: item?.problemNumber, topics: item?.topics ?? [] };
    return { id: String(problem._id), catalogId: item && String(item._id), order: problem.order,
      ...metadata, fingerprint: fingerprint(metadata) };
  });
  return { course: { id: String(course._id), title: course.title }, chapter: { id: chapterId, title: chapter.title, description: chapter.description }, problems };
}
