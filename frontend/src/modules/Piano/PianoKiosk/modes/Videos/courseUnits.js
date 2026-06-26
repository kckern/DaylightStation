// courseUnits.js — group a /playable response into seasons ("units") for
// multi-season courses (e.g. Hoffman Academy's 18 units). Single-season courses
// have no meaningful grouping and return null so the caller renders a flat list.
const num = (v) => {
  if (typeof v === 'string') { const p = parseFloat(v); return Number.isFinite(p) ? p : null; }
  return Number.isFinite(v) ? v : null;
};

/**
 * Group a /playable response into ordered units (seasons). Returns null when the
 * course isn't multi-season (no `parents`, or only a single populated unit) so
 * callers fall back to the flat lecture list.
 *
 * A unit = { id, index, title, thumbnail, items[] }, sorted by season index.
 * Items are bucketed by `parentId`; any item whose season is missing from
 * `parents` falls into a synthesized unit keyed by its own parentId/parentTitle.
 */
export function groupUnits(data) {
  const items = data?.items || [];
  const parents = data?.parents;
  if (!parents || typeof parents !== 'object') return null;

  const units = new Map();
  for (const [pid, p] of Object.entries(parents)) {
    units.set(String(pid), {
      id: String(pid),
      index: num(p?.index),
      title: p?.title || '',
      thumbnail: p?.thumbnail || null,
      items: [],
    });
  }

  for (const it of items) {
    const pid = it?.parentId != null ? String(it.parentId) : '__ungrouped';
    let u = units.get(pid);
    if (!u) {
      u = { id: pid, index: num(it?.parentIndex), title: it?.parentTitle || '', thumbnail: null, items: [] };
      units.set(pid, u);
    }
    u.items.push(it);
  }

  const list = [...units.values()].filter((u) => u.items.length > 0);
  list.sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
  return list.length > 1 ? list : null;
}
