/**
 * deckProgress — the set/rep structure of a run, read off the run's own events.
 *
 * A FLASHCARD DECK IS A DRILL AND WAS NOT DRAWN AS ONE. The gate's
 * sight-reading rung deals `notes=3, arrangement=sequence, reps=3`: three
 * pitches, three consecutive cards each, nine cards, one on screen at a time
 * (`gateMaterial.js` — reps repeat each note CONSECUTIVELY, which is what makes
 * a reading drill a drill). That is set-and-rep structure by any reading of it,
 * and `DrillProgress` exists to draw exactly that — but it was wired to one
 * material kind only: the gate supplies `programId`/`stepId` for
 * `{ kind: 'drill' }` and for nothing else, so a nine-card deck fell through to
 * the standing instruction and a child was told "Follow the highlighted notes"
 * nine times instead of being shown where in the nine they were.
 *
 * Nothing here is a second progress model. It reads the events that are already
 * on screen and answers in the shape `DrillProgress` already consumes, so the
 * pills, the rings and the roll-up are the same ones the scale drill draws.
 *
 * A HOST-SUPPLIED DRILL PROJECTION ALWAYS WINS. This is what a run infers about
 * itself when nobody told it; a drill knows its standing across the whole study
 * day, which no amount of looking at one instance can reconstruct.
 *
 * Pure: no React, no fetching, no logging, no throwing.
 */

/** Two cards ask for the same thing when they light the same pitches. */
function signature(event) {
  const midis = (event?.notes ?? [])
    .map((note) => note?.midi)
    .filter((midi) => Number.isFinite(midi))
    .sort((a, b) => a - b);
  return midis.length ? midis.join('.') : null;
}

/**
 * The deck's sets: runs of CONSECUTIVE events asking for the same thing.
 *
 * Consecutive is the whole rule, and it is the material's rule rather than a
 * guess: reps are dealt back to back so the same card comes back while it is
 * still fresh. A scale that touches G twice, at the bottom and at the top of
 * the gesture, is two separate notes with thirteen in between and never groups.
 *
 * @returns {Array<{signature:string,size:number}>|null} null when the events
 *   cannot be read as cards at all (an empty run, or an event with no pitch —
 *   a rest, or a score's expectation before the engraver has answered).
 */
export function deckSets(instance) {
  const events = instance?.events ?? [];
  if (events.length < 2) return null;
  const sets = [];
  for (const event of events) {
    const sig = signature(event);
    if (!sig) return null;
    const last = sets[sets.length - 1];
    if (last && last.signature === sig) last.size += 1;
    else sets.push({ signature: sig, size: 1 });
  }
  return sets;
}

/**
 * Today's standing in a deck, in the shape `DrillProgress` reads.
 *
 * TWO THINGS DISQUALIFY A RUN, and both are about whether the chrome would say
 * anything true:
 *
 * 1. **Fewer than two sets.** One cluster of pills is a progress bar with extra
 *    steps; `DrillProgress` declines to draw a one-step program for the same
 *    reason and falls back to the host's own line.
 * 2. **No set repeats.** A run of distinct notes is a line of MUSIC, not a
 *    deck: every one of its notes is on the staff at once with a cursor
 *    walking them, so position is already visible and a second rendering of it
 *    would be the same fact twice. Repetition is precisely the case where the
 *    stage shows one card and the child cannot see where they are.
 *
 * THE STEPS CARRY NO LABEL, deliberately. On a reading rung the cluster label
 * would be the answer: a child asked to read a note off the staff must not be
 * handed "C4" in the chrome underneath it. The pills are positional and say
 * everything a deck has to say — which set, which rep, how many are left.
 *
 * @param {object|null} instance the run's material (for its id/title only)
 * @param {Array|null} sets the answer from `deckSets`
 * @param {number} cursorIndex how many cards are behind the child — the
 *   DISPLAYED cursor, so the pills bank when the note is seen to land rather
 *   than a frame before it.
 */
export function deckProjection(instance, sets, cursorIndex = 0) {
  if (!Array.isArray(sets) || sets.length < 2) return null;
  if (!sets.some((set) => set.size > 1)) return null;

  const parsed = Math.floor(Number(cursorIndex));
  const cursor = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;

  let start = 0;
  let currentTaken = false;
  const steps = sets.map((set, index) => {
    const passed = cursor >= start + set.size;
    const isCurrent = !passed && !currentTaken;
    if (isCurrent) currentTaken = true;
    const step = {
      id: `card-${index + 1}`,
      order: index + 1,
      requirement: { required_passes: set.size },
      pass_count: Math.min(Math.max(cursor - start, 0), set.size),
      passed,
      unlocked: passed || isCurrent,
      state: passed ? 'passed' : isCurrent ? 'current' : 'upcoming',
    };
    start += set.size;
    return step;
  });

  const passedSteps = steps.filter((step) => step.passed).length;
  return {
    id: `deck:${instance?.id ?? 'run'}`,
    title: instance?.title ?? 'Deck',
    steps,
    total_steps: steps.length,
    passed_steps: passedSteps,
    complete: passedSteps === steps.length,
    current_step: steps.find((step) => step.state === 'current') ?? null,
  };
}
