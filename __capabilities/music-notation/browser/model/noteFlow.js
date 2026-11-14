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

import { splitByHand } from "./handSplit.js";

/**
 * A column is one GESTURE: a roll or struck chord, not a moment. Four numbers decide
 * what joins it, all measured on real playing (spec: ops:docs/_wip/audits/
 * 2026-11-13-current-chord-staff-gestures.md).
 *
 * GAP_MS is the longest silence between consecutive onsets of one gesture, measured
 * from the LAST onset. The old rule measured a 90ms WINDOW from the column's start and
 * caused 989 wrong splits of rolled chords; the held-key rule was not the culprit.
 *
 * 150, measured with the replay harness (--sweep-gap, 340 real takes) together with
 * the legato split below. At 90 this rule split 4,261 of the 5,054 clusters drawn in
 * pieces, all at 91-150ms between notes, and held chords stayed whole only 88.0% of
 * the time. Widening alone would have merged legato: 52.1% of legato steps that lift
 * in sequence landed in one column at 90, 77.4% at 150. With the release split doing
 * that job, 150 keeps 96.0% of chords whole, 92.0% of chords lifted together and
 * 95.1% of held chords, and merges 12.1% of in-sequence legato. The rule used (for
 * GAP_MS, LEGATO_RELEASE_MS and LIFT_TOGETHER_MS alike): both gates (chords,
 * lifted-together) >= 90, held chords >= 95% — the failure that started this — then
 * the fewest in-sequence legato steps merged. At 110 or 130 with release 160 the
 * lifted-together gate fails (89.4%, 90.0%, measured at lift 5), and held chords stay
 * under 95% anyway.
 */
export const GAP_MS = 150;

/**
 * Longest a gesture may run from its first onset. Without it a legato run in which
 * every key is still down daisy-chains into one stack. The owner's gestures have p95
 * 200ms and everyone's p95 244ms; 250ms keeps 99.2% of the owner's and 95.6% of all
 * gestures whole.
 */
export const SPAN_MAX_MS = 250;

/**
 * Legato is not a roll. Timing alone cannot tell them apart: a held roll steps
 * 91-150ms between notes and fast legato 80-85ms, so any GAP_MS wide enough for the
 * one swallows the other. Release can: a rolled chord stays down, a legato line lets
 * each key go just after the next lands. So when every key that landed before some
 * later note of the column has let go, the last within LEGATO_RELEASE_MS of that
 * note landing, and that note stayed down past LIFT_TOGETHER_MS longer, the line
 * moved on: pushReleases splits the column there.
 *
 * 160 (swept at lift 5): at GAP_MS 150, in-sequence legato merged falls 40.0% -> 22.6% -> 11.9% over
 * 80/120/160 while chords kept whole hold at 96.5% -> 96.5% -> 95.9%. Past 160 it buys
 * little and starts to cut held chords: 200 merges 10.4% but held chords drop to
 * 94.3%, 240 to 92.8% (and lifted-together to 89.7%).
 */
export const LEGATO_RELEASE_MS = 160;

/**
 * A later note closer than this to the one before it was struck WITH it, and never
 * opens a legato split. Short struck chords let go as fast as legato does: on the
 * corpus, successive onsets under 15ms apart released 40-60ms later number 12,666 —
 * more than every legato step combined. At GAP_MS 150 / release 160 / lift 5, a 20ms
 * floor keeps 91.2% of chords whole and 86.9% of chords lifted together (the gate
 * fails); 30 keeps 95.9% / 90.6%; 45 keeps 96.1% / 93.9% but merges 26.7% of
 * in-sequence legato instead of 11.9% — a fast scale steps about 40ms.
 */
export const LEGATO_MIN_STEP_MS = 30;

