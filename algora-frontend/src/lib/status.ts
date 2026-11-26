/**
 * One vocabulary for every status string the backend returns. Labels are what people see; tones drive colour.
 * Wording rule: an unverified problem is never "unsolved". Algora may simply not have seen the accepted submission yet.
 */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
interface Def { label: string; tone: Tone }
const S: Record<string, Def> = {
  // records
  ACTIVE: { label: 'Active', tone: 'success' }, DRAFT: { label: 'Draft', tone: 'neutral' }, PUBLISHED: { label: 'Published', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'info' }, ARCHIVED: { label: 'Archived', tone: 'neutral' }, INACTIVE: { label: 'Inactive', tone: 'neutral' },
  MERGED: { label: 'Merged', tone: 'neutral' }, CONSENT_WITHDRAWN: { label: 'Consent withdrawn', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' }, REVOKED: { label: 'Revoked', tone: 'danger' },
  // trainer requests and enrollment reservations
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' }, APPROVED: { label: 'Approved', tone: 'success' }, REJECTED: { label: 'Rejected', tone: 'danger' },
  PENDING: { label: 'Pending', tone: 'warning' }, CLAIMED: { label: 'Claimed', tone: 'success' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  // chapter access
  VISIBLE: { label: 'Visible', tone: 'success' }, HIDDEN: { label: 'Hidden', tone: 'neutral' },
  // LeetCode account link
  LINKED: { label: 'Connected', tone: 'success' }, VERIFIED: { label: 'Connected', tone: 'success' }, UNLINKED: { label: 'Not connected', tone: 'neutral' },
  SUPERSEDED: { label: 'Replaced', tone: 'neutral' }, PENDING_VERIFICATION: { label: 'Pending', tone: 'warning' }, REVALIDATION_REQUIRED: { label: 'Needs attention', tone: 'warning' },
  // progress updates (per student)
  IDLE: { label: 'Not updated yet', tone: 'neutral' }, QUEUED: { label: 'Update queued', tone: 'info' }, SYNC_PENDING: { label: 'Update queued', tone: 'info' },
  UPDATING: { label: 'Updating', tone: 'info' }, SYNCING: { label: 'Updating', tone: 'info' }, DELAYED: { label: 'Delayed', tone: 'warning' },
  SYNC_SUCCESS: { label: 'Up to date', tone: 'success' }, NO_SUBMISSIONS_OBSERVED: { label: 'No accepted submissions', tone: 'neutral' },
  POSSIBLE_EVIDENCE_GAP: { label: 'Incomplete history', tone: 'warning' }, SUBMISSIONS_UNAVAILABLE: { label: 'Submissions not visible', tone: 'warning' },
  ACCOUNT_NOT_FOUND: { label: 'Username not found', tone: 'danger' }, SYNC_FAILED: { label: 'Update failed', tone: 'danger' },
  RATE_LIMITED: { label: 'Delayed', tone: 'warning' }, PROVIDER_UNAVAILABLE: { label: 'Temporarily unavailable', tone: 'warning' },
  VERIFICATION_UNAVAILABLE: { label: 'Updates unavailable', tone: 'neutral' }, SYNC_PAUSED: { label: 'Paused', tone: 'warning' },
  // background jobs and logs
  SUCCEEDED: { label: 'Succeeded', tone: 'success' }, SUCCESS: { label: 'Succeeded', tone: 'success' }, FAILED: { label: 'Failed', tone: 'danger' },
  PARTIAL: { label: 'Partial', tone: 'warning' }, RUNNING: { label: 'Running', tone: 'info' }, SKIPPED: { label: 'Skipped', tone: 'neutral' },
  // difficulty
  EASY: { label: 'Easy', tone: 'success' }, MEDIUM: { label: 'Medium', tone: 'warning' }, HARD: { label: 'Hard', tone: 'danger' },
};
const humanize = (s: string) => s.replace(/[_.]/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const statusLabel = (s: string) => S[s]?.label ?? humanize(s);
export const statusTone = (s: string): Tone => S[s]?.tone ?? 'neutral';
/** Progress-update states that mean "something is wrong and the student cannot fix it by waiting a few seconds". */
export const SYNC_PROBLEM_STATES = ['SYNC_FAILED', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'ACCOUNT_NOT_FOUND', 'SUBMISSIONS_UNAVAILABLE'];

/** Human-readable audit log actions. Unknown actions fall back to a readable form of the code. */
const AUDIT: Record<string, string> = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out',
  'batch.create': 'Batch created', 'batch.update': 'Batch updated', 'batch.course.assign': 'Course added to batch', 'batch.course.status': 'Course access changed',
  'batch.trainer.assign': 'Trainer assigned to batch', 'batch.trainer.revoke': 'Trainer removed from batch',
  'catalog.assign': 'Library problems added to chapter', 'catalog.create': 'Library problem added', 'catalog.import': 'Problem library imported',
  'chapter.bulk': 'Chapter problems updated in bulk', 'chapter.create': 'Chapter created', 'chapter.reorder': 'Chapter order changed', 'chapter.update': 'Chapter updated',
  'chapter.access': 'Chapter access changed', 'chapter.access.bulk': 'Chapter access changed for all chapters',
  'college.create': 'College added', 'college.update': 'College updated', 'college.reconcile': 'Duplicate college merged', 'course.create': 'Course created', 'course.update': 'Course updated',
  'student.request.submitted': 'Change request submitted', 'student.request.reviewed': 'Change request reviewed', 'student.request.cancelled': 'Change request cancelled',
  'student.leetcode.consent_withdrawn': 'Stopped sharing LeetCode submissions',
  'enrollment.add': 'Student enrolled', 'enrollment.import': 'Students imported from CSV', 'enrollment.remove': 'Student removed from batch',
  'integration.health_check': 'Integration health check run', 'integration.settings': 'Integration settings changed',
  'pending.cancel': 'Reserved enrollment cancelled', 'pending.regenerate': 'New claim code generated',
  'problem.create': 'Problem added', 'problem.update': 'Problem updated', 'report.export': 'Report exported', 'settings.scoring': 'Scoring changed',
  'student.leetcode.data_deleted': 'Student deleted LeetCode data', 'student.leetcode.revoke': 'LeetCode connection revoked',
  'student.leetcode.unlink': 'Student disconnected LeetCode', 'student.leetcode.username_corrected': 'LeetCode username corrected',
  'student.leetcode.link': 'Student connected LeetCode', 'student.profile.update': 'Student profile updated', 'student.register': 'Student registered',
  'student.status': 'Student account status changed',
  'trainer.permissions': 'Trainer permissions updated', 'trainer.suspend': 'Trainer suspended', 'trainer.reactivate': 'Trainer reactivated',
  'trainer_request.submit': 'Trainer access requested', 'trainer_request.approve': 'Trainer request approved', 'trainer_request.reject': 'Trainer request rejected',
};
export const auditLabel = (action: string) => AUDIT[action] ?? humanize(action);
/** Groups for the audit filter (action prefixes the backend supports). */
export const AUDIT_GROUPS = [
  { value: 'auth.', label: 'Sign-ins' }, { value: 'trainer', label: 'Trainers' }, { value: 'student.', label: 'Students' },
  { value: 'enrollment.', label: 'Enrollment' }, { value: 'batch.', label: 'Batches' }, { value: 'course.', label: 'Courses' },
  { value: 'chapter.', label: 'Chapters' }, { value: 'problem.', label: 'Problems' }, { value: 'catalog.', label: 'Problem library' },
  { value: 'college.', label: 'Colleges' }, { value: 'settings.', label: 'Scoring' }, { value: 'integration.', label: 'Integrations' },
  { value: 'report.', label: 'Reports' }, { value: 'pending.', label: 'Reserved enrollments' },
];
