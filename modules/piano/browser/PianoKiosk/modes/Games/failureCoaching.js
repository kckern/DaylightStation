/**
 * failureCoaching — the one sentence a child gets when a gate attempt does not
 * pass: WHAT went wrong, in words they can act on.
 *
 * The fail panel used to say "Try the exercise again, or leave using the piano
 * keys" and nothing else, which answers "what now" and never "what happened".
 * On 2026-09-13 a nine-year-old met a cued C major scale three times running
 * and scored zero twice: he had played C D E F G, in order, evenly, at the
 * tempo the count-in gave him — the ask was written in eighths and his notes
 * fell in the gaps. The screen could not tell him that, so he tried the same
 * thing again, and then again.
 *
 * NO NUMBER, EVER. That rule is older than this module and holds here:
 * `requirementForLevel` writes `passScore: null` for every level a repertoire
 * can express, so a percentage would be a figure with no bar beside it, shown
 * to a child who is being taught to read music rather than to read statistics.
 * The score still reaches the log, where an adult tuning the ladder reads it.
 *
 * ONE SENTENCE, NOT A REPORT CARD. A failing attempt usually trips several
 * criteria at once — the run above missed completeness, cleanliness AND
 * placement — and listing them is a wall of text at the exact moment somebody
 * is least able to read one. The weakest criterion is the one to work on, and
 * the order below is the order a teacher would fix them in: arrive at all,
 * then arrive on time, then stop adding notes.
 *
 * Pure: no React, no logging, no throwing.
 */

/** Below this a criterion is not "nearly there", it is the thing that went wrong. */
const NEARLY = 0.9;

/**
 * @param {object|null} result the finalized attempt. A STALLED one carries
 *   diagnostics but no criteria at all, which is its own answer.
 * @param {'free'|'cued'|string|null} mode what the ask was judged as. Placement
 *   only exists for a cued ask; naming the beat to a child who was never given
 *   one would be advice about a rule they were not playing under.
 * @returns {string|null} null when nothing can be said honestly — the panel
 *   keeps its standing line rather than inventing a diagnosis.
 */
export function failureAdvice(result, mode = null) {
  const criteria = result?.criteria;
  // No criteria at all is the stall: started, took real notes, then stopped.
  if (!criteria || typeof criteria !== 'object') {
    return result ? 'That one stopped before the end. Play it all the way through.' : null;
  }

  const completeness = Number(criteria.completeness);
  const placement = Number(criteria.placement);
  const cleanliness = Number(criteria.cleanliness);
  const cued = mode === 'cued';

  // NOTHING LANDED AT ALL, on a cued ask. Almost never "they cannot play it" —
  // it is the grid: they played to a pulse that was not the one being graded.
  // This is the case the count-in sentence now exists to prevent, and it is
  // still worth naming when it happens.
  if (cued && Number.isFinite(completeness) && completeness === 0) {
    return 'None of the notes landed in time. Listen to the clicks first, and start on the next one.';
  }
  if (Number.isFinite(completeness) && completeness < NEARLY) {
    return 'Some of the notes did not arrive. Go slower and get every one.';
  }
  if (cued && Number.isFinite(placement) && placement < NEARLY) {
    return 'The right notes, just not on the beat. Stay with the clicks.';
  }
  if (Number.isFinite(cleanliness) && cleanliness < NEARLY) {
    return 'Some extra notes crept in. Lift each finger before the next one.';
  }
  return null;
}

export default failureAdvice;
