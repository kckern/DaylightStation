/**
 * Start-page suggestions — pure rules (RQ-FIND-16, FIND.7a).
 *
 * Rows, in order: Favourites → Carry on → Usually here at this time → New.
 *
 * "Usually here at this time" (owner-adopted definition, requirements O3):
 * play-ledger starts on this screen whose LOCAL start time is within ±90 min
 * of now (wrapping midnight), in the last 30 days, grouped by collection
 * (episode → show, track → album, else the item itself) and ranked by the
 * number of DISTINCT DAYS it played in that window — not play count — with at
 * least 3 days. Each group carries a `continue` part: its newest item.
 *
 * Assembly: ≤ 6 per row, ≤ 20 in all, duplicates removed with precedence
 * favourites > carry on > time of day > new (an item also matches through its
 * show/album), nothing that is playing anywhere or was removed from the
 * household list, empty rows hidden. Nothing at all → `{ rows: [], empty: true }`
 * so the client leads into Browse.
 *
 * @module domains/media/mediaSuggestions
 */

export const SUGGESTION_DEFAULTS = Object.freeze({
  windowMinutes: 90,
  lookbackDays: 30,
  minDistinctDays: 3,
  perRow: 6,
  maxTotal: 20,
});

const DAY_MINUTES = 24 * 60;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;

function parseLocal(text) {
  const m = typeof text === 'string' ? text.match(LOCAL) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return { day: `${m[1]}-${m[2]}-${m[3]}`, dayNumber: Date.UTC(y, mo - 1, d) / 86_400_000, minutes: h * 60 + mi };
}

function groupOf(row) {
  if (row.kind === 'episode' && (row.grandparentId || row.parentId)) {
    return { id: row.grandparentId || row.parentId, kind: 'collection', type: row.grandparentId ? 'show' : 'season' };
  }
  if (row.kind === 'track' && row.parentId) return { id: row.parentId, kind: 'collection', type: 'album' };
  return { id: row.contentId, kind: 'item', type: row.kind ?? null };
}

/**
 * @param {Object[]} rows - play-ledger rows (already limited to the screen(s) asked about)
 * @param {{now: string}} opts - local `YYYY-MM-DD HH:mm:ss`
 * @returns {Array<{id, kind, type, days, lastPlayedAt, continue:{contentId,title}}>}
 */
export function timeOfDayGroups(rows, {
  now,
  windowMinutes = SUGGESTION_DEFAULTS.windowMinutes,
  lookbackDays = SUGGESTION_DEFAULTS.lookbackDays,
  minDistinctDays = SUGGESTION_DEFAULTS.minDistinctDays,
} = {}) {
  const current = parseLocal(now);
  if (!current) return [];
  const groups = new Map();
  for (const row of rows || []) {
    if (!row?.contentId) continue;
    const at = parseLocal(row.localTime);
    if (!at) continue;
    const age = current.dayNumber - at.dayNumber;
    if (age < 0 || age > lookbackDays) continue;
    const diff = Math.abs(at.minutes - current.minutes);
    if (Math.min(diff, DAY_MINUTES - diff) > windowMinutes) continue;
    const group = groupOf(row);
    const entry = groups.get(group.id) || { ...group, dayset: new Set(), lastPlayedAt: null, continue: null };
    entry.dayset.add(at.day);
    if (!entry.lastPlayedAt || row.localTime > entry.lastPlayedAt) {
      entry.lastPlayedAt = row.localTime;
      entry.continue = { contentId: row.contentId, title: row.title ?? null };
    }
    groups.set(group.id, entry);
  }
  return [...groups.values()]
    .filter((g) => g.dayset.size >= minDistinctDays)
    .sort((a, b) => b.dayset.size - a.dayset.size || (b.lastPlayedAt > a.lastPlayedAt ? 1 : -1))
    .map(({ dayset, ...g }) => ({ ...g, days: dayset.size }));
}

/** Every id an entry stands for: itself, its show/album/season, its continue part. */
function keysOf(entry) {
  return [entry.id, entry.parentId, entry.grandparentId, entry.continue?.contentId].filter(Boolean);
}

const ROWS = [
  { id: 'favourites', title: 'Favourites', field: 'favourites' },
  { id: 'carry-on', title: 'Carry on', field: 'carryOn' },
  { id: 'time-of-day', title: null, field: 'timeOfDay' },
  { id: 'new', title: 'New', field: 'fresh' },
];

/**
 * @param {{favourites?, carryOn?, timeOfDay?, fresh?: Object[], timeOfDayLabel?: string,
 *          exclude?: Set<string>, perRow?: number, maxTotal?: number}} input
 *   Entries: `{ id, kind, type, title, thumbnail, parentId?, grandparentId?, continue? , ... }`
 * @returns {{rows: Array<{id, title, items}>, empty: boolean}}
 */
export function assembleSuggestions({
  favourites = [], carryOn = [], timeOfDay = [], fresh = [],
  timeOfDayLabel = 'Usually here at this time',
  exclude = new Set(),
  perRow = SUGGESTION_DEFAULTS.perRow,
  maxTotal = SUGGESTION_DEFAULTS.maxTotal,
} = {}) {
  const source = { favourites, carryOn, timeOfDay, fresh };
  const taken = new Map(); // key → the entry that holds it
  const rows = [];
  let total = 0;
  for (const def of ROWS) {
    const items = [];
    for (const entry of source[def.field] || []) {
      if (!entry?.id) continue;
      const keys = keysOf(entry);
      if (keys.some((k) => exclude.has(k))) continue;
      const holder = keys.map((k) => taken.get(k)).find(Boolean);
      if (holder) {
        // A dropped carry-on episode of a favourite show still says where to resume.
        if (!holder.continue && holder.kind === 'collection' && def.field === 'carryOn' && entry.id !== holder.id) {
          holder.continue = { contentId: entry.id, title: entry.title ?? null };
        }
        continue;
      }
      if (items.length >= perRow || total >= maxTotal) continue;
      const item = { ...entry };
      items.push(item);
      total += 1;
      for (const k of keysOf(item)) taken.set(k, item);
    }
    if (items.length) rows.push({ id: def.id, title: def.title ?? timeOfDayLabel, items });
  }
  return { rows, empty: rows.length === 0 };
}
