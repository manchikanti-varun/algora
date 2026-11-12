import { randomUUID } from 'node:crypto';
export const reconciliationFields = {
  reconciliationToken: { type: String, default: '' },
  enrollmentReconciliationPending: { type: Boolean, default: false },
  reconciliationCursor: { type: String, default: '' },
  reconciliationAttempts: { type: Number, default: 0 },
  reconciliationNextAt: { type: Date, default: () => new Date(0) },
  reconciliationError: { type: String, default: '' },
};
export const reconciliationPending = () => ({
  reconciliationToken: randomUUID(),
  enrollmentReconciliationPending: true,
  reconciliationCursor: '',
  reconciliationAttempts: 0,
  reconciliationNextAt: new Date(0),
  reconciliationError: '',
});
