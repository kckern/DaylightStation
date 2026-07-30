// MusicNotation model — the live "note flow": what is being played, laid out as a
// left-to-right sequence of columns instead of a single stacked pile.
//
// WHAT THIS IS NOT: rhythm. There is no meter, no time signature, no quantisation,
// nothing here claims a note was a quarter or an eighth. Every column is engraved
// with the same neutral notehead. The horizontal axis carries ORDER, the way typed
// letters march right across a screen — you can see that you rolled a chord rather
// than struck it, and that the arpeggio went up, without the display pretending to
// have measured anything.
//
// The one real judgement call is simultaneity: MIDI onsets are never exactly equal,
// and a rolled chord is a deliberate spread rather than sloppy timing. So onsets
// that land within SIMULTANEITY_MS of the column they'd join are stacked into it;
// anything later opens a new column to its right.

/**
 * Onsets within this window of the open column's start join that column and stack
 * vertically. Wider and a genuine roll collapses into a block chord; narrower and
 * an honest two-handed strike splinters into two columns.
 *
 * 45ms sits above the jitter of a hard two-hand strike (a keybed plus BLE-MIDI
 * transport typically lands the notes of one gesture inside ~30ms) and well below
 * a musical roll, where successive notes are 60ms+ apart even when played fast.
 */
export const SIMULTANEITY_MS = 45;

/** Columns kept on the staff before the oldest scrolls off the left. */
export const COLUMN_CAPACITY = 8;

/**
 * Silence after which the flow resets to empty, so the next phrase starts at the
 * left edge instead of continuing a stale line. Long enough to survive the gap
 * between phrases of a piece; short enough that walking away clears the staff.
 */
export const IDLE_CLEAR_MS = 1600;

/** @typedef {{ midis: number[], startedAt: number }} FlowColumn */

/** A new, empty flow. */
export const emptyFlow = () => ({ columns: [], lastOnsetAt: 0 });

/**
 * Fold a batch of new note-ons into the flow.
 *
 * Notes join the open (rightmost) column when they arrive within SIMULTANEITY_MS
 * of the moment that column opened — measured from the column's START, not from
 * the last note added, so a slow chord roll can't daisy-chain itself into one
 * stack one note at a time.
 *
 * @param {{columns: FlowColumn[], lastOnsetAt: number}} flow
 * @param {number[]} midis - MIDI notes that just started (may be empty)
 * @param {number} now - onset timestamp (ms)
 * @param {number} [capacity=COLUMN_CAPACITY]
 * @returns {{columns: FlowColumn[], lastOnsetAt: number}} a NEW flow (never mutated)
 */
export function pushOnsets(flow, midis, now, capacity = COLUMN_CAPACITY) {
  if (!midis || midis.length === 0) return flow;

  const columns = flow.columns.slice();
  const open = columns[columns.length - 1];

  if (open && now - open.startedAt <= SIMULTANEITY_MS) {
    // Same gesture: stack into the open column (dedupe — a retrigger inside the
    // window shouldn't draw the same notehead twice).
    const merged = new Set(open.midis);
    midis.forEach((m) => merged.add(m));
    columns[columns.length - 1] = { ...open, midis: [...merged].sort((a, b) => a - b) };
  } else {
    columns.push({ midis: [...new Set(midis)].sort((a, b) => a - b), startedAt: now });
  }

  // Overflow scrolls: the oldest column falls off the left, like a line of text
  // running past the edge. (The alternative — wiping and restarting at the left —
  // is a one-line change here, but it throws away the context of what you just
  // played every capacity notes.)
  const overflow = columns.length - capacity;
  return {
    columns: overflow > 0 ? columns.slice(overflow) : columns,
    lastOnsetAt: now,
  };
}

/**
 * Reset the flow once the keyboard has been quiet for IDLE_CLEAR_MS.
 * Returns the same object when there is nothing to do, so React state that holds a
 * flow won't re-render on every idle tick.
 *
 * @param {{columns: FlowColumn[], lastOnsetAt: number}} flow
 * @param {number} now
 * @param {number} [idleMs=IDLE_CLEAR_MS]
 */
export function clearIfIdle(flow, now, idleMs = IDLE_CLEAR_MS) {
  if (flow.columns.length === 0) return flow;
  if (now - flow.lastOnsetAt < idleMs) return flow;
  return emptyFlow();
}

/**
 * The flow as plain note groups for the renderer, oldest → newest.
 * @returns {number[][]}
 */
export const flowColumns = (flow) => flow.columns.map((c) => c.midis);

export default { emptyFlow, pushOnsets, clearIfIdle, flowColumns };
