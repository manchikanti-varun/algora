import { Schema, model } from 'mongoose';

/** Singleton key/value settings. Currently: scoring weights (Super Admin only). */
export const Setting = model(
  'Setting',
  new Schema({ _id: String, value: Schema.Types.Mixed, updatedBy: Schema.Types.ObjectId }, { timestamps: true }),
  'settings',
);
