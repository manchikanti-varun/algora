import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { auditActions, permissions } from '../administration/contracts.js';
const metadata = new Schema(
  {
    before: { type: String, maxlength: 1000 },
    after: { type: String, maxlength: 1000 },
    count: Number,
    permissions: {
      type: [{ type: String, enum: permissions }],
      default: undefined,
    },
    previousPermissions: {
      type: [{ type: String, enum: permissions }],
      default: undefined,
    },
  },
  { _id: false, strict: 'throw' },
);
const schema = new Schema(
  {
    actorUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    actorName: {
      type: String,
      required: true,
      maxlength: 160,
      immutable: true,
    },
    action: {
      type: String,
      enum: auditActions,
      required: true,
      immutable: true,
    },
    targetType: {
      type: String,
      enum: ['USER', 'COLLEGE', 'ADMIN_REQUEST', 'ASSIGNMENT'],
      required: true,
      immutable: true,
    },
    targetId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    collegeId: { type: Schema.Types.ObjectId, ref: 'College', immutable: true },
    metadata: { type: metadata, default: {}, immutable: true },
    requestId: { type: String, required: true, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { strict: 'throw', autoIndex: false },
);
schema.index({ createdAt: -1 });
schema.index({ action: 1, createdAt: -1 });
schema.index({ collegeId: 1, createdAt: -1 });
schema.index({ actorUserId: 1, createdAt: -1 });
// Audit append-only is enforced by repository/API capabilities; no update/delete route exists.
export const AuditLog = model('AuditLog', schema);
export type AuditDocument = HydratedDocument<InferSchemaType<typeof schema>>;
