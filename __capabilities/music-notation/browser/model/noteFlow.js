// MusicNotation model — the live "note flow": what is being played, laid out as a
// left-to-right sequence of columns instead of a single stacked pile.
//
// WHAT THIS IS NOT: meter. There is no time signature, no barline, no BPM, and
// nothing is quantised to a grid. The horizontal axis carries ORDER, the way typed
// letters march right across a screen.
//
// What it DOES carry is a COARSE RELATIVE duration: each column is engraved as an
// eighth, a quarter, or a half depending on how its gap to the next strike compares
// with how you have been playing over the last few seconds. Nothing here claims to
// have measured a tempo — the same passage played twice as fast engraves identically,
// because every judgement is a ratio against a moving baseline.
//
// HOLDS count too: a column whose keys were all still down when the next column
// opened (a left-hand chord under a right-hand melody) is judged by how long it is
// actually held, not by the gap to the next strike, so it promotes to a half once the
// hold outlasts the threshold. And a breath no longer wipes the line: it stays on
// screen through IDLE_CLEAR_MS of silence, the next strike then starts a fresh line,
// and only STALE_CLEAR_MS of nothing at all empties the staff.
//
// Two judgement calls live here.
//
//   1. GESTURE CLUSTERING — which onsets belong to one column (see GAP_MS).
//   2. DURATION — which of the three glyphs a column earns, decided retroactively
//      once the next column opens.

/**
 * A column is one GESTURE: a roll or struck chord, not a moment. Four numbers decide
 * what joins it, all measured on real playing (spec: ops:docs/_wip/audits/
 * 2026-11-13-current-chord-staff-gestures.md).
 *
 * GAP_MS is the longest silence between consecutive onsets of one gesture, measured
 * from the LAST onset. The old rule measured a 90ms WINDOW from the column's start and
 * caused 989 wrong splits of rolled chords; the held-key rule was not the culprit.
 */
export const GAP_MS = 90;

/**
 * Longest a gesture may run from its first onset. Without it a legato run in which
 * every key is still down daisy-chains into one stack. The owner's gestures have p95
 * 200ms and everyone's p95 244ms; 250ms keeps 99.2% of the owner's and 95.6% of all
 * gestures whole.
 */
export const SPAN_MAX_MS = 250;

/** A column spanning at least this long is a ROLL and gets an arrow; shorter reads as struck. */
export const ROLL_MARK_MS = 100;

/** Ten fingers: more notes than this in one column is two gestures, not one chord. */
export const MAX_COLUMN_NOTES = 10;

/** Columns kept on the staff before the oldest scrolls off the left. */
export const COLUMN_CAPACITY = 8;

/**
 * Silence after which the NEXT strike starts a fresh line at the left edge instead of
 * continuing a stale one. Nothing is wiped at this point — the old line stays visible
 * until that strike (or STALE_CLEAR_MS), so a breath between phrases does not blank
 * the staff under the player. No inter-onset interval is recorded across the breath.
 */
export const IDLE_CLEAR_MS = 3000;

/**
 * Silence after which an untouched staff is emptied outright, key-down state ignored:
 * a lost note-off must not freeze a stale line on screen forever.
 */
export const STALE_CLEAR_MS = 30000;

// ─── Rhythm ─────────────────────────────────────────────────────────────────────

/** Below FAST_RATIO × baseline a column is an eighth; above SLOW_RATIO × baseline, a half. */
export const FAST_RATIO = 0.6;
export const SLOW_RATIO = 1.5;

/**
 * How many recent inter-onset intervals feed the baseline. Deliberately longer than
 * COLUMN_CAPACITY: a capacity-8 staff yields at most 7 visible gaps, so a baseline
 * drawn only from what is on screen would be entirely rewritten by a single run.
 */
export const IOI_MEMORY = 16;

/**
 * The baseline is clamped, and BOTH ends of the clamp do real work.
 *
 * The FLOOR is what makes a fast run readable at all. A purely relative baseline is
 * self-defeating on a uniform passage: play twelve notes at 120ms and the median
 * becomes 120, the eighth threshold becomes 72ms, and the run classifies as ordinary
 * quarters — the exact case the feature exists to draw. Flooring the baseline at
 * 300ms means anything under 180ms reads as an eighth in any context, which matches
 * how a sub-180ms note actually sounds. Above the floor the ratio does relative work
 * as intended.
 *
 * The CEILING keeps half notes reachable. A half needs a gap longer than
 * SLOW_RATIO × baseline, but a gap of IDLE_CLEAR_MS starts a fresh line first, so a
 * baseline above ~1000ms would put the half threshold past the clear and no half
 * could ever draw. 1.5 × 800 = 1200ms, a wide margin under the 3000ms idle line.
 */
export const BASELINE_MIN_MS = 300;
export const BASELINE_MAX_MS = 800;

/**
 * Baseline used before any gap has been measured — the first column of every phrase,
 * since `recentIois` clears with the flow. Without it the first note of a phrase has
 * a median of nothing and every comparison against NaN is false, so a struck-and-held
 * chord (the commonest thing anyone does) would never promote to a half.
 */