/**
 * Keys let go within this long of each other were lifted TOGETHER: a chord, not a line.
 * Chosen by the replay sweep, not from a valley — there is none. Over successive onsets
 * 30-150ms apart whose first key let go shortly after the second landed, the gap
 * between the two key-ups has one clear peak at 0-5ms (808 pairs) and is then roughly
 * flat at 250-500 per 5ms out to 60ms: legato and a loosely lifted chord overlap. So
 * the sweep decides (GAP_MS 150, release 160): 5/10/15/25ms keep 90.6/92.0/93.5/96.4%
 * of chords lifted together whole and merge 11.9/12.1/12.8/14.1% of in-sequence
 * legato. By the rule on GAP_MS (both gates >= 90, held chords >= 95, then fewest
 * merged) 5 would win, but it clears the lifted-together gate by only 0.6 points on a
 * corpus that grows daily. Ruling: take 10 — 92.0% lifted together whole, a 2-point
 * margin, for +0.2 points of in-sequence legato merged (12.1% vs 11.9%).
 */
export const LIFT_TOGETHER_MS = 10;

/**
 * A STAFF whose arrivals span at least this long is a ROLL and gets an arpeggio
 * stroke; shorter reads as struck. Judged per staff by the renderer (from `arrivals`),
 * because each hand rolls on its own: one column can hold a rolled right hand over a
 * struck left, or two hands rolling in opposite directions.
 */
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

/**
 * Below FAST_RATIO × baseline a column is an eighth; above SLOW_RATIO × baseline, a half.
 *
 * Biased toward eighths on purpose. With no meter, an eighth is the most neutral glyph
 * that still BEAMS, and a line of beamed eighths reads as one phrase where a row of
 * stand-alone quarters reads as loose notes. So a note at your own pace — up to 20%
 * slower — is an eighth; a quarter means clearly held back, a half means a real hold.
 * Measured on the replay harness (340 takes): 0.6/1.5 drew 29.5% of columns as
 * eighths, 0.9/2.0 56.2%, 1.2/2.0 70.5%, 1.5/2.0 77.0% (where quarters all but vanish).
 * 2.0 × BASELINE_MAX_MS = 1600ms keeps a half reachable under the 3000ms idle line.
 */
export const FAST_RATIO = 1.2;
export const SLOW_RATIO = 2.0;

/**
 * How many recent inter-onset intervals feed the baseline. Deliberately longer than
 * COLUMN_CAPACITY: a capacity-8 staff yields at most 7 visible gaps, so a baseline
 * drawn only from what is on screen would be entirely rewritten by a single run.
 */
export const IOI_MEMORY = 16;

/**
 * The baseline is clamped, and BOTH ends of the clamp do real work.
 *
 * The FLOOR anchors the scale to how fast a note actually is. A purely relative
 * baseline follows the player all the way down: play a run at 120ms and the median
 * becomes 120, the eighth threshold 144ms, and a 200ms note inside the run — still
 * quick by any ear — draws as a quarter, breaking the beam. Flooring the baseline at
 * 300ms means anything under 360ms reads as an eighth in any context, which matches
 * how a note that quick actually sounds. Above the floor the ratio does relative work
 * as intended.
 *
 * The CEILING keeps half notes reachable. A half needs a gap longer than
 * SLOW_RATIO × baseline, but a gap of IDLE_CLEAR_MS starts a fresh line first, so a
 * baseline above ~1500ms would put the half threshold past the clear and no half
 * could ever draw. 2.0 × 800 = 1600ms, a wide margin under the 3000ms idle line.
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
/** @typedef {{ midi: number, at: number }} Arrival */
/** @typedef {{ midis: number[], arrivals: Arrival[], startedAt: number, lastOnsetAt: number, duration: Duration|null, heldAtClose: boolean, releasedAt: number|null, releases?: Record<number, number> }} FlowColumn */

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
 * Judge the gap that closes a column against "how you have been playing" — the
 * baseline as it stood BEFORE this gap joins the history — and record the gap.
 *
 * The first gap of a phrase has no history. Judging it against a bare 500ms default
 * made a uniform 250ms passage open with a half-or-eighth quirk; clamping the gap
 * itself (but never above the default) makes it read like its successors.
 *
 * @returns {{ duration: Duration, recentIois: number[] }}
 */
