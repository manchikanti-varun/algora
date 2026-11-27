import { Router } from 'express';
import { env } from '../../config/env';
import { Enrollment, StudentRequest, TrainerBatchAssignment, TrainerRequest, type UserDoc } from '../../models';
import { requireAuth, requireRole } from '../../middleware/auth';
import { overview } from '../analytics/analytics.service';
import { providerViews } from '../leetcode/provider-manager';

/**
 * One round trip for the management overview: metrics, the counts that drive the attention list and a cheap
 * integration state. It is still scoped exactly like the individual endpoints it replaces, and it never contacts
 * LeetCode — only stored provider state is read.
 */
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireRole('SUPER_ADMIN', 'TRAINER'));

dashboardRouter.get('/overview', async (req, res) => {
  const started = process.hrtime.bigint();
  const admin = req.user!.role === 'SUPER_ADMIN';
  const [overviewData, studentRequests, trainerRequests, integration] = await Promise.all([
    overview(req.user!, {}),
    scopedStudentRequestCount(req.user!),
    admin ? TrainerRequest.countDocuments({ status: 'PENDING_APPROVAL' }) : Promise.resolve(0),
    admin ? providerViews() : Promise.resolve(null),
  ]);
  const enabled = integration
    ? env.LEETCODE_SYNC_ENABLED && integration.views.some((v) => v.envEnabled && v.adminEnabled && v.authorized)
    : undefined;
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('server-timing', `dashboard;dur=${Math.round(Number(process.hrtime.bigint() - started) / 1e6)}`);
  res.json({
    overview: overviewData,
    counts: {
      studentRequests,
      trainerRequests,
      pendingEnrollments: overviewData.totals.pendingEnrollments,
    },
    integration: { enabled, paused: integration?.settings.paused ?? null },
  });
});

/** Same trainer scope as /student-requests: only students enrolled in their active batches. */
async function scopedStudentRequestCount(user: UserDoc) {
  if (user.role !== 'TRAINER') return StudentRequest.countDocuments({ status: 'PENDING' });
  const batches = await TrainerBatchAssignment.distinct('batchId', { trainerId: user._id, status: 'ACTIVE' });
  const studentIds = await Enrollment.distinct('studentId', { batchId: { $in: batches }, status: 'ACTIVE' });
  return StudentRequest.countDocuments({ status: 'PENDING', studentId: { $in: studentIds } });
}
