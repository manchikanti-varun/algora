import { reconciliationFields } from '../learning/markers.js';
import { Schema, model } from 'mongoose';
import { verificationStatuses } from '../students/contracts.js';
const schema = new Schema(
  {
    ...reconciliationFields,
    attendanceRevision: { type: Number, default: 0 },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    fullName: { type: String, required: true, maxlength: 120 },
    rollNumber: { type: String, required: true, match: /^[A-Z0-9]{10}$/ },
    studentUsername: {
      type: String,
      required: true,
      immutable: true,
      match: /^[a-z0-9]{10}-[a-z0-9]+(?:-[a-z0-9]+)*$/,
      maxlength: 80,
    },
    phoneNumber: { type: String, required: true, match: /^\+[1-9]\d{6,14}$/ },
    collegeId: { type: Schema.Types.ObjectId, ref: 'College', required: true },
    department: { type: String, required: true, maxlength: 80 },
    yearOfStudy: { type: Number, min: 1, max: 4, validate: Number.isInteger },
    leetCodeUsername: { type: String, required: true },
    codeforcesUsername: { type: String, required: true },
    codechefUsername: { type: String, required: true },
    verificationStatus: {
      type: String,
      enum: verificationStatuses,
      required: true,
      default: 'PENDING_VERIFICATION',
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    verificationMethod: { type: String, enum: ['AUTHORIZED_MANUAL'] },
    verificationEvidence: { type: String, maxlength: 1000 },
    verificationNote: { type: String, maxlength: 1000 },
    qrCredentialVersion: { type: Number, required: true, default: 0, min: 0 },
    revision: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
schema.index({ userId: 1 }, { unique: true });
schema.index({ rollNumber: 1 }, { unique: true });
schema.index({ studentUsername: 1 }, { unique: true });
schema.index({ collegeId: 1, verificationStatus: 1 });
schema.index({ collegeId: 1, rollNumber: 1 });
schema.index({ enrollmentReconciliationPending: 1, reconciliationNextAt: 1 });
export const StudentProfile = model('StudentProfile', schema);
// Permanent reservations retain historical roll numbers after approved corrections.
const reservation = new Schema(
  {
    rollNumber: {
      type: String,
      required: true,
      immutable: true,
      match: /^[A-Z0-9]{10}$/,
    },
    profileId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
reservation.index({ rollNumber: 1 }, { unique: true });
export const StudentRollReservation = model(
  'StudentRollReservation',
  reservation,
);
