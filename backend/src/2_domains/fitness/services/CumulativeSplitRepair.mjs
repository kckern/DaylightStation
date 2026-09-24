/**
 * CumulativeSplitRepair — undo the split the pre-stint live transfer left in
 * saved fitness sessions.
 *
 * Before 2026-09-23 a strap correction moved a child's timeline but not their
 * ring/beat counters, so on the next tick one person's cumulative series
 * DROPPED by D while, within a tick or two, another person's JUMPED by about D.
 * The rings were never lost — they were split. This pass pairs each drop with
 * its jump and cancels both: the dropping person's line continues from where
 * it was, the jumping person's line loses the jump.
 *
 * The HR trace decides ownership: the live transfer had already moved HR to
 * whoever really wore the strap, so a drop is only repaired when that person
 * has HR just before it. A drop with no matching jump is reported, never
 * guessed at. A cumulative series has no legitimate negative step, so every
 * negative step is a candidate.
 *
 * Operates on DECODED on-disk series (`<id>:rings|coins|beats`, plain arrays).
 * Pure apart from mutating the `decoded` object it is given.
 */
const METRICS = ['rings', 'coins', 'beats'];
const RESERVED_PREFIX = /^(device|bike|vib|global):/;
const PAIR_WINDOW_TICKS = 3;
const HR_LOOKBACK_TICKS = 10;
const tolerance = (amount) => Math.max(2, amount * 0.05);
// Largest step a rider can earn legitimately in one tick. Ring awards top out
// at a handful per interval and beats at ~17 per 5 s (200 bpm); a jump above
// this on a rider who was already broadcasting cannot be their own effort.
const MAX_OWN_STEP = { rings: 10, coins: 10, beats: 20 };
const round1 = (v) => Math.round(v * 10) / 10;

const lastFiniteBefore = (arr, idx) => {
  for (let k = idx - 1; k >= 0; k -= 1) if (Number.isFinite(arr[k])) return arr[k];
  return null;
};

function steps(arr) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += 1) {
    if (!Number.isFinite(arr[i])) continue;
    const prev = lastFiniteBefore(arr, i);
    if (prev == null) continue;
    out.push({ tick: i, delta: arr[i] - prev });
  }
  return out;
}

/**
 * @param {Object<string, Array>} decoded - decoded on-disk series (mutated)
 * @param {{ hrOf?: (id: string) => Array }} [options]
 * @returns {{
 *   repairs: Array<{ metric: string, from: string, to: string, tick: number, amount: number }>,
 *   unpaired: Array<{ key: string, tick: number, drop: number }>
 * }} `from` lost the jump; `to` got its line back.
 */
export function repairCumulativeSplits(decoded, { hrOf } = {}) {
  const repairs = [];
  const unpaired = [];
  if (!decoded || typeof decoded !== 'object') return { repairs, unpaired };

  for (const metric of METRICS) {
    const suffix = `:${metric}`;
    const ids = Object.keys(decoded)
      .filter((k) => k.endsWith(suffix) && !RESERVED_PREFIX.test(k) && Array.isArray(decoded[k]))
      .map((k) => k.slice(0, -suffix.length));

    for (const to of ids) {
      const toKey = `${to}${suffix}`;
      for (const drop of steps(decoded[toKey]).filter((s) => s.delta < 0)) {
        const amount = -drop.delta;
        const hr = typeof hrOf === 'function' ? (hrOf(to) || []) : [];
        const hadHr = hr.slice(Math.max(0, drop.tick - HR_LOOKBACK_TICKS), drop.tick)
          .some((v) => Number.isFinite(v) && v > 0);

        let match = null;
        for (const from of ids) {
          if (from === to) continue;
          const jump = steps(decoded[`${from}${suffix}`]).find((s) => s.delta > 0
            && Math.abs(s.tick - drop.tick) <= PAIR_WINDOW_TICKS
            && Math.abs(s.delta - amount) <= tolerance(amount));
          if (!jump) continue;
          // A split lands on someone who was NOT riding yet, or lands a jump
          // no rider could earn in one tick. Anything else is a coincidence
          // with an ordinary award and must not be charged.
          const fromHr = typeof hrOf === 'function' ? (hrOf(from) || []) : [];
          const fromWasRiding = fromHr.slice(Math.max(0, jump.tick - HR_LOOKBACK_TICKS), jump.tick)
            .some((v) => Number.isFinite(v) && v > 0);
          if (fromWasRiding && jump.delta <= MAX_OWN_STEP[metric]) continue;
          match = { from, tick: jump.tick };
          break;
        }
        if (!match || !hadHr) {
          unpaired.push({ key: toKey, tick: drop.tick, drop: round1(amount) });
          continue;
        }

        const toArr = decoded[toKey];
        for (let i = drop.tick; i < toArr.length; i += 1) {
          if (Number.isFinite(toArr[i])) toArr[i] += amount;
        }
        const fromArr = decoded[`${match.from}${suffix}`];
        const floor = lastFiniteBefore(fromArr, match.tick) ?? 0;
        for (let i = match.tick; i < fromArr.length; i += 1) {
          if (Number.isFinite(fromArr[i])) fromArr[i] = Math.max(floor, fromArr[i] - amount);
        }
        repairs.push({ metric, from: match.from, to, tick: drop.tick, amount: round1(amount) });
      }
    }
  }
  return { repairs, unpaired };
}

export default repairCumulativeSplits;
