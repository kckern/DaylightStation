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
const sameRecording = (a, b) => !!a?.contentId && a.contentId === b?.contentId;

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

const ORDER_APART_BUDGET = 20000;

/**
 * Depth-first: at each step take the first remaining item (in the given order)
 * that differs from the last one placed, backing up when stuck. Keeps the
 * shuffle's order wherever the rule allows it. Bounded: returns null when the
 * budget runs out or no separation exists, and the caller falls back.
 * @returns {Array|null}
 */
function orderApart(items, same) {
  const used = new Array(items.length).fill(false);
  const out = [];
  let steps = 0;
  const place = () => {
    if (out.length === items.length) return true;
    const last = out[out.length - 1];
    for (let k = 0; k < items.length; k += 1) {
      if (used[k] || (last && same(items[k], last))) continue;
      if (++steps > ORDER_APART_BUDGET) return false;
      used[k] = true;
      out.push(items[k]);
      if (place()) return true;
      out.pop();
      used[k] = false;
    }
    return false;
  };
  return place() ? out : null;
}

/**
 * Re-order so no two neighbours are "the same" (by default: share a `song`),
 * when that is possible. Only the very next item is constrained: the one after
 * may repeat freely, so nothing has to cycle through every recording.
 *
 * First a bounded depth-first ordering (orderApart). If that finds nothing,
 * the greedy fallback: walking left to right, a repeat is swapped with the first later item
 * that differs from its left neighbour. A repeat with nothing left to swap (the
 * tail) is moved back into the first gap whose two sides both differ from it.
 * When neither exists the item stays where it is: some inputs (one song making
 * up most of the list) cannot be separated, and the queue still plays.
 *
 * @param {Array<{song?: string, contentId?: string}>} items
 * @param {(a: Object, b: Object) => boolean} [same] - What counts as a repeat
 * @returns {Array} A new array
 */
export function avoidNeighbourRepeats(items, same = sameSong) {
  const apart = orderApart(asArray(items), same);
  if (apart) return apart;
  const out = [...asArray(items)];
  for (let i = 1; i < out.length; i += 1) {
    if (!same(out[i], out[i - 1])) continue;
    const j = out.findIndex((candidate, k) => k > i && !same(candidate, out[i - 1]));
    if (j !== -1) {
      [out[i], out[j]] = [out[j], out[i]];
      continue;
    }
    const item = out[i];
    const rest = [...out.slice(0, i), ...out.slice(i + 1)];
    const gap = rest.findIndex((right, k) => k < i && !same(item, right) && (k === 0 || !same(item, rest[k - 1])));
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
 * @param {boolean} [options.params.noRepeatRecording] - Never follow a clip with
 *   another from the same recording (only the very next clip is constrained)
 * @param {() => number} options.rng - Uniform [0, 1)
 * @returns {Array<{ id: string, contentId: string, title: string, subtitle: string,
 *   segment: { start: number, end: number }, song?: string }>} No `duration`:
 *   a clip plays inside its recording's clock, whose duration the recording
 *   item supplies; the clip's own length is `segment.end - segment.start`.
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
        ...(hasSong(segment) ? { song: segment.song } : {}),
      });
    }
  }

  const shuffled = typeof rng === 'function' ? shuffle(items, rng) : items;
  const rules = [params?.noRepeatSong && sameSong, params?.noRepeatRecording && sameRecording].filter(Boolean);
  if (!rules.length) return shuffled;
  return avoidNeighbourRepeats(shuffled, (a, b) => rules.some((rule) => rule(a, b)));
}

export default segmentItems;
