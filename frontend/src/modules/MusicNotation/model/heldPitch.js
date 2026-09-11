/**
 * What a currently-held key MEANS at the cursor — the one rule, shared by every
 * stage that draws live feedback over notation.
 *
 * THE RULE EXISTS BECAUSE THE DISPLAY WAS GRADING ON A SIGNAL THE ENGINE
 * CANNOT SEE. `ExerciseRun` sends the assessor `onsets` and nothing else
 * (`for (const midi of onsets) runtime.observe(...)`); there is no note-off
 * path in `observeAssessment` at all, and a tier 0-2 rubric is
 * `{ completeness: 1 }` — did every asked pitch arrive, in order. Release
 * times, durations and overlap are not observed, not scored, and not
 * representable in the attempt state.
 *
 * The renderers, though, read the live HELD set — which is onsets minus
 * releases — and treated every held pitch that was not a target of the current
 * entry as a wrong note. On a scale that is guaranteed to fire, because a scale
 * is played legato. Production, a clean C major scored 1.0
 * (`piano.exercise-midi-state`, 2026-09-11 21:24):
 *
 *     []          -> [60]          onsets [60]
 *     [60]        -> [60,62]       onsets [62]
 *     [60,62]     -> [60,62,64]    onsets [64]
 *     [60,62,64]  -> [62,64]       releases [60]
 *
 * Three keys down at once, every note correct. But the instant the cursor
 * advanced to 62, the still-held 60 stopped matching the target and was drawn
 * as a mistake — the afterglow of a correct note rendered as an error, one beat
 * late, on every note of a perfect scale. The child was told they were wrong by
 * the only part of the system that had no opinion worth having.
 *
 * So the display's notion of "wrong" is made to match the engine's: an ONSET at
 * this entry that is not what the entry asked for. A key that was already down
 * when the cursor arrived was an answer to an EARLIER entry — the engine
 * already judged it, and judged it correct — and is not being played here at
 * all.
 *
 * If legato ever becomes something we teach, it has to arrive as an explicit
 * criterion with releases actually fed to the assessor. It must never come back
 * as a side effect of what a renderer happens to have in scope.
 *
 * @param {number} midi
 * @param {object} at
 * @param {number|undefined} at.pressedAt - `Date.now()` when the key went down.
 *   `activeNotes` stamps every key with `timestamp` at note-on.
 * @param {number} at.cursorArrivedAt - `Date.now()` when the cursor reached the
 *   current entry. Same clock, so the comparison is direct.
 * @param {Set<number>} at.cursorTargets - the pitches this entry asks for.
 * @returns {'target'|'ghost'|'sustain'}
 */
export function classifyHeldPitch(midi, { pressedAt, cursorArrivedAt, cursorTargets } = {}) {
  if (cursorTargets?.has(midi)) return 'target';
  // An unknown press time cannot be SHOWN to be an afterglow, and a held key
  // with no provenance is most likely a real one — ghost it rather than hide a
  // mistake. This is also what keeps every caller that passes a bare
  // `{ velocity }` map behaving exactly as it did.
  if (!Number.isFinite(pressedAt) || !Number.isFinite(cursorArrivedAt)) return 'ghost';
  // A tie is a sustain. Deliberate: a real target is matched above before this
  // is ever reached, so the only thing the tie can cost is an accusation, and
  // this must not accuse a child on a rounding error.
  return pressedAt > cursorArrivedAt ? 'ghost' : 'sustain';
}

/**
 * Split a held-note Map into what to DRAW and what to stay quiet about.
 *
 * @param {Map<number, {timestamp?:number}>|null} activeNotes
 * @param {{cursorArrivedAt:number, cursorTargets:Set<number>}} at
 * @returns {{ghosts:Array<{midi:number, pressedAt:number|null}>,
 *            sustains:Array<{midi:number, pressedAt:number|null}>}}
 */
export function partitionHeldPitches(activeNotes, { cursorArrivedAt, cursorTargets }) {
  const ghosts = [];
  const sustains = [];
  for (const [midi, held] of activeNotes ?? []) {
    const pressedAt = Number.isFinite(held?.timestamp) ? held.timestamp : null;
    const verdict = classifyHeldPitch(midi, { pressedAt: held?.timestamp, cursorArrivedAt, cursorTargets });
    if (verdict === 'ghost') ghosts.push({ midi, pressedAt });
    else if (verdict === 'sustain') sustains.push({ midi, pressedAt });
  }
  return { ghosts, sustains };
}

export default classifyHeldPitch;
