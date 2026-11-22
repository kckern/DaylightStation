/**
 * linkCurve — a fresh "connecting" motion for each play of the provenance scene.
 *
 * The two lines reach toward the centre over the hold (`linkMs`). They should
 * read as a connection being made, not a progress bar: bursts of progress,
 * dead stops where the whole link waits (both lines freeze, the dots slow and
 * dim), and the odd hang on one side only. Nothing about it repeats from play
 * to play, yet the lines always arrive exactly when the hold ends.
 *
 *   makeLinkPlan(linkMs, random) -> {
 *     left, right:  [{ at: 0..1, width: 0..REACH_PERCENT }]  keyframes per side
 *     stalls:       [[startMs, endMs]]  when both sides are stopped (the dots react)
 *   }
 *
 * Pure: `random` is injectable, so a seeded generator gives the same plan.
 *
 * Reference: __docs/reference/media/provenance.md
 */

/** How far each line reaches during the hold (% of the scene width); 50% meets. */
export const REACH_PERCENT = 44;

export const LINK_PLAN = Object.freeze({
  sharedStalls: [1, 2],       // stops where the whole link waits (2 only on longer holds)
  sharedStallMs: [700, 1800],
  sideHiccupChance: 0.6,      // per side: an extra hang on that side alone
  sideHiccupMs: [400, 1100],
  stallBudget: 0.42,          // stops never take more than this share of the hold
  window: [0.1, 0.86],        // stops fall inside this part of the hold, so it starts and ends moving
  edgeJitterMs: 160,          // the two sides of a shared stop never freeze on the same frame
  longHoldMs: 7000,           // holds at least this long may get a second shared stop
  minSharedStallMs: 300,      // shorter overlaps of the two sides' stops are not a wait
});

const between = (random, [lo, hi]) => lo + random() * (hi - lo);

/** Sort and merge overlapping [start, end] intervals. */
export function mergeIntervals(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Where two sets of merged intervals overlap. */
export function intersectIntervals(a, b) {
  const out = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i += 1; else j += 1;
  }
  return out;
}

/** Shared stops: one or two, each placed at random inside its own slot of the window. */
function pickSharedStalls(linkMs, random, plan) {
  const [winA, winB] = plan.window.map((f) => f * linkMs);
  const maxCount = linkMs >= plan.longHoldMs ? plan.sharedStalls[1] : plan.sharedStalls[0];
  const count = plan.sharedStalls[0] + Math.floor(random() * (maxCount - plan.sharedStalls[0] + 1));
  // Leave room in the budget for each side's jitter and hiccup.
  const budget = plan.stallBudget * linkMs * 0.6;
  let lengths = Array.from({ length: count }, () => between(random, plan.sharedStallMs));
  const total = lengths.reduce((s, v) => s + v, 0);
  if (total > budget) lengths = lengths.map((v) => (v * budget) / total);
  const slot = (winB - winA) / count;
  return lengths.map((len, k) => {
    const room = Math.max(0, slot - len);
    const start = winA + k * slot + random() * room;
    return [start, start + Math.min(len, slot)];
  });
}

/**
 * One side's stops: each shared stop widened a little at either edge (so the
 * two sides never freeze or move off on the same frame, while both are always
 * stopped through the shared core), plus, maybe, a hiccup of its own. A hiccup
 * that would take the side over the stop budget is left out.
 */
function sideStalls(linkMs, shared, random, plan) {
  const [winA, winB] = plan.window.map((f) => f * linkMs);
  const widen = () => random() * plan.edgeJitterMs;
  const own = shared.map(([a, b]) => [Math.max(winA, a - widen()), Math.min(winB, b + widen())]);
  const budget = plan.stallBudget * linkMs;
  const total = (list) => list.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (random() < plan.sideHiccupChance) {
    const len = between(random, plan.sideHiccupMs);
    const start = winA + random() * Math.max(0, winB - winA - len);
    const withHiccup = mergeIntervals([...own, [start, start + len]]);
    if (total(withHiccup) <= budget) return withHiccup;
  }
  return mergeIntervals(own);
}

/**
 * Keyframes for one side: frozen through each stop, bursting in between. Each
 * moving stretch gets a random share of the reach and a kink (a quick start
 * then a crawl, or a crawl then a lunge).
 */
function sideKeyframes(linkMs, stalls, random) {
  const moves = [];
  let cursor = 0;
  for (const [a, b] of stalls) {
    if (a > cursor) moves.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < linkMs) moves.push([cursor, linkMs]);
  const weights = moves.map(([a, b]) => (b - a) * (0.45 + random() * 1.1));
  const sum = weights.reduce((s, v) => s + v, 0) || 1;

  const frames = [{ at: 0, width: 0 }];
  let width = 0;
  const push = (ms, w) => {
    const at = Math.min(1, Math.max(0, ms / linkMs));
    const last = frames[frames.length - 1];
    if (at <= last.at) { last.width = Math.max(last.width, w); return; }
    frames.push({ at, width: w });
  };
  moves.forEach(([a, b], k) => {
    const gain = (weights[k] / sum) * REACH_PERCENT;
    push(a, width); // the stop before this stretch holds its width
    const kinkAt = a + (b - a) * (0.25 + random() * 0.5);
    const kinkShare = random() < 0.5 ? 0.55 + random() * 0.3 : 0.15 + random() * 0.25;
    push(kinkAt, width + gain * kinkShare);
    width += gain;
    push(b, width);
  });
  const last = frames[frames.length - 1];
  if (last.at < 1) frames.push({ at: 1, width: REACH_PERCENT });
  frames[frames.length - 1].width = REACH_PERCENT;
  return frames.map((f) => ({ at: +f.at.toFixed(4), width: +Math.min(REACH_PERCENT, f.width).toFixed(2) }));
}

export function makeLinkPlan(linkMs, random = Math.random, plan = LINK_PLAN) {
  const ms = Math.max(1000, Number(linkMs) || 0);
  const shared = pickSharedStalls(ms, random, plan);
  const left = sideStalls(ms, shared, random, plan);
  const right = sideStalls(ms, shared, random, plan);
  return {
    linkMs: ms,
    left: sideKeyframes(ms, left, random),
    right: sideKeyframes(ms, right, random),
    // Only a real wait counts (a side's hiccup can brush the other's stop for a few ms).
    stalls: intersectIntervals(left, right)
      .filter(([a, b]) => b - a >= plan.minSharedStallMs)
      .map(([a, b]) => [Math.round(a), Math.round(b)]),
  };
}

/** CSS @keyframes for one side's frames. */
export function keyframesCss(name, frames) {
  const steps = frames.map((f) => `${+(f.at * 100).toFixed(2)}%{width:${f.width}%}`).join('');
  return `@keyframes ${name}{${steps}}`;
}
