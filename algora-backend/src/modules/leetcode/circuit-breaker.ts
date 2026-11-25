/**
 * Pure circuit-breaker logic over persisted state (see provider-health.service.ts). Kept free of I/O for unit tests.
 * CLOSED -> (threshold consecutive failures) -> OPEN -> (pause elapsed) -> HALF_OPEN (one probe at a time) -> CLOSED | OPEN (longer pause).
 */
export interface BreakerState { consecutiveFailures: number; openedAt?: Date | null; openCount: number; probeUntil?: Date | null }
export interface BreakerConfig { threshold: number; baseOpenMs: number; maxOpenMs: number }

export const pauseMs = (s: BreakerState, c: BreakerConfig) => Math.min(c.maxOpenMs, c.baseOpenMs * 2 ** Math.max(0, s.openCount - 1));

export function breakerState(s: BreakerState, c: BreakerConfig, now = Date.now()): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
  if (!s.openedAt) return 'CLOSED';
  return now - s.openedAt.getTime() >= pauseMs(s, c) ? 'HALF_OPEN' : 'OPEN';
}

/** When the breaker will next allow a probe (null when closed). */
export const nextProbeAt = (s: BreakerState, c: BreakerConfig) => (s.openedAt ? new Date(s.openedAt.getTime() + pauseMs(s, c)) : null);

/** Should a failure (open) the breaker? A failed half-open probe always re-opens. */
export const shouldOpen = (s: BreakerState, c: BreakerConfig, now = Date.now()) =>
  breakerState(s, c, now) === 'HALF_OPEN' || s.consecutiveFailures + 1 >= c.threshold;
