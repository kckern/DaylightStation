/**
 * Clip items cut from indexed recordings: one queue item per timed segment of
 * a surround sidecar, playing only its own window (`segment: { start, end }`,
 * which the player already honours).
 *
 * Pure. The sidecars arrive already paired with their work's segments (see
 * YamlSurroundSegmentReader); the rng is injected so a shuffle is testable.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const hasSong = (item) => typeof item?.song === 'string' && item.song !== '';
const sameSong = (a, b) => hasSong(a) && hasSong(b) && a.song === b.song;

/**
 * @typedef {Object} SegmentSidecar
 * @property {string} contentId - The recording the clips are cut from
 * @property {string} [title] - The recording's (work's) title
 * @property {number|string} [year]
 * @property {Array<{ n: number, name: string, kind?: string, song?: string,
 *   start: number, end: number, confidence?: string }>} segments
 */

/** Fisher-Yates over a copy. */
function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Re-order so no two neighbours share a `song`, when that is possible.
 *
 * Greedy: walking left to right, a repeat is swapped with the first later item
 * that differs from its left neighbour. A repeat with nothing left to swap (the
 * tail) is moved back into the first gap whose two sides both differ from it.
 * When neither exists the item stays where it is: some inputs (one song making
 * up most of the list) cannot be separated, and the queue still plays.
 *
 * @param {Array<{song?: string}>} items
 * @returns {Array} A new array
 */
export function avoidNeighbourRepeats(items) {
  const out = [...asArray(items)];
  for (let i = 1; i < out.length; i += 1) {
    if (!sameSong(out[i], out[i - 1])) continue;
    const j = out.findIndex((candidate, k) => k > i && !sameSong(candidate, out[i - 1]));
    if (j !== -1) {
      [out[i], out[j]] = [out[j], out[i]];
      continue;
    }
    const item = out[i];
    const rest = [...out.slice(0, i), ...out.slice(i + 1)];
    const gap = rest.findIndex((right, k) => k < i && !sameSong(item, right) && (k === 0 || !sameSong(item, rest[k - 1])));
    if (gap === -1) continue;
    rest.splice(gap, 0, item);
    out.splice(0, out.length, ...rest);
    // A move only ever removes a repeat (both sides of the gap differ), so
    // re-walking from the start terminates.
    i = 0;
  }
  return out;
}

/**
 * Turn sidecars into shuffled clip items.
 *
 * @param {Object} options
 * @param {SegmentSidecar[]} options.sidecars
 * @param {Object} [options.params]
 * @param {string[]} [options.params.kinds] - Keep only these segment kinds (all when absent)
 * @param {string[]} [options.params.confidence] - Keep only these confidence levels (all when absent)
 * @param {boolean} [options.params.noRepeatSong] - Keep two clips of the same song apart
 * @param {() => number} options.rng - Uniform [0, 1)
 * @returns {Array<{ id: string, contentId: string, title: string, subtitle: string,
 *   segment: { start: number, end: number }, duration: number, song?: string }>}
 */
export function segmentItems({ sidecars, params = {}, rng } = {}) {
  const kinds = Array.isArray(params?.kinds) ? new Set(params.kinds) : null;
  const confidence = Array.isArray(params?.confidence) ? new Set(params.confidence) : null;

  const items = [];
  for (const sidecar of asArray(sidecars)) {
    if (!sidecar?.contentId) continue;
    const contentId = String(sidecar.contentId);
    const title = typeof sidecar.title === 'string' ? sidecar.title : '';
    const year = sidecar.year ?? null;
    const subtitle = year != null && year !== '' ? `${title} (${year})` : title;
    for (const segment of asArray(sidecar.segments)) {
      if (!segment) continue;
      if (kinds && !kinds.has(segment.kind)) continue;
      if (confidence && !confidence.has(segment.confidence)) continue;
      const { start, end } = segment;
      if (!isFiniteNumber(start) || !isFiniteNumber(end) || start < 0 || end <= start) continue;
      items.push({
        id: `${contentId}#${segment.n}`,
        contentId,
        title: segment.name,
        subtitle,
        segment: { start, end },
        duration: end - start,
        ...(hasSong(segment) ? { song: segment.song } : {}),
      });
    }
  }

  const shuffled = typeof rng === 'function' ? shuffle(items, rng) : items;
  return params?.noRepeatSong ? avoidNeighbourRepeats(shuffled) : shuffled;
}

export default segmentItems;
