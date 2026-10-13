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

/** Every piece's span as the log writes it: `{from, to}` in model ms, the
 *  open-ended last piece ending at `sentenceMs` when that is known. */
export function pieceSpans({ cuts }, sentenceMs = null) {
  const ends = [...cuts, sentenceMs ?? null];
  return ends.map((to, i) => ({ from: i === 0 ? 0 : cuts[i - 1], to }));
}

/** A span's length, or null while its end is unknown. */
export const spanMs = ({ fromMs, toMs }) => (toMs == null ? null : toMs - fromMs);

/** How many chunks the sentence is in now: one more than its cuts. */
export const pieceCount = ({ cuts }) => cuts.length + 1;

/**
 * After chunk i: the first later chunk with no take yet, or null when every
 * chunk has one (time to join). A chunk redone out of order goes on to the
 * first unsaid one rather than re-asking for chunks already said.
 */
export function nextToSay(state, i) {
  for (let j = i + 1; j < pieceCount(state); j += 1) if (!state.takes[j]) return j;
  return null;
}

/** The takes said so far, in order — what Enter joins. */
export const saidTakes = (state) => state.takes.filter(Boolean);

/** Joined before every chunk had a take: the sentence's tail is not in it. */
export const isPartial = (state) => saidTakes(state).length < pieceCount(state);
