import { Enrollment, PendingEnrollment, User } from '../../models';
import { DEFAULT_TIMEZONE, endOfDate, startOfDate } from './attendance.time';

export interface RosterStudent {
  studentId: string;
  enrollmentId: string;
  rollNumber: string;
  name: string;
  collegeId: string | null;
  collegeName: string | null;
}

/**
 * The attendance roster for a batch on a calendar date: active enrollments that existed on that date. A student is
 * eligible when they enrolled on or before the date and had not been removed before it. Pending enrollments (no student
 * account yet) are never part of the roster and are reported separately so they cannot silently become absences.
 */
export async function eligibleRoster(batchId: string, attendanceDate: string, tz = DEFAULT_TIMEZONE): Promise<{ roster: RosterStudent[]; pendingCount: number }> {
  const start = startOfDate(attendanceDate, tz);
  const end = endOfDate(attendanceDate, tz);
  const [enrollments, pendingCount] = await Promise.all([
    Enrollment.find({
      batchId,
      enrolledAt: { $lte: end },
      $or: [{ status: 'ACTIVE' }, { status: 'REMOVED', removedAt: { $gt: start } }],
    }, 'studentId enrolledAt').lean(),
    PendingEnrollment.countDocuments({ batchId, status: 'PENDING' }),
  ]);
  if (!enrollments.length) return { roster: [], pendingCount };
  const users = await User.find(
    { _id: { $in: enrollments.map((e) => e.studentId) }, role: 'STUDENT', status: 'ACTIVE' },
    'fullName rollNumber collegeId',
  ).populate<{ collegeId?: { _id?: unknown; name?: string } | null }>('collegeId', 'name').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const roster: RosterStudent[] = [];
  const seen = new Set<string>();
  for (const enrollment of enrollments) {
    const user = byId.get(String(enrollment.studentId));
    if (!user?.rollNumber || seen.has(String(user._id))) continue;
    seen.add(String(user._id));
    roster.push({
      studentId: String(user._id),
      enrollmentId: String(enrollment._id),
      rollNumber: user.rollNumber,
      name: user.fullName,
      collegeId: user.collegeId?._id ? String(user.collegeId._id) : null,
      collegeName: user.collegeId?.name ?? null,
    });
  }
  roster.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
  return { roster, pendingCount };
}