function judgeGap(ioi, recentIois) {
  const baseline = recentIois.length
    ? baselineOf(recentIois)
    : Math.min(DEFAULT_BASELINE_MS, clamp(ioi, BASELINE_MIN_MS, BASELINE_MAX_MS));
  return { duration: classifyIoi(ioi, baseline), recentIois: [...recentIois, ioi].slice(-IOI_MEMORY) };
}

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
 * `arrivals` records every note the column took, with its onset time, in arrival order
 * (a batch's notes share one time and go in ascending pitch). The renderer splits them
 * by staff and reads each hand's roll — its span and direction — from them. A single
 * column-wide first/last pair could not: in a two-hand roll the first arrival is often
 * the bass and the last the treble, which says nothing about either hand.
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
 * @param {{held?: {has: (n: number) => boolean}, capacity?: number, gapMs?: number, spanMs?: number}} [opts]
 *   `held` is the live key-down surface (an activeNotes Map works). Omit it to skip
 *   the overlap test entirely — time alone then decides, as it used to. `gapMs` and
 *   `spanMs` override GAP_MS and SPAN_MAX_MS (the replay harness sweeps the gap).
 * @returns {{columns: FlowColumn[], lastOnsetAt: number, recentIois: number[]}} a NEW flow (never mutated)
 */
export function pushOnsets(flow, midis, now, opts = {}) {
  if (!midis || midis.length === 0) return flow;
  const { held = null, capacity = COLUMN_CAPACITY, gapMs = GAP_MS, spanMs = SPAN_MAX_MS } = opts;

  // A breath longer than IDLE_CLEAR_MS ends the phrase: start a fresh line, and
  // record no IOI across the silence (it would poison the baseline).
  if (flow.columns.length > 0 && now - flow.lastOnsetAt > IDLE_CLEAR_MS) flow = emptyFlow();

  const columns = flow.columns.slice();
  const open = columns[columns.length - 1];

  const sorted = dedupeSorted(midis);
  const arrived = sorted.map((midi) => ({ midi, at: now }));

  const joins = open
    && now - open.lastOnsetAt <= gapMs
    && now - open.startedAt <= spanMs
    && (!held || open.midis.every((m) => held.has(m)))
    && !sorted.some((m) => open.midis.includes(m))
    && open.midis.length + sorted.length <= MAX_COLUMN_NOTES;

  if (joins) {
    columns[columns.length - 1] = {
      ...open,
      midis: dedupeSorted([...open.midis, ...sorted]),
      arrivals: [...(open.arrivals ?? []), ...arrived],
      lastOnsetAt: now,
    };
    return { ...flow, columns, lastOnsetAt: now };
  }

  let recentIois = flow.recentIois;
  if (open) {
    const judged = judgeGap(now - open.startedAt, recentIois);
    // heldAtClose: every key still down as the next column opens means the gap to it
    // says nothing about how long the column lasts — pushReleases/flowDurations judge
    // the hold instead.
    columns[columns.length - 1] = {
      ...open,
      duration: judged.duration,
      heldAtClose: !!held && open.midis.every((m) => held.has(m)),
    };
    recentIois = judged.recentIois;
  }
  columns.push({
    midis: sorted, arrivals: arrived, startedAt: now, lastOnsetAt: now,
    duration: null, heldAtClose: false, releasedAt: null, releases: {},
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

/** The young columns: the only ones a release can still split. */
const youngFrom = (flow) => Math.max(0, flow.columns.length - 2);

/**
 * Whether a column has anywhere a legato split could fall: some arrival at least
 * `minStepMs` after the one before it. A struck chord (every key within the floor of
 * the last) never splits, so its releases are not worth recording — recording them
 * would hand React a new flow, and a re-render, on every key-up for nothing.
 */
const canSplit = (column, minStepMs) => (column.arrivals ?? []).some(
  (a, k, arr) => k > 0 && a.at - arr[k - 1].at >= minStepMs,
);

/**
 * Note when each key of a young column lets go. The staff never sees note-offs, only
 * the key-down surface, so a key that is in a young column, no longer down, and not
 * yet recorded was released now. Older columns are left alone: their arrivals are all
 * more than one column back, so no release can split them any more.
 */
function recordReleases(flow, now, held, minStepMs) {
  let columns = null;
  for (let i = youngFrom(flow); i < flow.columns.length; i += 1) {
    const c = flow.columns[i];
    if (!canSplit(c, minStepMs)) continue;
    const releases = c.releases ?? {};
    const gone = c.midis.filter((m) => !held.has(m) && releases[m] === undefined);
    if (!gone.length) continue;
    columns ||= flow.columns.slice();
    columns[i] = { ...c, releases: { ...releases, ...Object.fromEntries(gone.map((m) => [m, now])) } };
  }
  return columns ? { ...flow, columns } : flow;
}

/**
 * Where a young column was really a legato line: the earliest arrival time T at which
 * the line MOVED ON —
 *   - T landed at least `minStepMs` after the arrival before it (closer is one strike);
 *   - every key that landed before T has let go, the last within `legatoMs` of T;
 *   - and the key that landed at T was still down more than `liftMs` after that last
 *     release. Legato lifts in sequence; a chord, rolled or not, lifts together, and a
 *     staccato roll lifted at once must stay one column.
 * The last test cannot be passed at the instant the earlier key lets go, so a split
 * is decided at the first pushReleases call after `liftMs` has passed — the next key
 * event or the 80ms tick, whichever comes first — while the column is still one of
 * the two young ones. Null when the column is a chord (or not decided yet).
 */
function legatoSplitAt(column, now, legatoMs, minStepMs, liftMs) {
  const arrivals = column.arrivals ?? [];
  const releases = column.releases ?? {};
  for (let k = 1; k < arrivals.length; k += 1) {
    const t = arrivals[k].at;
    if (t - arrivals[k - 1].at < minStepMs) continue;
    const before = arrivals.slice(0, k);
    if (!before.every((a) => releases[a.midi] !== undefined)) continue;
    const lastLift = Math.max(...before.map((a) => releases[a.midi]));
    if (lastLift - t > legatoMs) continue;
    const own = releases[arrivals[k].midi];
    const stillDown = own === undefined ? now - lastLift > liftMs : own - lastLift > liftMs;
    if (stillDown) return t;
  }
  return null;
}

/**
 * Split young column i at arrival time t into the notes that landed before it and the
 * notes from it on, re-judging both with pushOnsets' rules as if t had opened a column:
 * the gap it inserts goes into `recentIois` in place of the one the merged column had.
 */
function splitColumn(flow, i, t, capacity) {
  const c = flow.columns[i];
  const isNewest = i === flow.columns.length - 1;
  const next = flow.columns[i + 1];
  const piece = (keep) => {
    const arrivals = (c.arrivals ?? []).filter(keep);
    const midis = dedupeSorted(arrivals.map((a) => a.midi));
    const releases = Object.fromEntries(Object.entries(c.releases ?? {}).filter(([m]) => midis.includes(Number(m))));
    const heldUntil = (time) => midis.every((m) => releases[m] === undefined || releases[m] >= time);
    return { midis, arrivals, releases, heldUntil, startedAt: arrivals[0].at, lastOnsetAt: Math.max(...arrivals.map((a) => a.at)) };
  };
  const { heldUntil: heldA, ...a } = piece((x) => x.at < t);
  const { heldUntil: heldB, ...b } = piece((x) => x.at >= t);

  // A closed column's own gap is the last one recorded (the newest column opened after it).
  let recentIois = isNewest ? flow.recentIois : flow.recentIois.slice(0, -1);
  const first = judgeGap(b.startedAt - a.startedAt, recentIois);
  recentIois = first.recentIois;
  const before = { ...c, ...a, duration: first.duration, heldAtClose: heldA(b.startedAt), releasedAt: null };
  let after = { ...c, ...b, duration: null, heldAtClose: false, releasedAt: null };
  if (!isNewest) {
    const second = judgeGap(next.startedAt - b.startedAt, recentIois);
    recentIois = second.recentIois;
    after = { ...after, duration: second.duration, heldAtClose: heldB(next.startedAt) };
  }
  const columns = [...flow.columns.slice(0, i), before, after, ...flow.columns.slice(i + 1)];
  const overflow = columns.length - capacity;
  return { ...flow, columns: overflow > 0 ? columns.slice(overflow) : columns, recentIois };
}

/**
 * Release bookkeeping. Two jobs.
 *
 * LEGATO SPLIT: a young column — the newest or second-newest — in which every key
 * that landed before some later key (>= LEGATO_MIN_STEP_MS after the one before it)
 * has let go, the last of them within LEGATO_RELEASE_MS of that later key landing,
 * while that later key stayed down more than LIFT_TOGETHER_MS longer, was a legato
 * line, not a chord: split at that later arrival. The second-newest counts because
 * the split is only decided at the first call after the lift window — the next key
 * event or the 80ms tick, whichever comes first — and that key event may be the very
 * onset that closed the column. Columns further back never change shape, so what has
 * been drawn stays drawn.
 *
 * HOLDS: a closed column that was fully held when it closed is released once none of
 * its keys is down, or once a later column re-strikes one of its pitches (a re-strike
 * implies the earlier note let go). On release the duration is fixed: promoted to a
 * half if the hold outlasted SLOW_RATIO × baseline, otherwise left as its IOI
 * duration. Upward only.
 *
 * @param {{columns: FlowColumn[], recentIois: number[]}} flow
 * @param {number} now
 * @param {{has: (n: number) => boolean}} held
 * @param {{capacity?: number, legatoReleaseMs?: number, legatoMinStepMs?: number, liftTogetherMs?: number}} [opts]
 *   capacity must match the one given to pushOnsets; the others override
 *   LEGATO_RELEASE_MS, LEGATO_MIN_STEP_MS and LIFT_TOGETHER_MS (the replay harness
 *   sweeps them).
 * @returns the SAME flow when nothing changed
 */
export function pushReleases(flow, now, held, opts = {}) {
  const {
    capacity = COLUMN_CAPACITY, legatoReleaseMs = LEGATO_RELEASE_MS,
    legatoMinStepMs = LEGATO_MIN_STEP_MS, liftTogetherMs = LIFT_TOGETHER_MS,
  } = opts;
  // The idle-tick fast path: with no young column a release could split and no closed
  // hold waiting to be released, there is nothing to do — return before allocating.
  // This runs every 80ms for as long as a line sits on screen.
  let busy = false;
  for (let i = 0; i < flow.columns.length && !busy; i += 1) {
    const c = flow.columns[i];
    busy = (i < flow.columns.length - 1 && c.heldAtClose && c.releasedAt === null)
      || (i >= youngFrom(flow) && canSplit(c, legatoMinStepMs));
  }
  if (!busy) return flow;
  flow = recordReleases(flow, now, held, legatoMinStepMs);
  // Each split moves at least one note into a new column, so this ends; the guard is
  // only a backstop.
  for (let guard = 0; guard < MAX_COLUMN_NOTES * 2; guard += 1) {
    let split = false;
    for (let i = youngFrom(flow); i < flow.columns.length; i += 1) {
      const t = legatoSplitAt(flow.columns[i], now, legatoReleaseMs, legatoMinStepMs, liftTogetherMs);
      if (t === null) continue;
      flow = splitColumn(flow, i, t, capacity);
      split = true;
      break;
    }
    if (!split) break;
  }

  // Copied only once a hold actually releases, so a call that changes nothing
  // allocates nothing here.
  let columns = null;
  const baseline = baselineOf(flow.recentIois);
  for (let i = 0; i < flow.columns.length - 1; i += 1) {
    const c = flow.columns[i];
    if (!c.heldAtClose || c.releasedAt !== null) continue;
    const restruck = flow.columns.slice(i + 1).some((later) => later.midis.some((m) => c.midis.includes(m)));
    if (!restruck && c.midis.some((m) => held.has(m))) continue;
    // A young column's recorded key-ups are the real release time; `now` can be a
    // later key event (a legato split is settled one event after the lift).
    const recorded = c.midis.map((m) => c.releases?.[m]);
    const releasedAt = !restruck && recorded.every((r) => r !== undefined) ? Math.max(...recorded) : now;
    columns ||= flow.columns.slice();
    columns[i] = {
      ...c,
      releasedAt,
      duration: releasedAt - c.startedAt > SLOW_RATIO * baseline ? 'h' : c.duration,
    };
  }
  return columns ? { ...flow, columns } : flow;
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
 * an eighth provisionally — so a run beams as it is played — and grows to a quarter,
 * then a half, as the clock passes the same thresholds a closed column's gap would
 * have to clear. A closed column that was fully held
 * when it closed and has not been released yet promotes the same way (its stored
 * duration is only the IOI guess). Those promotions are the only things on the staff
 * that change with the clock, and why the host needs a tick. Upward only.
 *
 * @param {{columns: FlowColumn[], recentIois: number[]}} flow
 * @param {number} now
 * @param {Duration[]} [prev] - the last answer; returned as-is when nothing changed
 * @returns {Duration[]}
 */
export function flowDurations(flow, now, prev) {
  const baseline = baselineOf(flow.recentIois);
  const longHold = (c) => now - c.startedAt > SLOW_RATIO * baseline;
  const at = (c) => {
    if (c.duration === null) return classifyIoi(now - c.startedAt, baseline);
    if (c.heldAtClose && c.releasedAt === null && longHold(c)) return 'h';
    return c.duration;
  };
  // With `prev`, an unchanged answer is `prev` itself and nothing is allocated — the
  // host's 80ms tick asks this of every column on screen, every tick.
  const n = flow.columns.length;
  if (prev && prev.length === n) {
    let i = 0;
    while (i < n && prev[i] === at(flow.columns[i])) i += 1;
    if (i === n) return prev;
  }
  return flow.columns.map(at);
}

/**
 * One staff's roll from the column's arrivals: 'up' / 'down', or null when the staff
 * was struck. A staff holding ONE note has nothing to arpeggiate — the stroke would be
 * a stray squiggle beside a lone note — so it needs two or more heads. Its own
 * arrivals must span ROLL_MARK_MS; direction is the pitch of its first arrival
 * against its last.
 *
 * Lives with the model, not the renderer, so the replay harness counts exactly the
 * strokes the staff draws.
 *
 * @param {Arrival[]} arrivals - the column's, in arrival order
 * @param {number[]} staffMidis - the notes one staff holds (before any ottava shift)
 * @returns {'up'|'down'|null}
 */
export function staffRoll(arrivals, staffMidis) {
  if (staffMidis.length < 2 || !arrivals?.length) return null;
  const mine = new Set(staffMidis);
  const own = arrivals.filter((a) => mine.has(a.midi));
  if (own.length < 2) return null;
  const times = own.map((a) => a.at);
  if (Math.max(...times) - Math.min(...times) < ROLL_MARK_MS) return null;
  const first = own[0].midi;
  const last = own[own.length - 1].midi;
  return last > first ? 'up' : 'down';
}

/**
 * Both staves' rolls for one column, split by hand exactly as the staff splits it —
 * for callers outside the renderer (the live log, the replay harness) that report
 * what the staff draws.
 * @param {{ midis: number[], arrivals?: Arrival[] }} column
 * @returns {{ treble: 'up'|'down'|null, bass: 'up'|'down'|null }}
 */
export function columnRolls(column) {
  const { trebleNotes, bassNotes } = splitByHand([...column.midis].sort((a, b) => a - b));
  return { treble: staffRoll(column.arrivals, trebleNotes), bass: staffRoll(column.arrivals, bassNotes) };
}

export default { emptyFlow, staffRoll, columnRolls, pushOnsets, pushReleases, clearIfIdle, flowColumns, flowDurations, baselineOf, classifyIoi };
