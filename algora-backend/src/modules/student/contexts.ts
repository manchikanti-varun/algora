import type { Types } from 'mongoose';
import { Batch, BatchCourse, Course, Enrollment } from '../../models';

/** Contexts a student may currently see: active enrollment + active batch + active assignment + published course. */
export async function studentContexts(studentId: Types.ObjectId) {
  const enr = await Enrollment.find({ studentId, status: 'ACTIVE' }, 'batchId').lean();
  const batches = await Batch.find({ _id: { $in: enr.map((e) => e.batchId) }, status: 'ACTIVE' }, 'name').lean();
  const bcs = await BatchCourse.find({ batchId: { $in: batches.map((b) => b._id) }, status: 'ACTIVE' }).lean();
  const courses = await Course.find({ _id: { $in: bcs.map((b) => b.courseId) }, status: 'PUBLISHED' }, 'title description').lean();
  const bName = new Map(batches.map((b) => [String(b._id), b.name]));
  const cMap = new Map(courses.map((c) => [String(c._id), c]));
  return bcs.filter((bc) => cMap.has(String(bc.courseId))).map((bc) => ({ bc, course: cMap.get(String(bc.courseId))!, batchName: bName.get(String(bc.batchId))! }));
}
