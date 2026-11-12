import { Schema, model } from 'mongoose';
const changes = new Schema(
  {
    fullName: String,
    rollNumber: { type: String, match: /^[A-Z0-9]{10}$/ },
    collegeId: { type: Schema.Types.ObjectId, ref: 'College' },
    department: String,
    yearOfStudy: { type: Number, min: 1, max: 4 },
  },
  { _id: false, strict: 'throw' },
);
const schema = new Schema(
  {
    studentProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
      immutable: true,
    },
    requesterUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    sourceCollegeId: {
      type: Schema.Types.ObjectId,
      ref: 'College',
      required: true,
      immutable: true,
    },
    requestedChanges: { type: changes, required: true, immutable: true },
    reason: { type: String, required: true, maxlength: 1000, immutable: true },
    profileRevision: { type: Number, required: true, immutable: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
// A single pending request is stricter than per-field duplication and simplifies safe reviews.
schema.index(
  { studentProfileId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
schema.index({ sourceCollegeId: 1, status: 1, createdAt: -1 });
schema.index({ requesterUserId: 1, createdAt: -1 });
export const StudentProfileCorrectionRequest = model(
  'StudentProfileCorrectionRequest',
  schema,
);