export const DEFAULT_BASELINE_MS = 500;

/** @typedef {'8'|'q'|'h'} Duration */
/** @typedef {{ midis: number[], startedAt: number, lastOnsetAt: number, firstMidi: number, lastMidi: number, duration: Duration|null, heldAtClose: boolean, releasedAt: number|null }} FlowColumn */

/** A new, empty flow. */
export const emptyFlow = () => ({ columns: [], lastOnsetAt: 0, recentIois: [] });

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The pace to judge against: the median of recent gaps, clamped. Median rather than
 * mean so one long pause mid-phrase doesn't drag the whole scale with it.
 *
 * @param {number[]} recentIois
 * @returns {number} ms
 */
export function baselineOf(recentIois) {
  if (!recentIois || recentIois.length === 0) return DEFAULT_BASELINE_MS;
  return clamp(median(recentIois), BASELINE_MIN_MS, BASELINE_MAX_MS);
}

/**
 * Classify one gap against a baseline.
 * @param {number} ioi
 * @param {number} baseline
 * @returns {Duration}
 */
export function classifyIoi(ioi, baseline) {
  if (ioi < FAST_RATIO * baseline) return '8';
  if (ioi > SLOW_RATIO * baseline) return 'h';
  return 'q';
}

const dedupeSorted = (midis) => [...new Set(midis)].sort((a, b) => a - b);

/**
 * Fold a batch of new note-ons into the flow.
 *
 * A batch joins the open (rightmost) column iff ALL hold: it arrives within GAP_MS of
 * the column's LAST onset; within SPAN_MAX_MS of its first; every note already in the
 * column is still held (when a `held` surface is given — key-down state is what
 * separates a chord from a detached run without guessing from pitch); none of its
 * notes is already in the column (a re-strike is a new event); and the union stays
 * within MAX_COLUMN_NOTES.
 *
 * `firstMidi` / `lastMidi` are the lowest note of the batch that opened the column and
 * of the latest batch that joined it; their order gives a roll its direction.
 *
 * Closing a column fixes its duration: the gap to this new column is its IOI, judged
 * against the baseline as it stood BEFORE that gap joined the history — "how you have
 * been playing", not including the note being judged. The duration is then STORED on
 * the column. It has to be stored rather than re-derived: the baseline moves with
 * every strike, so a derived duration would re-classify notes already on the staff
 * and glyphs would flip under the player's eyes a second after they were drawn.
 *
 * @param {{columns: FlowColumn[], lastOnsetAt: number, recentIois: number[]}} flow
 * @param {number[]} midis - MIDI notes that just started (may be empty)
 * @param {number} now - onset timestamp (ms)
 * @param {{held?: {has: (n: number) => boolean}, capacity?: number}} [opts]
 *   `held` is the live key-down surface (an activeNotes Map works). Omit it to skip
 *   the overlap test entirely — time alone then decides, as it used to.
 * @returns {{columns: FlowColumn[], lastOnsetAt: number, recentIois: number[]}} a NEW flow (never mutated)
 */
export function pushOnsets(flow, midis, now, opts = {}) {
  if (!midis || midis.length === 0) return flow;
  const { held = null, capacity = COLUMN_CAPACITY } = opts;

  // A breath longer than IDLE_CLEAR_MS ends the phrase: start a fresh line, and
  // record no IOI across the silence (it would poison the baseline).
  if (flow.columns.length > 0 && now - flow.lastOnsetAt > IDLE_CLEAR_MS) flow = emptyFlow();

  const columns = flow.columns.slice();
  const open = columns[columns.length - 1];

  const sorted = dedupeSorted(midis);
  const lowest = sorted[0];

  const joins = open
    && now - open.lastOnsetAt <= GAP_MS
    && now - open.startedAt <= SPAN_MAX_MS
    && (!held || open.midis.every((m) => held.has(m)))
    && !sorted.some((m) => open.midis.includes(m))
    && open.midis.length + sorted.length <= MAX_COLUMN_NOTES;

  if (joins) {
    columns[columns.length - 1] = {
      ...open,
      midis: dedupeSorted([...open.midis, ...sorted]),
      lastOnsetAt: now,
      lastMidi: lowest,
    };
    return { ...flow, columns, lastOnsetAt: now };
  }

  let recentIois = flow.recentIois;
  if (open) {
    const ioi = now - open.startedAt;
    // First gap of a phrase has no history. Judging it against a bare 500ms default
    // made a uniform 250ms passage open with a half-or-eighth quirk; clamping the
    // gap itself (but never above the default) makes it read like its successors.
    const baseline = recentIois.length
      ? baselineOf(recentIois)
      : Math.min(DEFAULT_BASELINE_MS, clamp(ioi, BASELINE_MIN_MS, BASELINE_MAX_MS));
    // heldAtClose: every key still down as the next column opens means the gap to it
    // says nothing about how long the column lasts — pushReleases/flowDurations judge
    // the hold instead.
    columns[columns.length - 1] = {
      ...open,
      duration: classifyIoi(ioi, baseline),
      heldAtClose: !!held && open.midis.every((m) => held.has(m)),
    };
    recentIois = [...recentIois, ioi].slice(-IOI_MEMORY);
  }
  columns.push({
    midis: sorted, startedAt: now, lastOnsetAt: now, firstMidi: lowest, lastMidi: lowest,
    duration: null, heldAtClose: false, releasedAt: null,
  });

  // Overflow scrolls: the oldest column falls off the left, like a line of text
  // running past the edge. `recentIois` deliberately does NOT scroll with it — the
  // baseline needs to remember further back than the staff can show.
  const overflow = columns.length - capacity;
  return {
    columns: overflow > 0 ? columns.slice(overflow) : columns,
    lastOnsetAt: now,
    recentIois,
  };
}

