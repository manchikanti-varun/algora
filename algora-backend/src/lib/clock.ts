/**
 * Database-side time. MongoDB's `$$NOW` is authoritative in production (instance clock skew cannot stretch a lease or a rate
 * limit). Simulated-time tests and load simulations, which move the process clock, switch to the process clock instead.
 * Refused in production.
 */
let simulated = false;
export function useSimulatedDbClock(on: boolean) {
  if (on && process.env.NODE_ENV === 'production') throw new Error('simulated clock is not allowed in production');
  simulated = on;
}
export const dbNow = (): Date | '$$NOW' => (simulated ? new Date() : '$$NOW');
