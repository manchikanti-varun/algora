import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound, parse } from '../../lib/errors';
import { objectId, pagination } from '../../lib/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { BatchCourse, Setting } from '../../models';
import { audit } from '../audit/audit';
import { loadBatchFor } from '../access';
import { batchBoard, batchCourseBoard, courseBoard, paginate } from './progress.service';
import { getScoring, scoringSchema } from './scoring';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));
settingsRouter.get('/scoring', async (_req, res) => res.json(await getScoring()));
settingsRouter.put('/scoring', async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') throw forbidden();
  const value = parse(scoringSchema, req.body);
  await Setting.updateOne({ _id: 'scoring' }, { $set: { value, updatedBy: req.user!._id } }, { upsert: true });
  await audit(req, 'settings.scoring', { type: 'Setting', id: 'scoring' }, value);
  res.json(value);
});

/** Management leaderboards (include roll numbers). Trainers only see batches they are assigned to; course-wide is Super Admin only. */
export const leaderboardsRouter = Router();
leaderboardsRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));
leaderboardsRouter.get('/batches/:id', async (req, res) => {
  const batch = await loadBatchFor(req.user!, parse(objectId, req.params.id));
  const q = parse(pagination.extend({ courseId: objectId.optional() }), req.query);
  let board;
  if (q.courseId) {
    const bc = await BatchCourse.findOne({ batchId: batch._id, courseId: q.courseId });
    if (!bc) throw notFound('Course not assigned to this batch');
    board = await batchCourseBoard(String(bc._id), true);
  } else board = await batchBoard(String(batch._id), true);
  if (!board) throw notFound('Not found');
  res.json({ scope: board.scope, total: board.rows.length, page: q.page, pageSize: q.pageSize, items: paginate(board.rows, q.page, q.pageSize) });
});
leaderboardsRouter.get('/courses/:id', requireRole('SUPER_ADMIN'), async (req, res) => {
  const q = parse(pagination, req.query);
  const board = await courseBoard(parse(objectId, req.params.id), true);
  res.json({ scope: board.scope, total: board.rows.length, page: q.page, pageSize: q.pageSize, items: paginate(board.rows, q.page, q.pageSize) });
});
