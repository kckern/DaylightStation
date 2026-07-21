import { shortId } from '#domains/core/utils/id.mjs';

/**
 * Attempt event factory — the only clock read in the school domain (spec §7).
 * Attempts are append-only events; `attributedTo` denormalises the original
 * credited user so a later reassignment (R6.5) stays auditable.
 */
export function createAttempt({ sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo }) {
  return {
    id: `att_${shortId(8)}`,
    at: new Date().toISOString(),
    sessionId, bankId, itemId, itemType, mode,
    given, correct, attributedTo,
  };
}
