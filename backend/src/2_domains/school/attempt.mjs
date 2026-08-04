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
export function createAttempt({ at, sessionId, bankId, itemId, itemType, mode, given, correct, attributedTo, transport = 'screen', provenance = null, learning = null }) {
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
  };
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
