import { Schema, model, Types } from 'mongoose';

const oid = (ref: string, required = true) => ({ type: Types.ObjectId, ref, required });

export const SESSION_TYPES = ['MORNING', 'AFTERNOON'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_STATUSES = ['DRAFT', 'FINALIZED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const MARKING_SOURCES = ['CSV_SCAN', 'IMPORT_ADD', 'IMPORT_REPLACE', 'MANUAL_CORRECTION'] as const;

/**
 * One attendance session per (batch, calendar date, session type). `attendanceDate` is a plain calendar date string
 * (`YYYY-MM-DD`) so a timezone conversion can never move a session to another day. `attendanceTime` is the local wall
 * time recorded by the staff member (`HH:mm`) in the session `timezone`.
 *
 * The eligible roster is snapshotted on the session so historical attendance never changes when students enrol, leave,
 * transfer or correct a roll number. Only finalized sessions are written to `attendance_records`.
 */
const rosterEntry = new Schema(
  {
    studentId: { type: Types.ObjectId, ref: 'User', required: true },
    /** Historical snapshot: a later approved roll-number or name correction must not rewrite past attendance. */
    rollNumber: { type: String, required: true },
    name: String,
    collegeId: { type: Types.ObjectId, ref: 'College' },
    collegeName: String,
  },
  { _id: false },
);

const sessionSchema = new Schema(
  {
    batchId: oid('Batch'),
    batchName: String,
    attendanceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    sessionType: { type: String, enum: SESSION_TYPES, required: true },
    attendanceTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    timezone: { type: String, default: 'Asia/Kolkata' },
    status: { type: String, enum: SESSION_STATUSES, required: true, default: 'DRAFT' },
    /** True while the session owns the (batch, date, type) slot; cleared on cancellation so a replacement can be recorded. */
    isActive: { type: Boolean, default: true },
    eligibleCount: { type: Number, default: 0 },
    presentCount: { type: Number, default: 0 },
    absentCount: { type: Number, default: 0 },
    roster: { type: [rosterEntry], default: [] },
    uploadSummary: Schema.Types.Mixed,
    notes: { type: String, maxlength: 1000 },
    createdBy: oid('User'),
    finalizedBy: oid('User', false),
    finalizedAt: Date,
    cancelledBy: oid('User', false),
    cancelledAt: Date,
    cancellationReason: String,
    /** Incremented on every correction; used for optimistic concurrency between staff members. */
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);
// At most ONE live session per batch + date + type. Cancelled sessions release the slot.
sessionSchema.index(
  { batchId: 1, attendanceDate: 1, sessionType: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'one_active_session_per_slot' },
);
sessionSchema.index({ batchId: 1, attendanceDate: -1, sessionType: 1 });
sessionSchema.index({ batchId: 1, status: 1, attendanceDate: -1 });
sessionSchema.index({ status: 1, attendanceDate: -1 });
sessionSchema.index({ attendanceDate: -1, sessionType: 1 });
sessionSchema.index({ createdBy: 1, createdAt: -1 });
export const AttendanceSession = model('AttendanceSession', sessionSchema, 'attendance_sessions');

const correctionSchema = new Schema(
  {
    from: String,
    to: String,
    fromScanAt: Date,
    toScanAt: Date,
    by: { type: Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    reason: String,
    source: String,
  },
  { _id: false },
);

/**
 * Individual student attendance. Only finalized sessions have records, so drafts are never counted. Records carry the
 * batch, date, session type and session status so history and analytics never need to re-derive eligibility.
 * Roll number and college are historical snapshots; the stable `studentId` is always the link.
 */
const recordSchema = new Schema(
  {
    sessionId: oid('AttendanceSession'),
    studentId: oid('User'),
    batchId: oid('Batch'),
    enrollmentId: oid('Enrollment', false),
    rollNumber: { type: String, required: true },
    studentName: String,
    collegeId: oid('College', false),
    collegeName: String,
    attendanceDate: { type: String, required: true },
    sessionType: { type: String, enum: SESSION_TYPES, required: true },
    sessionStatus: { type: String, enum: SESSION_STATUSES, required: true, default: 'FINALIZED' },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    scanAt: Date,
    markingSource: { type: String, enum: MARKING_SOURCES, default: 'CSV_SCAN' },
    recordedBy: oid('User', false),
    correctedBy: oid('User', false),
    correctedAt: Date,
    correctionReason: String,
    corrections: { type: [correctionSchema], default: [] },
  },
  { timestamps: true },
);
recordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });
recordSchema.index({ sessionId: 1, status: 1 });
recordSchema.index({ studentId: 1, sessionStatus: 1, attendanceDate: -1 });
recordSchema.index({ studentId: 1, attendanceDate: -1 });
recordSchema.index({ batchId: 1, attendanceDate: -1, sessionType: 1 });
recordSchema.index({ batchId: 1, sessionStatus: 1, attendanceDate: -1 });
recordSchema.index({ collegeId: 1, sessionStatus: 1, attendanceDate: -1 });
export const AttendanceRecord = model('AttendanceRecord', recordSchema, 'attendance_records');
