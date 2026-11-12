import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    profileId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentProfile',
      required: true,
      immutable: true,
    },
    version: { type: Number, required: true, min: 1 },
    tokenHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    tag: { type: String, required: true },
    keyId: { type: String, required: true },
  },
  { timestamps: true, strict: 'throw', autoIndex: false },
);
schema.index({ profileId: 1 }, { unique: true });
schema.index({ tokenHash: 1 }, { unique: true });
export const StudentQrCredential = model('StudentQrCredential', schema);
