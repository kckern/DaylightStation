/**
 * stintTransfer — move one stint's timeline cells from one person to another.
 *
 * A stint is one occupant on one strap from `startIndex` to "now". A
 * correction ("that was actually X") moves exactly that window; data before it
 * stays with its owner.
 *
 *  - Point series (HR, zone, cadence) move cell by cell. The destination keeps
 *    any cell it already has — it can only have one if it was on a second strap.
 *  - Cumulative series (rings, beats) move by INCREMENT: the source flattens at
 *    its pre-stint value, the destination adds the stint's increments on top of
 *    its own running total. Neither line can drop or jump.
 *
 * Pure apart from mutating the `series` object it is given (the live
 * FitnessTimeline.series, keyed `user:<id>:<metric>`).
 */
export const POINT_METRICS = new Set(['heart_rate', 'zone_id', 'rpm', 'power', 'distance']);
export const CUMULATIVE_METRICS = new Set(['rings_total', 'heart_beats']);

const lastFiniteBefore = (arr, idx) => {
  for (let i = Math.min(idx, arr.length) - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
};

/**
 * @param {Object<string, Array>} series - timeline series (mutated)
 * @param {{ fromUserId: string, toUserId: string, startIndex: number }} opts
 * @returns {{ movedKeys: string[], bases: { rings_total: number, heart_beats: number } }}
 *   `bases` = the source's cumulative value just before the stint (0 if none).
 */
export function moveStintSeries(series, { fromUserId, toUserId, startIndex = 0 } = {}) {
  const result = { movedKeys: [], bases: { rings_total: 0, heart_beats: 0 } };
  if (!series || typeof series !== 'object') return result;
  if (!fromUserId || !toUserId || fromUserId === toUserId) return result;
  const start = Math.max(0, Number.isFinite(startIndex) ? Math.floor(startIndex) : 0);
  const fromPrefix = `user:${fromUserId}:`;

  for (const key of Object.keys(series)) {
    if (!key.startsWith(fromPrefix)) continue;
    const metric = key.slice(fromPrefix.length);
    const isPoint = POINT_METRICS.has(metric);
    const isCumulative = CUMULATIVE_METRICS.has(metric);
    if (!isPoint && !isCumulative) continue;
    const fromArr = series[key];
    if (!Array.isArray(fromArr)) continue;

    const toKey = `user:${toUserId}:${metric}`;
    const toOrig = Array.isArray(series[toKey]) ? [...series[toKey]] : [];
    const len = Math.max(fromArr.length, toOrig.length);
    const toArr = Array.from({ length: len }, (_, i) => (i < toOrig.length ? toOrig[i] : null));

    if (isPoint) {
      for (let i = start; i < fromArr.length; i += 1) {
        if (fromArr[i] == null) continue;
        if (toArr[i] == null) toArr[i] = fromArr[i];
        fromArr[i] = null;
      }
    } else {
      const fromBase = lastFiniteBefore(fromArr, start) ?? 0;
      result.bases[metric] = fromBase;
      let toOwn = lastFiniteBefore(toOrig, start);
      for (let i = start; i < len; i += 1) {
        if (Number.isFinite(toOrig[i])) toOwn = toOrig[i];
        const fromVal = i < fromArr.length ? fromArr[i] : null;
        if (!Number.isFinite(fromVal)) continue;
        const inc = Math.max(0, fromVal - fromBase);
        toArr[i] = (toOwn ?? 0) + inc;
        fromArr[i] = fromBase;
      }
    }
    series[toKey] = toArr;
    result.movedKeys.push(key);
  }
  return result;
}

export default moveStintSeries;
