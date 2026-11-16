import { Schema, model } from 'mongoose';
import { AppError } from '../middleware/app-error.js';
import {
  sessionTypes,
  sessionStatuses,
  recordStatuses,
} from '../attendance/contracts.js';
const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
  immutable: true,
});
const options = {
  timestamps: true,
  strict: 'throw' as const,
  autoIndex: false,
};
const session = new Schema(
  {
    collegeId: ref('College'),
    courseId: ref('Course'),
    batchId: ref('Batch'),
    curriculumRevisionId: ref('CurriculumRevision'),
    learningDayId: ref('LearningDay'),
    dayNumber: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
      immutable: true,
    },
    dayTitle: { type: String, required: true, immutable: true },
    batchName: { type: String, required: true, immutable: true },
    collegeName: { type: String, required: true, immutable: true },
    courseTitle: { type: String, required: true, immutable: true },
    sessionType: {
      type: String,
      enum: sessionTypes,
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: sessionStatuses,
      required: true,
      default: 'DRAFT',
    },
    revision: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    operationalRevision: { type: Number, default: 0 },
    rosterCount: { type: Number, default: 0, min: 0 },
    createdBy: ref('User'),
    openedBy: Schema.Types.ObjectId,
    openedAt: Date,
    closedBy: Schema.Types.ObjectId,
    closedAt: Date,
    finalizedBy: Schema.Types.ObjectId,
    finalizedAt: Date,
  },
  options,
);
session.index(
  { batchId: 1, learningDayId: 1, sessionType: 1 },
  { unique: true },
);
session.index({ batchId: 1, status: 1, createdAt: -1 });
session.index({ collegeId: 1, status: 1 });
session.index({ learningDayId: 1, sessionType: 1 });
for (const op of ['updateOne', 'findOneAndUpdate'] as const)
  session.pre(op, function () {
    const f = this.getFilter();
    if (
      !f._id ||
      typeof f.revision !== 'number' ||
      !sessionStatuses.includes(f.status)
    )
      throw new AppError(
        409,
        'GUARDED_WRITE_REQUIRED',
        'Session writes require expected revision and state',
      );
  });
for (const op of [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
  'findOneAndReplace',
  'updateMany',
] as const)
  session.pre(op, function () {
    throw new AppError(
      409,
      'IMMUTABLE_HISTORY',
      'Attendance sessions cannot be removed or replaced',
    );
  });
session.pre('save', function () {
  if (!this.isNew)
    throw new AppError(
      409,
      'GUARDED_WRITE_REQUIRED',
      'Use guarded session transitions',
    );
});
export const AttendanceSession = model('AttendanceSession', session);
function appendOnly(schema: Schema) {
  for (const op of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'replaceOne',
    'findOneAndReplace',
  ] as const)
    schema.pre(op, function () {
      throw new AppError(
        409,
        'IMMUTABLE_HISTORY',
        'Attendance history is append-only',
      );
    });
  schema.pre('save', function () {
    if (!this.isNew)
      throw new AppError(
        409,
        'IMMUTABLE_HISTORY',
        'Attendance history is immutable',
      );
  });
}
const roster = new Schema(
  {
    attendanceSessionId: ref('AttendanceSession'),
    enrollmentId: ref('BatchEnrollment'),
    studentProfileId: ref('StudentProfile'),
    rollNumberSnapshot: { type: String, required: true, immutable: true },
    studentNameSnapshot: { type: String, required: true, immutable: true },
    eligibilityAtOpen: {
      type: Boolean,
      required: true,
      validate: (value: boolean) => value === true,
      immutable: true,
    },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
appendOnly(roster);
roster.index({ attendanceSessionId: 1, studentProfileId: 1 }, { unique: true });
roster.index({ attendanceSessionId: 1, enrollmentId: 1 });
roster.index({ studentProfileId: 1, attendanceSessionId: 1 });
roster.index({ attendanceSessionId: 1, rollNumberSnapshot: 1 });
export const AttendanceRosterSnapshot = model(
  'AttendanceRosterSnapshot',
  roster,
);
const record = new Schema(
  {
    attendanceSessionId: ref('AttendanceSession'),
    batchId: ref('Batch'),
    studentProfileId: ref('StudentProfile'),
    enrollmentId: ref('BatchEnrollment'),
    rollNumberSnapshot: { type: String, required: true, immutable: true },
    status: { type: String, enum: recordStatuses, required: true },
    source: {
      type: String,
      enum: ['QR_SCAN', 'ADMIN_CORRECTION', 'FINALIZATION'],
      required: true,
    },
    markedBy: ref('User'),
    markedAt: { type: Date, required: true, immutable: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revision: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  },
  options,
);
record.index({ attendanceSessionId: 1, studentProfileId: 1 }, { unique: true });
record.index({ attendanceSessionId: 1, status: 1 });
record.index({ studentProfileId: 1, attendanceSessionId: 1 });
record.pre('findOneAndUpdate', async function () {
  const f = this.getFilter();
  if (
    !f._id ||
    typeof f.revision !== 'number' ||
    !f.attendanceSessionId ||
    !(await AttendanceSession.exists({
      _id: f.attendanceSessionId,
      status: 'FINALIZED',
    }).session(this.getOptions().session ?? null))
  )
    throw new AppError(
      409,
      'GUARDED_WRITE_REQUIRED',
      'Corrections require finalized session and record revision',
    );
});
for (const op of [
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'replaceOne',
  'findOneAndReplace',
] as const)
  record.pre(op, function () {
    throw new AppError(
      409,
      'IMMUTABLE_HISTORY',
      'Use audited attendance corrections',
    );
  });
record.pre('save', async function () {
  if (!this.isNew)
    throw new AppError(
      409,
      'GUARDED_WRITE_REQUIRED',
      'Use audited corrections',
    );
  const state =
    this.status === 'PRESENT' && this.source === 'QR_SCAN'
      ? 'OPEN'
      : (this.status === 'ABSENT' && this.source === 'FINALIZATION') ||
          (this.status === 'EXCUSED' && this.source === 'ADMIN_CORRECTION')
        ? 'CLOSED'
        : null;
  if (
    !state ||
    !(await AttendanceSession.exists({
      _id: this.attendanceSessionId,
      status: state,
    }).session(this.$session()))
  )
    throw new AppError(
      409,
      'SESSION_CLOSED',
      'Attendance insert does not match the authorized operation and state',
    );
});
record.pre('insertMany', function () {
  throw new AppError(
    409,
    'GUARDED_WRITE_REQUIRED',
    'Use guarded record creation',
  );
});
roster.pre('insertMany', function () {
  throw new AppError(
    409,
    'GUARDED_WRITE_REQUIRED',
    'Use guarded roster creation',
  );
});
export const AttendanceRecord = model('AttendanceRecord', record);
const history = new Schema(
  {
    attendanceSessionId: ref('AttendanceSession'),
    attendanceRecordId: ref('AttendanceRecord', false),
    studentProfileId: ref('StudentProfile', false),
    previousStatus: { type: String, immutable: true },
    newStatus: { type: String, required: true, immutable: true },
    action: { type: String, required: true, immutable: true },
    actorUserId: ref('User'),
    actorName: {
      type: String,
      required: true,
      maxlength: 160,
      immutable: true,
    },
    reason: { type: String, required: true, maxlength: 1000, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
appendOnly(history);
history.index({ attendanceSessionId: 1, createdAt: -1 });
history.index({ attendanceRecordId: 1, createdAt: -1 });
history.index({ actorUserId: 1, createdAt: -1 });
export const AttendanceHistory = model('AttendanceHistory', history);
