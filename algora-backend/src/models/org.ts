import { Schema, model, Types } from 'mongoose';

const oid = (ref: string, required = true) => ({ type: Types.ObjectId, ref, required });

export const College = model(
  'College',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      nameKey: { type: String, required: true, unique: true },
      status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
    },
    { timestamps: true },
  ),
  'colleges',
);

export const TrainerRequest = model(
  'TrainerRequest',
  new Schema(
    {
      googleSub: { type: String, required: true, unique: true },
      email: { type: String, required: true, lowercase: true, index: true },
      fullName: { type: String, required: true, trim: true },
      phone: String,
      college: String,
      note: { type: String, maxlength: 1000 },
      status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'], default: 'PENDING_APPROVAL' },
      reviewedBy: oid('User', false),
      reviewedAt: Date,
      rejectionReason: String,
      userId: oid('User', false),
    },
    { timestamps: true },
  ),
  'trainer_requests',
);

const batchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    collegeId: oid('College', false),
    startDate: Date,
    endDate: Date,
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED'], default: 'DRAFT' },
    createdBy: oid('User'),
  },
  { timestamps: true },
);
batchSchema.index({ status: 1, createdAt: -1 });
batchSchema.index({ collegeId: 1 });
export const Batch = model('Batch', batchSchema, 'batches');

const tbaSchema = new Schema(
  {
    trainerId: oid('User'),
    batchId: oid('Batch'),
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
    assignedBy: oid('User'),
  },
  { timestamps: true },
);
tbaSchema.index({ trainerId: 1, batchId: 1 }, { unique: true });
tbaSchema.index({ batchId: 1 });
export const TrainerBatchAssignment = model('TrainerBatchAssignment', tbaSchema, 'trainer_batch_assignments');

const enrollmentSchema = new Schema({
  studentId: oid('User'),
  batchId: oid('Batch'),
  status: { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' },
  enrolledAt: { type: Date, default: Date.now },
  enrolledBy: oid('User', false),
  removedAt: Date,
});
enrollmentSchema.index({ studentId: 1, batchId: 1 }, { unique: true });
enrollmentSchema.index({ batchId: 1, status: 1 });
export const Enrollment = model('Enrollment', enrollmentSchema, 'enrollments');

const pendingSchema = new Schema(
  {
    batchId: oid('Batch'),
    rollNumber: { type: String, required: true, match: /^[A-Z0-9]{10}$/ },
    /** If set, only a Google account with this verified email can claim. */
    email: { type: String, lowercase: true, trim: true },
    /** Hash of a one-time claim code handed to the student by the trainer. */
    claimCodeHash: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'CLAIMED', 'CANCELLED'], default: 'PENDING' },
    createdBy: oid('User'),
    claimedBy: oid('User', false),
    claimedAt: Date,
  },
  { timestamps: true },
);
pendingSchema.index(
  { batchId: 1, rollNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
pendingSchema.index({ rollNumber: 1, status: 1 });
export const PendingEnrollment = model('PendingEnrollment', pendingSchema, 'pending_enrollments');
