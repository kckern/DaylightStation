import { shortId } from '#domains/core/utils/id.mjs';
import { normalizeLearningContext } from './progress/learningProgress.mjs';

/**
 * Attempt event factory. The application supplies the event timestamp so the
 * pure domain does not read a wall clock and offline imports can use the
 * backend's first-observed time consistently across retries.
 * Attempts are append-only events; `attributedTo` denormalises the original
 * credited user so a later reassignment (R6.5) stays auditable.
 *
 * `transport` records HOW the answer arrived — `'screen'` by default, `'paper'`
 * when it came off a worksheet or a bubble sheet. It is the one additive field
 * the physical console needed (spec §7.1): paper and screen run through the same
 * grading engine and produce the same attempt, so the only honest difference is
 * provenance. Nothing scores differently because of it.
 */
export function createAttempt({ at, sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo, transport = 'screen', provenance = null, learning = null, bankRev = null }) {
  if (!isCanonicalTimestamp(at)) {
    throw new TypeError('Attempt at must be a canonical ISO-8601 timestamp');
  }
  const normalized = normalizeLearningContext(learning, { path: 'attempt.learning' });
  if (normalized.errors.length) throw new TypeError(normalized.errors.join('; '));
  return {
    id: `att_${shortId(8)}`,
    at,
    sessionId, bankId, itemId, itemType, mode,
    given, correct, attributedTo, transport,
    learning: normalized.learning,
    ...(provenance ? { provenance } : {}),
    // The screen path's content rev (admin advocacy A3): which VERSION of the
    // bank this answer was graded against — the print path's rev discipline,
    // applied here. Null on legacy attempts; never affects scoring.
    ...(bankRev ? { bankRev } : {}),
  };
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

/**
 * A regrade CORRECTION is a verdict amendment, not new work (admin advocacy
 * M8 fix 1): counting it alongside its original inflates attempt counts,
 * shifts accuracy by phantom rows, and fabricates active days at the regrade
 * timestamp. Aggregations that count work filter with this; the corrected
 * VERDICT still reaches consumers that resolve per-item truth by reading the
 * correction's `provenance.of` chain.
 */
export function isRegradeCorrection(attempt) {
  return attempt?.provenance?.kind === 'regrade';
}