/**
 * Empty the flow only when it has been abandoned for STALE_CLEAR_MS. Anything shorter
 * keeps the line on screen: the idle line (IDLE_CLEAR_MS) is enforced by the next
 * strike in `pushOnsets`, not by a wipe. Key-down state is ignored — `held` in opts is
 * accepted for older callers and has no effect.
 *
 * Returns the same object when there is nothing to do, so React state that holds a
 * flow won't re-render on every idle tick.
 *
 * @param {{columns: FlowColumn[], lastOnsetAt: number, recentIois: number[]}} flow
 * @param {number} now
 * @param {{held?: unknown, idleMs?: number}|number} [opts] - a bare number is read
 *   as the threshold override, the older signature.
 */
export function clearIfIdle(flow, now, opts = {}) {
  const { idleMs = STALE_CLEAR_MS } = typeof opts === 'number' ? { idleMs: opts } : opts;
  if (flow.columns.length === 0) return flow;
  if (now - flow.lastOnsetAt < idleMs) return flow;
  return emptyFlow();
}

/**
 * Release bookkeeping for held columns. A closed column that was fully held when it
 * closed is released once none of its keys is down, or once a later column re-strikes
 * one of its pitches (a re-strike implies the earlier note let go). On release the
 * duration is fixed: promoted to a half if the hold outlasted SLOW_RATIO × baseline,
 * otherwise left as its IOI duration. Upward only.
 *
 * @param {{columns: FlowColumn[], recentIois: number[]}} flow
 * @param {number} now
 * @param {{has: (n: number) => boolean}} held
 * @returns the SAME flow when nothing was released
 */
export function pushReleases(flow, now, held) {
  let changed = false;
  const baseline = baselineOf(flow.recentIois);
  const columns = flow.columns.map((c, i) => {
    if (i === flow.columns.length - 1 || !c.heldAtClose || c.releasedAt !== null) return c;
    const restruck = flow.columns.slice(i + 1).some((later) => later.midis.some((m) => c.midis.includes(m)));
    if (!restruck && c.midis.some((m) => held.has(m))) return c;
    changed = true;
    return {
      ...c,
      releasedAt: now,
      duration: now - c.startedAt > SLOW_RATIO * baseline ? 'h' : c.duration,
    };
  });
  return changed ? { ...flow, columns } : flow;
}

/**
 * The flow as plain note groups for the renderer, oldest → newest.
 * @returns {number[][]}
 */
export const flowColumns = (flow) => flow.columns.map((c) => c.midis);

/**
 * Durations for the flow, oldest → newest, parallel to `flowColumns`.
 *
 * Every column but the newest carries the duration it was given when it closed, so
 * what is already drawn never changes. The newest column has no gap yet: it shows as
 * a quarter provisionally, and becomes a half once it has been held past the same
 * threshold a closed column would have to clear. A closed column that was fully held
 * when it closed and has not been released yet promotes the same way (its stored
 * duration is only the IOI guess). Those promotions are the only things on the staff
 * that change with the clock, and why the host needs a tick. Upward only.
 *
 * @param {{columns: FlowColumn[], recentIois: number[]}} flow
 * @param {number} now
 * @returns {Duration[]}
 */
export function flowDurations(flow, now) {
  const baseline = baselineOf(flow.recentIois);
  const longHold = (c) => now - c.startedAt > SLOW_RATIO * baseline;
  return flow.columns.map((c) => {
    if (c.duration === null) return longHold(c) ? 'h' : 'q';
    if (c.heldAtClose && c.releasedAt === null && longHold(c)) return 'h';
    return c.duration;
  });
}

/**
 * Roll direction per column, parallel to `flowColumns`: 'up'/'down' for a gesture of
 * 2+ notes spanning at least ROLL_MARK_MS, else null (struck, or a single note).
 * @returns {Array<'up'|'down'|null>}
 */
export const flowRolls = (flow) => flow.columns.map((c) =>
  c.midis.length >= 2 && c.lastOnsetAt - c.startedAt >= ROLL_MARK_MS
    ? (c.lastMidi > c.firstMidi ? 'up' : 'down')
    : null);

export default { emptyFlow, flowRolls, pushOnsets, pushReleases, clearIfIdle, flowColumns, flowDurations, baselineOf, classifyIoi };
