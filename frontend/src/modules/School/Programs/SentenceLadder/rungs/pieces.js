/**
 * A take said in pieces (design 2026-09-22): the learner cuts the model
 * sentence live, says what they heard so far, then hears and says the rest.
 *
 * State is two lists. `cuts` are points in the MODEL clip (ms, ascending);
 * piece i is the model from cut i-1 (or 0) to cut i (or the end of the clip).
 * `takes[i]` is what the learner recorded for piece i. A piece is only ever
 * added at the end and only ever redone in place, so the lists stay aligned.
 *
 * Pure — the rung owns the microphone, the players and the phases.
 */

/** A piece may be a two-word phrase, well under the one-go floor (1200ms),
 *  but still has to be longer than a tap. */
export const MIN_PIECE_MS = 500;
/** A cut this close to the start of its span would make an empty piece. */
export const MIN_CUT_GAP_MS = 300;

export const emptyPieces = () => ({ cuts: [], takes: [] });

export function spanOf({ cuts }, i) {
  return { fromMs: i === 0 ? 0 : cuts[i - 1], toMs: cuts[i] ?? null };
}

/** Only an open-ended span can be cut — a bounded one already ends at a cut. */
export function canCut(state, i, atMs) {
  const { fromMs, toMs } = spanOf(state, i);
  return toMs == null && atMs - fromMs >= MIN_CUT_GAP_MS;
}

export const addCut = (state, atMs) => ({ ...state, cuts: [...state.cuts, atMs] });

export function setTake(state, i, take) {
  const takes = [...state.takes];
  takes[i] = take;
  return { ...state, takes };
}

/** No cut was made during piece i, so it runs to the end of the sentence. */
export const isLast = (state, i) => i === state.cuts.length;

/** Same rule as a one-go take, with the piece floor: loudness is only judged
 *  when a level was measured at all. */
export function pieceVerdict({ durationMs, heard, measurable }) {
  if (measurable && !heard) return 'too-quiet';
  if (durationMs < MIN_PIECE_MS) return 'too-short';
  return null;
}

export const totalMs = (state) => state.takes.reduce((n, t) => n + (t?.durationMs || 0), 0);
export const allHeard = (state) => state.takes.every((t) => t?.heard);
