/**
 * Concept mastery facet: how a learner is doing on the discrete concepts
 * question-bank items bind (`learning.conceptIds`, spec's `attemptEvidence.mjs`
 * shape) — independent of unit/course grading, which rolls up whole sessions
 * rather than the specific ideas an item exercises.
 *
 * Pure aggregation over already-produced `school.learning-evidence/v1`
 * entries. No clock, no I/O, no imports at all — `now` is a required
 * argument rather than a default `Date.now()` read, so this stays a plain
 * function of its inputs.
 *
 * A concept id is counted the moment graded evidence names it. Whether that
 * id is a REGISTERED concept (has a friendly label) is an adapter/
 * application concern this module never touches — an unregistered id still
 * earns a full mastery row here, just without a label attached later.
 */

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const DAY_MS = 86_400_000;

/**
 * @param {Array<object>} entries - `school.learning-evidence/v1` entries
 * @param {object} options
 * @param {number} [options.windowDays=90] - rolling window size (days) ending at `now`
 * @param {number} [options.threshold=0.8] - minimum correct ratio to count as mastered
 * @param {number} [options.minResponses=5] - minimum graded responses before mastery can be claimed
 * @param {string} options.now - canonical ISO-8601 timestamp anchoring the window; required (never the wall clock)
 * @returns {Array<{conceptId: string, responses: number, correct: number, ratio: number, mastered: boolean}>}
 *   weakest-first: lowest ratio first, ties broken by more responses first, then conceptId
 */
export function conceptMastery(entries, {
  windowDays = 90, threshold = 0.8, minResponses = 5, now,
} = {}) {
  if (!Array.isArray(entries)) throw new TypeError('conceptMastery requires an entries array');
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new TypeError('conceptMastery windowDays must be a positive number');
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new TypeError('conceptMastery threshold must be a number between 0 and 1');
  }
  if (!Number.isInteger(minResponses) || minResponses < 1) {
    throw new TypeError('conceptMastery minResponses must be a positive integer');
  }
  const nowMs = typeof now === 'string' ? Date.parse(now) : NaN;
  if (!Number.isFinite(nowMs)) throw new TypeError('conceptMastery requires a valid now timestamp');
  const fromMs = nowMs - (windowDays * DAY_MS);

  const totals = new Map();
  entries.forEach((entry) => {
    if (!entry || entry.activity?.graded !== true) return;
    const occurredMs = Date.parse(entry.occurredAt);
    // Half-open window: strictly after `fromMs`, at or before `nowMs` — the
    // same "recent N days ending now" boundary a rolling report reads.
    if (!Number.isFinite(occurredMs) || occurredMs <= fromMs || occurredMs > nowMs) return;
    const responses = entry.measures?.responses ?? 0;
    const correct = entry.measures?.correct ?? 0;
    if (responses <= 0) return;
    const conceptIds = Array.isArray(entry.learning?.conceptIds) ? entry.learning.conceptIds : [];
    conceptIds.filter(isNonEmptyString).forEach((conceptId) => {
      const bucket = totals.get(conceptId) ?? { conceptId, responses: 0, correct: 0 };
      bucket.responses += responses;
      bucket.correct += correct;
      totals.set(conceptId, bucket);
    });
  });

  return [...totals.values()]
    .map(({ conceptId, responses, correct }) => {
      const ratio = correct / responses;
      return {
        conceptId,
        responses,
        correct,
        ratio,
        mastered: responses >= minResponses && ratio >= threshold,
      };
    })
    .sort((a, b) => a.ratio - b.ratio || b.responses - a.responses || a.conceptId.localeCompare(b.conceptId));
}

export default conceptMastery;
