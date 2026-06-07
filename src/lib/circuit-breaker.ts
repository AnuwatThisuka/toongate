// Module-level state — shared within a single Worker isolate lifetime.
// Resets on isolate recycle; sufficient for a soft circuit breaker.

const WINDOW = 20;
const DEFAULT_ERROR_THRESHOLD = 0.5;
const DEFAULT_RECOVERY_MS = 30_000;

const outcomes: boolean[] = []; // true = success
let trippedAt: number | null = null;

export function recordOutcome(success: boolean): void {
  outcomes.push(success);
  if (outcomes.length > WINDOW) outcomes.shift();

  if (trippedAt !== null) return;

  if (outcomes.length >= WINDOW) {
    const errors = outcomes.filter((o) => !o).length;
    if (errors / outcomes.length > DEFAULT_ERROR_THRESHOLD) {
      trippedAt = Date.now();
    }
  }
}

export function isCircuitOpen(recoveryMs = DEFAULT_RECOVERY_MS): boolean {
  if (trippedAt === null) return false;
  if (Date.now() - trippedAt > recoveryMs) {
    trippedAt = null;
    outcomes.length = 0;
    return false;
  }
  return true;
}

export function circuitStats(): { window: number; errors: number; tripped: boolean } {
  const errors = outcomes.filter((o) => !o).length;
  return { window: outcomes.length, errors, tripped: trippedAt !== null };
}
