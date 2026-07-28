import { shortId } from '#domains/core/utils/id.mjs';

/**
 * Attempt event factory — the only clock read in the school domain (spec §7).
 * Attempts are append-only events; `attributedTo` denormalises the original
 * credited user so a later reassignment (R6.5) stays auditable.
 *
 * `transport` records HOW the answer arrived — `'screen'` by default, `'paper'`
 * when it came off a worksheet or a bubble sheet. It is the one additive field
 * the physical console needed (spec §7.1): paper and screen run through the same
 * grading engine and produce the same attempt, so the only honest difference is
 * provenance. Nothing scores differently because of it.
 */
export function createAttempt({ sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo, transport = 'screen' }) {
  return {
    id: `att_${shortId(8)}`,
    at: new Date().toISOString(),
    sessionId, bankId, itemId, itemType, mode,
    given, correct, attributedTo, transport,
  };
}
