import { Schema, model } from 'mongoose';
import {
  courseStatuses,
  batchStatuses,
  enrollmentStatuses,
  currentStatuses,
  sources,
} from '../learning/contracts.js';
import { reconciliationFields } from '../learning/markers.js';
const ref = (name: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
});
const options = {
  timestamps: true,
  strict: 'throw' as const,
  autoIndex: false,
};
const course = new Schema(
  {
    title: { type: String, required: true, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 100,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 30,
      match: /^[A-Z0-9][A-Z0-9-]+$/,
    },
    description: { type: String, required: true, maxlength: 5000 },
    shortDescription: { type: String, default: '' },
    status: {
      type: String,
      enum: courseStatuses,
      default: 'DRAFT',
      required: true,
    },
    difficulty: {
      type: String,
      enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
      required: true,
    },
    estimatedDurationDays: { type: Number, default: null, min: 1, max: 1000 },
    tags: [String],
    scope: { type: String, enum: ['PLATFORM', 'COLLEGE'], required: true },
    ownerCollegeId: { ...ref('College', false), default: null },
    sharedCollegeIds: [{ type: Schema.Types.ObjectId, ref: 'College' }],
    revision: { type: Number, default: 0 },
    operationalRevision: { type: Number, default: 0 },
    createdBy: ref('User'),
    updatedBy: ref('User'),
    ...reconciliationFields,
  },
  options,
);
course.index({ code: 1 }, { unique: true });
course.index({ slug: 1 }, { unique: true });
course.index({ scope: 1, ownerCollegeId: 1, status: 1 });
course.index({ title: 1, status: 1 });
course.index({ enrollmentReconciliationPending: 1, reconciliationNextAt: 1 });
export const Course = model('Course', course);
const snapshot = new Schema(
  {
    title: String,
    code: String,
    slug: String,
    description: String,
    difficulty: String,
    courseRevision: Number,
  },
  { _id: false, strict: 'throw' },
);
const batch = new Schema(
  {
    courseId: { ...ref('Course'), immutable: true },
    collegeId: { ...ref('College'), immutable: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: batchStatuses,
      default: 'DRAFT',
      required: true,
    },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    capacity: { type: Number, default: null, min: 1, max: 10000 },
    enrollmentPolicy: {
      type: String,
      enum: ['ADMIN_ROLL_ONLY'],
      required: true,
    },
    snapshot: { type: snapshot, required: true },
    seatCount: { type: Number, required: true, default: 0, min: 0 },
    revision: { type: Number, default: 0 },
    operationalRevision: { type: Number, default: 0 },
    createdBy: ref('User'),
    updatedBy: ref('User'),
    ...reconciliationFields,
  },
  options,
);
batch.index({ collegeId: 1, code: 1 }, { unique: true });
batch.index({ collegeId: 1, status: 1 });
batch.index({ courseId: 1, status: 1 });
batch.index({ startDate: 1 });
batch.index({ enrollmentReconciliationPending: 1, reconciliationNextAt: 1 });
export const Batch = model('Batch', batch);
const enrollment = new Schema(
  {
    batchId: { ...ref('Batch'), immutable: true },
    collegeId: { ...ref('College'), immutable: true },
    rollNumber: {
      type: String,
      required: true,
      immutable: true,
      match: /^[A-Z0-9]{10}$/,
    },
    studentProfileId: ref('StudentProfile', false),
    status: { type: String, enum: enrollmentStatuses, required: true },
    source: { type: String, enum: sources, required: true, immutable: true },
    reason: { type: String, default: '', maxlength: 1000 },
    createdBy: ref('User'),
    activatedAt: String,
    withdrawnAt: String,
    transferredFrom: ref('BatchEnrollment', false),
    transferredTo: ref('BatchEnrollment', false),
    revision: { type: Number, required: true, default: 0 },
  },
  options,
);
enrollment.index(
  { batchId: 1, rollNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: currentStatuses } },
  },
);
enrollment.index(
  { batchId: 1, studentProfileId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: currentStatuses },
      studentProfileId: { $type: 'objectId' },
    },
  },
);
enrollment.index({ batchId: 1, status: 1 });
enrollment.index({ studentProfileId: 1, status: 1 });
enrollment.index({ collegeId: 1, status: 1 });
enrollment.index({ rollNumber: 1, status: 1 });
export const BatchEnrollment = model('BatchEnrollment', enrollment);
const history = new Schema(
  {
    enrollmentId: { ...ref('BatchEnrollment'), immutable: true },
    batchId: { ...ref('Batch'), immutable: true },
    collegeId: { ...ref('College'), immutable: true },
    actorUserId: { ...ref('User'), immutable: true },
    action: { type: String, required: true, immutable: true },
    before: { type: String, immutable: true },
    after: { type: String, required: true, immutable: true },
    reason: { type: String, maxlength: 1000, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
history.index({ enrollmentId: 1, createdAt: -1 });
history.index({ batchId: 1, createdAt: -1 });
history.index({ actorUserId: 1, createdAt: -1 });
export const EnrollmentHistory = model('EnrollmentHistory', history);
const row = new Schema(
  { row: Number, value: String, error: String },
  { _id: false },
);
const result = new Schema(
  {
    row: Number,
    rollNumber: String,
    outcome: String,
    status: String,
    reason: String,
  },
  { _id: false },
);
const operation = new Schema(
  {
    actorUserId: ref('User'),
    batchId: ref('Batch'),
    tokenHash: { type: String, required: true },
    requestKey: { type: String, required: true },
    source: { type: String, enum: sources, required: true },
    rows: [row],
    warnings: [String],
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['PREVIEW', 'COMPLETED'], required: true },
    results: [result],
  },
  options,
);
operation.index({ tokenHash: 1 }, { unique: true });
operation.index(
  { actorUserId: 1, batchId: 1, requestKey: 1 },
  { unique: true },
);
operation.index({ batchId: 1, status: 1, createdAt: -1 });
export const EnrollmentImport = model('EnrollmentImport', operation);
