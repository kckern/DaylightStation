/**
 * WHEN A CHILD IS HUNTING, SAY SOMETHING.
 *
 * Before this existed, an exercise run had no response of any kind to a child
 * who could not find the note. The screen state on the tenth wrong key was
 * identical to the state on the first: the same lit key, the same
 * "That note was not expected — keep going."
 *
 * What that looks like in the store (2026-09-13 19:58:25–19:58:45, a
 * four-year-old on `keys/lit@notes=3,arrangement=sequence,pick=15`): note 1
 * completes, then THIRTY `wrong` observations in twenty seconds against note 2
 * — 69, 64, 67, 59, 72, 62, 57, 60 — with the cursor never moving. Three more
 * runs the same week ran 29, 21 and 8 wrongs on a single target. The run
 * recorded every one of them and answered none of them.
 *
 * So: count consecutive wrong onsets against ONE cursor position, and climb.
 *
 *   3 wrongs → `recue`   — pulse the key that is already lit. The commonest
 *                          case is not "I do not know", it is "I have lost
 *                          track of where the highlight is" on a board of
 *                          fifty keys. Movement finds an eye that colour did
 *                          not.
 *   6 wrongs → `reveal`   — name the note in words, in the status line that is
 *                          already on screen saying something less useful. At
 *                          this point the child is not going to find it by
 *                          looking harder.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS NARROW THE BOARD. Cropping the
 * keyboard to a window around the ask was tried and reverted for a documented
 * reason (`KeysAsk`, 2026-09-08): a seven-semitone board has no black-key
 * groups and no ends, so the highlighted key cannot be located on the
 * instrument at all, which is the same complaint one rung worse.
 *
 * Help is free and ungated. Every rung this can reach is tier 0-2, where the
 * rubric is completeness-only (`{ completeness: 1 }`) — did the asked pitches
 * arrive, in order — so a hint cannot flatter a score. A cued run is graded
 * against a beat and is not armed at all; see `huntingArmed`.
 *
 * Pure and exported so the ladder is pinned by its own spec rather than by
 * whatever the component happens to do with it.
 */

/** Consecutive wrongs at one cursor, and what the run owes the child at each. */
export const HUNT_RUNGS = Object.freeze([
  Object.freeze({ wrongs: 3, help: 'recue' }),
  Object.freeze({ wrongs: 6, help: 'reveal' }),
]);

/** Not hunting: nothing counted, nothing owed. */
export const NO_HUNT = Object.freeze({ cursor: null, wrongs: 0, help: null });

/** A cued run is judged against a beat; a hint mid-beat is a different game. */
export const huntingArmed = (matcher) => matcher !== 'timed';

/** The highest rung this many consecutive wrongs has reached, or null. */
export function huntRungFor(wrongs) {
  let help = null;
  for (const rung of HUNT_RUNGS) if (wrongs >= rung.wrongs) help = rung.help;
  return help;
}

/**
 * Fold one observation into the hunt.
 *
 * ANY FORWARD MOTION CLEARS IT. The counter is about one target, not about the
 * run: a child who finds note 2 after eight guesses starts note 3 owed nothing,
 * because the eight guesses were evidence about a note they have now played.
 * Only `wrong` at the SAME cursor accumulates.
 *
 * @param {{cursor:number|null, wrongs:number, help:string|null}} state
 * @param {{type?:string, cursor?:number|null}} observation - the event's type
 *   and the assessor's cursor AFTER it.
 * @returns {{cursor:number|null, wrongs:number, help:string|null, changed:boolean}}
 *   `changed` is true only when the rung itself moved, which is what a caller
 *   should re-render and log on — a wrong note that climbs no rung is already
 *   recorded as an observation.
 */
export function nextHuntState(state = NO_HUNT, observation = {}) {
  const prev = state ?? NO_HUNT;
  const { type, cursor = null } = observation;
  if (type !== 'wrong') {
    // Moving on — or any non-wrong event at a new position — ends the hunt.
    if (cursor !== prev.cursor) return { ...NO_HUNT, cursor, changed: prev.help !== null };
    return { ...prev, changed: false };
  }
  const wrongs = cursor === prev.cursor ? prev.wrongs + 1 : 1;
  const help = huntRungFor(wrongs);
  return { cursor, wrongs, help, changed: help !== prev.help };
}

export default nextHuntState;
