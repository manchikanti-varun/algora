import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { accountStatuses, registrationStatuses, roles } from '../auth/types.js';
const userSchema = new Schema(
  {
    googleSubject: { type: String, required: true, immutable: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, required: true },
    displayName: { type: String, required: true, maxlength: 160 },
    avatarUrl: { type: String, maxlength: 2048 },
    role: { type: String, enum: roles, default: 'STUDENT', required: true },
    username: {
      type: String,
      immutable: true,
      lowercase: true,
      match: /^(?:(?:sa|ad)-[a-z]+|[a-z0-9]+-[a-z]+(?:-[a-z]+)+)$/,
      maxlength: 80,
    },
    accountStatus: {
      type: String,
      enum: accountStatuses,
      default: 'PENDING',
      required: true,
    },
    registrationStatus: {
      type: String,
      enum: registrationStatuses,
      default: 'NOT_STARTED',
      required: true,
    },
    sessionVersion: { type: Number, default: 0, required: true, min: 0 },
    lastLoginAt: { type: Date, required: true },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
userSchema.index({ googleSubject: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
export const User = model('User', userSchema);
export type UserDocument = HydratedDocument<InferSchemaType<typeof userSchema>>;
