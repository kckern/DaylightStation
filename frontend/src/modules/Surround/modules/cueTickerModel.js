// frontend/src/modules/Surround/modules/cueTickerModel.js
//
// Timing constants and pure dissolve-edge logic for CueTicker.jsx, split out
// so Fast Refresh can hot-reload the ticker component on its own.
import { DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS, DISSOLVE_SWAP_MS } from '../dissolve.js';

/** Each half of the dissolve: the old line out, then the new line in.
 *  ALIASES of the house dissolve (`../dissolve.js`) — the number lives there, so
 *  the ticker, the rail fact and the place carousel cannot drift apart. */
export const CUE_FADE_MS = DISSOLVE_FADE_MS;
/** The beat of empty ground between them — the "through black" of the dissolve. */
export const CUE_HOLD_MS = DISSOLVE_HOLD_MS;
/** Out + held ground + in. The CSS duration is set inline from CUE_FADE_MS, so
 *  the stylesheet and this timer cannot drift apart. */
export const CUE_SWAP_MS = DISSOLVE_SWAP_MS;
/** How long a timed cue holds the panel when it names no dwell of its own. */
export const CUE_DWELL_S = 12;
/** Fact rotation. Slow: this plays behind music. */
export const FACT_INTERVAL_MS = 20000;
/**
 * The NOW register's rotation. Deliberately the SAME period as the piece
 * register's, not a coprime one: the two zones are read together and a viewer
 * should not be able to feel one running faster than the other. What keeps them
 * from swapping in the same instant is the phase below, which at equal periods
 * is an exact and permanent half-period gap.
 */
export const LISTEN_INTERVAL_MS = FACT_INTERVAL_MS;
/**
 * How long to wait so that the next NOW swap lands exactly half a period after a
 * PIECE swap.
 *
 * THE OFFSET IS MEASURED FROM THE PIECE REGISTER'S OWN CLOCK, not from the
 * moment the NOW register re-arms, and that distinction is the whole of the
 * invariant's honesty. The NOW register re-arms at every segment boundary and
 * at the end of every timed cue; the piece register's beat runs on through both
 * (it must — tearing it down on a cue edge in the OTHER zone was itself a
 * defect). A flat "wait half a period from HERE" therefore gave an exact
 * half-period gap once, at mount, and an arbitrary one after the first
 * boundary — the two zones could land in lockstep and blink together, which is
 * the single effect the phase exists to prevent. There is no `LISTEN_PHASE_MS`
 * constant any more: a fixed delay was the bug, and a constant nothing computes
 * from is surface to trip on.
 *
 * Pure and exported so the phase relation can be tested as a relation, rather
 * than by asserting the delay values — which is precisely how the false
 * invariant survived six waves of review.
 *
 * @param {number} sinceLastPieceSwap ms elapsed since the piece register last
 *   swapped (or since its interval was armed).
 * @param {number} [periodMs] the shared rotation period.
 * @returns {number} 0..periodMs.
 */
export function phaseDelay(sinceLastPieceSwap, periodMs = FACT_INTERVAL_MS) {
  const period = Number(periodMs) > 0 ? Number(periodMs) : FACT_INTERVAL_MS;
  const half = period / 2;
  const elapsed = Number.isFinite(sinceLastPieceSwap) ? sinceLastPieceSwap : 0;
  const wait = (half - (elapsed % period)) % period;
  return wait < 0 ? wait + period : wait;
}

/**
 * A line of nothing that still occupies a line.
 *
 * The NOW header is blank when nothing is sounding (design wave 9), and blank
 * has to mean BLANK rather than absent: an element that disappears gives its
 * height back to the note's box, which changes the room the fit was solved
 * against, which resizes the type of both registers on a segment boundary. The
 * reserved-height law is the same law it has always been; this is what keeps it
 * true through a state the band did not use to have.
 */
export const BLANK_LINE = '\u00a0';

export const EMPTY = Object.freeze({ key: 'empty', kind: null, at: null, text: '' });

/** A dissolving line is only worth fading out of when it has words in it. */
const hasLine = (value) => Boolean(value?.text);

/**
 * The NOW zone's two urgent edges — commit instantly rather than softening.
 *
 * Fix round 1 (review finding I2), scoped to the NOW ZONE ONLY: `seg` is carried
 * solely on the now-zone's payload (see `nowNext`), so both conditions are false
 * whenever `next`/`shown` are the piece register's. The piece register's cue
 * interrupt (the unsplit band, wave 2) keeps its original gentle dissolve on
 * purpose — it has no header to disagree with.
 *   - an ACTIVATING CUE (`shown` was not a cue, `next` is): a cue is a claim
 *     about what is sounding RIGHT NOW, and a stale rotation note lingering
 *     through even one fade-out is a wrong answer, however briefly.
 *   - a SEGMENT BOUNDARY (`next.seg` names a different segment than
 *     `shown.seg`): the header above this text is NOT dissolved, so a softened
 *     note would show the NEW segment's header over the OLD segment's note for
 *     up to a full fade — the two halves of the band naming different segments
 *     at the same instant.
 * Without this, a second edge arriving before the first dissolve's commit fires
 * re-queues a full `DISSOLVE_COMMIT_MS` wait on top of whatever was left of the
 * first.
 */
export function urgentNowEdge(next, shown) {
  const isNowZone = next?.seg !== undefined || shown?.seg !== undefined;
  const activating = isNowZone && next?.kind === 'cue' && shown?.kind !== 'cue';
  const boundary = next?.seg !== undefined && shown?.seg !== undefined && next.seg !== shown.seg;
  // A RE-FIT (design wave 9), in BOTH registers. The band has just decided what
  // it can and cannot set whole, and a note it has withdrawn must leave at once:
  // softening the change plays a 320ms fade of the exact note the fit refused,
  // which is the ellipsis defect wearing a cross-fade.
  const refit = next?.pool !== undefined && shown?.pool !== undefined && next.pool !== shown.pool;
  return activating || boundary || refit;
}

/** The house dissolve, configured for a band line. One object, never re-made. */
export const LINE_DISSOLVE = Object.freeze({ hasContent: hasLine, instant: urgentNowEdge });
