import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { permissions } from '../administration/contracts.js';
const schema = new Schema(
  {
    adminUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    collegeId: { type: Schema.Types.ObjectId, ref: 'College', required: true },
    permissions: [{ type: String, enum: permissions, required: true }],
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
      required: true,
    },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
schema.index(
  { adminUserId: 1, collegeId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
schema.index({ adminUserId: 1, status: 1 });
export const AdminCollegeAssignment = model('AdminCollegeAssignment', schema);
export type AssignmentDocument = HydratedDocument<
  InferSchemaType<typeof schema>
>;
