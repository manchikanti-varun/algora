import { z } from 'zod';
import { idSchema, type Page } from '../administration/contracts.js';
import { text, type CurriculumUnit } from '../curriculum/contracts.js';
import type {
  Credential,
  StudentProfileRecord,
} from '../students/contracts.js';
import type { EnrollmentRecord } from '../learning/contracts.js';
export const sessionTypes = ['MORNING', 'AFTERNOON'] as const;
export const sessionStatuses = [
  'DRAFT',
  'OPEN',
  'CLOSED',
  'FINALIZED',
] as const;
export const recordStatuses = ['PRESENT', 'ABSENT', 'EXCUSED'] as const;
export const MAX_ROSTER = 2000,
  MAX_REPORT_ROWS = 10000,
  MAX_REPORT_SESSIONS = 1000;
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    search: text(0, 100).default(''),
    dayId: idSchema.optional(),
    sessionType: z.enum(sessionTypes).optional(),
    status: z.enum(sessionStatuses).optional(),
    recordStatus: z.enum([...recordStatuses, 'UNMARKED']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    studentProfileId: idSchema.optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to),
    'Invalid date range',
  );
export type List = z.infer<typeof listSchema>;
export const createSchema = z
  .object({ learningDayId: idSchema, sessionType: z.enum(sessionTypes) })
  .strict();
export const transitionSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
    reason: text(15, 1000),
  })
  .strict();
export const refreshSchema = transitionSchema.extend({
  impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export const scanSchema = z
  .object({ credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const correctionSchema = transitionSchema.extend({
  status: z.enum(recordStatuses),
  expectedRecordRevision: z.number().int().nonnegative(),
});
export const exportSchema = z
  .object({
    format: z.enum(['CSV', 'XLSX']),
    scope: z.enum(['SESSION', 'BATCH', 'STUDENT']),
    sessionId: idSchema.optional(),
    studentProfileId: idSchema.optional(),
    filters: listSchema.default(() => listSchema.parse({})),
    confirmed: z.literal(true),
  })
  .strict()
  .refine((v) => v.scope !== 'SESSION' || !!v.sessionId, 'Select a session')
  .refine(
    (v) => v.scope !== 'STUDENT' || !!v.studentProfileId,
    'Select a student',
  );
export interface SessionRecord {
  id: string;
  collegeId: string;
  courseId: string;
  batchId: string;
  curriculumRevisionId: string;
  learningDayId: string;
  dayNumber: number;
  dayTitle: string;
  batchName: string;
  collegeName: string;
  courseTitle: string;
  sessionType: (typeof sessionTypes)[number];
  status: (typeof sessionStatuses)[number];
  revision: number;
  rosterCount: number;
  createdBy: string;
  openedBy?: string;
  openedAt?: string;
  closedBy?: string;
  closedAt?: string;
  finalizedBy?: string;
  finalizedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface RosterRow {
  id: string;
  attendanceSessionId: string;
  enrollmentId: string;
  studentProfileId: string;
  rollNumberSnapshot: string;
  studentNameSnapshot: string;
  eligibilityAtOpen: true;
  createdAt: string;
}
export interface AttendanceRow {
  id: string;
  attendanceSessionId: string;
  batchId: string;
  studentProfileId: string;
  enrollmentId: string;
  rollNumberSnapshot: string;
  status: (typeof recordStatuses)[number];
  source: 'QR_SCAN' | 'FINALIZATION' | 'ADMIN_CORRECTION';
  markedBy: string;
  markedAt: string;
  updatedBy: string;
  revision: number;
  updatedAt: string;
}
export interface History {
  id: string;
  attendanceSessionId: string;
  attendanceRecordId?: string;
  studentProfileId?: string;
  previousStatus?: string;
  newStatus: string;
  action: string;
  actorUserId: string;
  actorName: string;
  reason: string;
  createdAt: string;
}
export interface Candidate {
  profile: StudentProfileRecord;
  enrollment: EnrollmentRecord;
}
export interface AttendanceUnit {
  ownBatches(
    profile: string,
    o: List,
  ): Promise<
    Page<{ id: string; name: string; college: string; course: string }>
  >;
  curriculum: CurriculumUnit;
  sessions(batch: string, o: List): Promise<Page<SessionRecord>>;
  session(id: string): Promise<SessionRecord | null>;
  insertSession(
    d: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SessionRecord>;
  changeSession(
    id: string,
    expected: number,
    status: SessionRecord['status'],
    patch: Partial<SessionRecord>,
  ): Promise<SessionRecord | null>;
  lockSession(
    id: string,
    expected: number,
    status: SessionRecord['status'],
  ): Promise<boolean>;
  roster(id: string): Promise<RosterRow[]>;
  addRoster(rows: Omit<RosterRow, 'id' | 'createdAt'>[]): Promise<void>;
  records(id: string): Promise<AttendanceRow[]>;
  record(id: string): Promise<AttendanceRow | null>;
  ownRecord(session: string, profile: string): Promise<AttendanceRow | null>;
  insertRecord(
    d: Omit<AttendanceRow, 'id' | 'updatedAt'>,
  ): Promise<AttendanceRow>;
  updateRecord(
    id: string,
    expected: number,
    patch: Pick<AttendanceRow, 'status' | 'source' | 'updatedBy'>,
  ): Promise<AttendanceRow | null>;
  history(id: string, o: List): Promise<Page<History>>;
  addHistory(d: Omit<History, 'id' | 'createdAt'>): Promise<void>;
  candidates(batch: string): Promise<Candidate[]>;
  credentialByHash(
    hash: string,
  ): Promise<Pick<Credential, 'profileId' | 'version' | 'tokenHash'> | null>;
  lockIdentity(
    p: StudentProfileRecord,
    e: EnrollmentRecord,
    hash?: string,
  ): Promise<boolean>;
  reportSessions(batch: string, o: List): Promise<SessionRecord[]>;
  ownSessions(
    batch: string,
    profile: string,
    o: List,
  ): Promise<Page<SessionRecord>>;
}
export interface AttendanceRepository {
  ensureReady(): Promise<void>;
  read: AttendanceUnit;
  transaction<T>(work: (tx: AttendanceUnit) => Promise<T>): Promise<T>;
}

export interface ReportRow {
  sessionId: string;
  studentProfileId: string;
  rollNumber: string;
  studentName: string;
  college: string;
  course: string;
  batch: string;
  dayNumber: number;
  dayTitle: string;
  sessionType: string;
  sessionStatus: string;
  status: string;
  markedAt: string | null;
  finalizedAt: string | null;
  official: boolean;
}
