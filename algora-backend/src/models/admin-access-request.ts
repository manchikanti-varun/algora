import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { requestStatuses } from '../administration/contracts.js';
const schema = new Schema(
  {
    requesterUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    fullName: { type: String, required: true, maxlength: 160 },
    email: { type: String, required: true, immutable: true },
    requestedCollegeIds: [
      { type: Schema.Types.ObjectId, ref: 'College', required: true },
    ],
    reason: { type: String, required: true, maxlength: 2000 },
    status: {
      type: String,
      enum: requestStatuses,
      default: 'PENDING',
      required: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: { type: String, default: '', maxlength: 1000 },
    internalNote: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
schema.index(
  { requesterUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);
schema.index({ status: 1, createdAt: -1 });
schema.index({ requesterUserId: 1, createdAt: -1 });
export const AdminAccessRequest = model('AdminAccessRequest', schema);
export type RequestDocument = HydratedDocument<InferSchemaType<typeof schema>>;
