import { Schema, model, Types } from 'mongoose';

const changes = new Schema({
  firstName: String, lastName: String, mobile: String, username: String, rollNumber: String, collegeId: String, collegeLabel: String,
}, { _id: false });

const studentRequestSchema = new Schema({
  studentId: { type: Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['PROFILE', 'LEETCODE'], required: true },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], required: true },
  current: { type: changes, required: true },
  requested: { type: changes, required: true },
  previousLinkId: Types.ObjectId,
  linkAction: { type: String, enum: ['LINK', 'UNLINK'] },
  reason: String,
  rejectionReason: String,
  reviewedBy: { type: Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
}, { timestamps: true });

studentRequestSchema.index({ studentId: 1, kind: 1 }, { unique: true, partialFilterExpression: { status: 'PENDING' } });
studentRequestSchema.index({ studentId: 1, createdAt: -1 });
studentRequestSchema.index({ status: 1, createdAt: -1 });
export const StudentRequest = model('StudentRequest', studentRequestSchema, 'student_requests');
