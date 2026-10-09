/**
 * mergePresentation — overlay a game's `presentation` block onto the system's.
 *
 * Bezel layout (screen cutout, hotspots, overlays, shader/chrome) is defined
 * once per system; a game may override or extend it. Scalars take the game
 * value when present; the `hotspots`/`overlays` arrays merge BY `id` — a game
 * entry shallow-merges over the matching system entry (with a deep-merged
 * `region`), unmatched system entries are kept, and new ids are appended.
 *
 * Pure + dependency-free so it stays trivially testable.
 *
 * @param {object} [systemPres]
 * @param {object} [gamePres]
 * @returns {object} merged presentation
 */
export function mergePresentation(systemPres = {}, gamePres = {}) {
  const base = systemPres && typeof systemPres === 'object' ? systemPres : {};
  const over = gamePres && typeof gamePres === 'object' ? gamePres : {};

  const merged = { ...base, ...over };

  if (base.hotspots || over.hotspots) {
    merged.hotspots = mergeById(base.hotspots, over.hotspots);
  }
  if (base.overlays || over.overlays) {
    merged.overlays = mergeById(base.overlays, over.overlays);
  }

  return merged;
}

function mergeById(baseList = [], overList = []) {
  const result = (baseList || []).map((item) => ({ ...item }));
  const indexById = new Map(result.map((item, i) => [item.id, i]));

  for (const item of overList || []) {
    const at = indexById.get(item.id);
    if (at === undefined) {
      result.push({ ...item });
      continue;
    }
    const existing = result[at];
    result[at] = {
      ...existing,
      ...item,
      region: { ...(existing.region || {}), ...(item.region || {}) },
    };
  }

  return result;
}

export default mergePresentation;
