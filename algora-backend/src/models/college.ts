import {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
} from 'mongoose';
import { collegeStatuses } from '../administration/contracts.js';
const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 160,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9][A-Z0-9-]{1,19}$/,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      maxlength: 80,
    },
    identityKey: { type: String, required: true },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: '' },
    status: {
      type: String,
      enum: collegeStatuses,
      default: 'ACTIVE',
      required: true,
    },
    revision: { type: Number, default: 0, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
schema.index({ code: 1 }, { unique: true });
schema.index({ slug: 1 }, { unique: true });
schema.index({ identityKey: 1 }, { unique: true });
schema.index({ status: 1, name: 1 });
export const College = model('College', schema);
export type CollegeDocument = HydratedDocument<InferSchemaType<typeof schema>>;
