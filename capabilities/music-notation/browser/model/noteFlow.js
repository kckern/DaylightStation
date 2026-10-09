// MusicNotation model — the live "note flow": what is being played, laid out as a
// left-to-right sequence of columns instead of a single stacked pile.
//
// WHAT THIS IS NOT: meter. There is no time signature, no barline, no BPM, and
// nothing is quantised to a grid. The horizontal axis carries ORDER, the way typed
// letters march right across a screen.
//
// What it DOES carry, as of the rhythm work, is a COARSE RELATIVE duration: each
// column is engraved as an eighth, a quarter, or a half depending on how its gap to
// the next strike compares with how you have been playing over the last few seconds.
// Nothing here claims to have measured a tempo — the same passage played twice as
// fast engraves identically, because every judgement is a ratio against a moving
// baseline.
//
// Two judgement calls live here.
//
//   1. SIMULTANEITY — which onsets belong to one column. MIDI onsets are never
//      exactly equal, and two hands "together" spread further than a strict reading
//      allows.
//   2. DURATION — which of the three glyphs a column earns, decided retroactively
//      once the next column opens.

/**
 * Onsets within this window of the open column's start may join that column and
 * stack vertically; anything later opens a new column to its right.
 *
 * 90ms, twice the 45ms this started at. 45 splintered ordinary two-hand chords into
 * two and three columns, which is the thing the rhythm work set out to fix. 90 sits
 * above a realistic two-hand spread (including the piano → Jamcorder → backend → WS
 * transport jitter that the timestamps carry, since they are stamped on receipt and
 * not at the keybed) and below the ~120-150ms per note of a fast run, which must
 * stay as separate columns to read as eighths.
 *
 * UNVERIFIED against real hardware: these bounds are reasoned from the transport
 * described above, not measured off the kiosk. A capture of real two-hand onsets
 * would settle it — see docs/_wip/plans/2026-08-12-chord-staff-relative-rhythm-design.md.
 */
export const SIMULTANEITY_MS = 90;

/** Columns kept on the staff before the oldest scrolls off the left. */
export const COLUMN_CAPACITY = 8;

/**
 * Silence after which the flow resets to empty, so the next phrase starts at the
 * left edge instead of continuing a stale line.
 */
export const IDLE_CLEAR_MS = 1600;

/**
 * Backstop for the held-key hold-off below. A key that is still down suppresses the
 * idle clear — that is what lets a held final chord keep showing its half note — but
 * a note-off can be lost, and a stuck note must not freeze the staff forever.
 */
export const HELD_CLEAR_MS = 6000;

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
 * SLOW_RATIO × baseline, but a gap of IDLE_CLEAR_MS wipes the staff first, so a
 * baseline above ~1000ms would put the half threshold past the clear and no half
 * could ever draw. 1.5 × 800 = 1200ms, a 400ms margin under the 1600ms clear.
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
/** @typedef {{ midis: number[], startedAt: number, duration: Duration|null }} FlowColumn */

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
 * A batch joins the open (rightmost) column when BOTH hold:
 *
 *   - it arrives within SIMULTANEITY_MS of the moment that column OPENED — measured
 *     from the column's start, not from the last note added, so a slow roll can't
 *     daisy-chain itself into one stack a note at a time; and
 *   - every note already in that column is STILL HELD DOWN. This is what separates a
 *     chord from a run without guessing from pitch. An earlier design tried to tell
 *     the hands apart by register (wide window across C4, tight window within a
 *     hand); it failed both ways — an ordinary close-voiced two-hand chord has its
 *     nearest notes well under an octave apart and never got the wide window, while a
 *     wide arpeggio crossing middle C did, and collapsed into a block chord.
 *     Key-down state is the real signal, and the MIDI layer already tracks it.
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

  const columns = flow.columns.slice();
  const open = columns[columns.length - 1];

  const inWindow = open && now - open.startedAt <= SIMULTANEITY_MS;
  const stillHeld = !held || (open && open.midis.every((m) => held.has(m)));

  if (inWindow && stillHeld) {
    // Same gesture: stack into the open column (dedupe — a retrigger inside the
    // window shouldn't draw the same notehead twice).
    const merged = new Set(open.midis);
    midis.forEach((m) => merged.add(m));
    columns[columns.length - 1] = { ...open, midis: [...merged].sort((a, b) => a - b) };
    return { ...flow, columns, lastOnsetAt: now };
  }

  let recentIois = flow.recentIois;
  if (open) {
    const ioi = now - open.startedAt;
    columns[columns.length - 1] = { ...open, duration: classifyIoi(ioi, baselineOf(recentIois)) };
    recentIois = [...recentIois, ioi].slice(-IOI_MEMORY);
  }
  columns.push({ midis: dedupeSorted(midis), startedAt: now, duration: null });

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
 * Reset the flow once the keyboard has been quiet — unless a key is still down.
 *
 * The hold-off matters now that the display depicts holds: without it, sitting on a
 * final chord wipes the staff 1.6s in, taking the half note with it while the key is
 * still pressed. HELD_CLEAR_MS caps the reprieve so a lost note-off can't freeze the
 * staff indefinitely.
 *
 * Returns the same object when there is nothing to do, so React state that holds a
 * flow won't re-render on every idle tick.
 *
 * @param {{columns: FlowColumn[], lastOnsetAt: number, recentIois: number[]}} flow
 * @param {number} now
 * @param {{held?: {size: number}, idleMs?: number}|number} [opts] - a bare number is
 *   read as `idleMs`, the older signature.
 */
export function clearIfIdle(flow, now, opts = {}) {
  const { held = null, idleMs = IDLE_CLEAR_MS } =
    typeof opts === 'number' ? { idleMs: opts } : opts;
  if (flow.columns.length === 0) return flow;
  const quiet = now - flow.lastOnsetAt;
  if (quiet < idleMs) return flow;
  if (held && held.size > 0 && quiet < HELD_CLEAR_MS) return flow;
  return emptyFlow();
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
 * threshold a closed column would have to clear. That promotion is the only thing on
 * the staff that changes with the clock, and it is why the host needs a tick.
 *
 * @param {{columns: FlowColumn[], recentIois: number[]}} flow
 * @param {number} now
 * @returns {Duration[]}
 */
export function flowDurations(flow, now) {
  const baseline = baselineOf(flow.recentIois);
  return flow.columns.map((c) =>
    c.duration ?? (now - c.startedAt > SLOW_RATIO * baseline ? 'h' : 'q'));
}

export default { emptyFlow, pushOnsets, clearIfIdle, flowColumns, flowDurations, baselineOf, classifyIoi };
