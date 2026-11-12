import { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    stateHash: { type: String, required: true },
    browserHash: { type: String, required: true },
    verifier: { type: String, required: true },
    nonce: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { strict: 'throw', autoIndex: false },
);
schema.index({ stateHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OAuthState = model('OAuthTransaction', schema);
