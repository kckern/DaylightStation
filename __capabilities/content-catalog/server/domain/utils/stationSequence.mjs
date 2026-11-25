// __backend/src/2_domains/content/utils/stationSequence.mjs

/**
 * Station sequences — a queue-ordering rule a playlist carries in its sidecar.
 *
 * A radio-station playlist opens with its jingle and plays songs in shuffle;
 * optionally a station ID drops in between songs. Plex playlists cannot be
 * tagged, so the rule lives in a YAML `sequence:` block keyed by the playlist's
 * content id (see YamlSequenceStore), and these pure functions apply it.
 *
 * The ordering is split in three so the existing queue policy is not bypassed:
 * the HEAD is pinned, the REST goes through whatever ordering the caller owns
 * (watch-aware shuffle on the queue route, plain shuffle in a program), and the
 * IDENTS are interleaved into the result. The head is taken out BEFORE the rest
 * is ordered — a jingle is the most-replayed track in its playlist, and the
 * watch-aware shuffle would otherwise bury it at the end.
 *
 * Randomness is always injected; the domain layer owns no ambient entropy.
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isPresent = (v) => v !== undefined && v !== null;
const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;
// Compound content id: `source:localId`.
const asId = (v) => (typeof v === 'string' && /^[a-z][\w-]*:\S+$/i.test(v.trim()) ? v.trim() : null);
const idOf = (it) => (it && isPresent(it.id) ? String(it.id) : '');

function normalizeEvery(v) {
  if (isPositiveInt(v)) return [v, v];
  if (Array.isArray(v) && v.length === 2 && v.every(isPositiveInt)) {
    const [a, b] = v;
    return a <= b ? [a, b] : [b, a];
  }
  return null;
}

const BREAK_ORDERS = new Set(['shuffle', 'sequential']);

/**
 * One break rule: every N items or every M minutes, whichever comes first;
 * `count` items per break, drawn from `pool` shuffled or in pool order.
 * @private
 */
function normalizeBreaks(raw, key, problems) {
  if (!isPlainObject(raw)) {
    problems.push(`${key}-not-a-mapping`);
    return null;
  }
  let every = null;
  if (isPresent(raw.every)) {
    every = normalizeEvery(raw.every);
    if (!every) problems.push(`${key}-every-invalid`);
  }
  let minutes = null;
  if (isPresent(raw.minutes)) {
    if (typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) && raw.minutes > 0) minutes = raw.minutes;
    else problems.push(`${key}-minutes-invalid`);
  }
  if (!isPresent(raw.every) && !isPresent(raw.minutes)) problems.push(`${key}-trigger-missing`);
  let count = [1, 1];
  if (isPresent(raw.count)) {
    const c = normalizeEvery(raw.count);
    if (c) count = c;
    else problems.push(`${key}-count-invalid`);
  }
  let order = 'shuffle';
  if (isPresent(raw.order)) {
    if (BREAK_ORDERS.has(raw.order)) order = raw.order;
    else problems.push(`${key}-order-invalid`);
  }
  let pool = [];
  if (!Array.isArray(raw.pool)) {
    problems.push(`${key}-pool-not-a-list`);
  } else {
    pool = raw.pool.map(asId).filter(Boolean);
    if (pool.length !== raw.pool.length) problems.push(`${key}-pool-entry-invalid`);
    if (!raw.pool.length) problems.push(`${key}-pool-empty`);
  }
  if (!(every || minutes) || !pool.length) return null;
  return { every, minutes, count, order, pool };
}

/**
 * Validate an authored `sequence:` block. Invalid fields fall back to the
 * default behaviour (head 1, no idents) and are reported, never thrown.
 *
 * @param {*} raw
 * @returns {{ sequence: { head: number|string[], idents: { every: [number, number], pool: string[] }|null }|null,
 *   problems: string[] }}
 */
export function normalizeSequence(raw) {
  if (!isPlainObject(raw)) return { sequence: null, problems: ['sequence-not-a-mapping'] };
  const problems = [];

  let head = 1;
  if (isPresent(raw.head)) {
    if (Number.isInteger(raw.head) && raw.head >= 0) {
      head = raw.head;
    } else if (Array.isArray(raw.head)) {
      head = raw.head.map(asId).filter(Boolean);
      if (head.length !== raw.head.length) problems.push('head-entry-invalid');
    } else {
      problems.push('head-invalid');
    }
  }

  // `breaks:` is the general name (commercials, family photos, station IDs);
  // `idents:` is the older radio name for the same block.
  let key = null;
  if (isPresent(raw.breaks)) {
    key = 'breaks';
    if (isPresent(raw.idents)) problems.push('breaks-and-idents');
  } else if (isPresent(raw.idents)) {
    key = 'idents';
  }
  const idents = key ? normalizeBreaks(raw[key], key, problems) : null;

  return { sequence: { head, idents }, problems };
}

/**
 * Take the pinned head out of a playlist.
 *
 * A count pins the playlist's first N items. An id list pins exactly those
 * items in that order; an id the playlist does not hold comes back with
 * `item: null` so the caller can resolve it from elsewhere.
 *
 * @param {Object[]} items
 * @param {number|string[]} head
 * @returns {{ head: Array<{ id: string, item: Object|null }>, rest: Object[] }}
 */
export function splitHead(items, head) {
  const list = Array.isArray(items) ? [...items] : [];
  if (Array.isArray(head)) {
    const taken = new Set();
    const pinned = head.map((id) => {
      const at = list.findIndex((it, i) => !taken.has(i) && idOf(it) === id);
      if (at === -1) return { id, item: null };
      taken.add(at);
      return { id, item: list[at] };
    });
    return { head: pinned, rest: list.filter((_, i) => !taken.has(i)) };
  }
  const count = Number.isInteger(head) && head > 0 ? head : 0;
  return {
    head: list.slice(0, count).map((it) => ({ id: idOf(it), item: it })),
    rest: list.slice(count),
  };
}

/**
 * Fisher-Yates, in place.
 * @param {Object[]} items
 * @param {() => number} random - Injected; [0, 1)
 * @returns {Object[]} the same array
 */
export function shuffleItems(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Seconds an item plays: a clip's window, else its own duration; 0 when unknown. */
const playSeconds = (it) => {
  const seg = it?.segment;
  if (seg && Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start) return seg.end - seg.start;
  const d = Number(it?.duration);
  return Number.isFinite(d) && d > 0 ? d : 0;
};

/**
 * Put breaks between songs. A break comes after every `every` songs (a fresh
 * count from the range after each break) or once `minutes` of songs have
 * played, whichever comes first, and never after the final song. Each break
 * is `count` items. In `shuffle` order the pool is a shuffled bag, refilled
 * when empty, and never repeats back-to-back when it has more than one; in
 * `sequential` order it is walked in its own order, wrapping.
 *
 * @param {Object[]} songs
 * @param {{ every?: [number, number]|null, minutes?: number|null, count?: [number, number],
 *   order?: 'shuffle'|'sequential' }|[number, number]} rule - A bare pair is `every`
 * @param {Object[]} pool - Resolved break items
 * @param {() => number} random - Injected; [0, 1)
 * @returns {Object[]} a new array
 */
export function interleaveIdents(songs, rule, pool, random) {
  const list = Array.isArray(songs) ? songs : [];
  const r = Array.isArray(rule) ? { every: rule } : (rule ?? {});
  const every = Array.isArray(r.every) ? r.every : null;
  const limitSeconds = Number.isFinite(r.minutes) && r.minutes > 0 ? r.minutes * 60 : null;
  if (!Array.isArray(pool) || !pool.length || (!every && !limitSeconds)) return [...list];

  const drawFrom = ([min, max]) => min + Math.floor(random() * (max - min + 1));
  const count = Array.isArray(r.count) ? r.count : [1, 1];
  let bag = [];
  let last = null;
  let cursor = 0;
  const nextBreakItem = () => {
    if (r.order === 'sequential') {
      last = pool[cursor % pool.length];
      cursor += 1;
      return last;
    }
    if (!bag.length) {
      bag = shuffleItems([...pool], random);
      // The bag is popped from the end: keep the refill from opening with the
      // item that just played.
      if (bag.length > 1 && idOf(bag[bag.length - 1]) === idOf(last)) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    last = bag.pop();
    return last;
  };

  const out = [];
  let gap = every ? drawFrom(every) : Infinity;
  let played = 0;
  let seconds = 0;
  list.forEach((song, i) => {
    out.push(song);
    played += 1;
    seconds += playSeconds(song);
    const due = played >= gap || (limitSeconds != null && seconds >= limitSeconds);
    if (due && i < list.length - 1) {
      // A fixed count draws nothing, so the gap draws keep their old sequence.
      for (let n = count[0] === count[1] ? count[0] : drawFrom(count); n > 0; n--) out.push(nextBreakItem());
      played = 0;
      seconds = 0;
      gap = every ? drawFrom(every) : Infinity;
    }
  });
  return out;
}

/**
 * Apply a normalized sequence to a resolved playlist.
 *
 * @param {Object} options
 * @param {Object[]} options.items - The playlist, in playlist order
 * @param {{ head: number|string[], idents: Object|null }} options.sequence
 * @param {(rest: Object[]) => Promise<Object[]>} options.orderRest - Caller's ordering for the songs
 * @param {(ids: string[]) => Promise<Map<string, Object|Object[]|null>>} options.resolveIds - Resolve ids not in
 *   the playlist. An id may resolve to a list (a container): a head id takes its first item, a pool id
 *   contributes every item, so a whole show of commercials can be the break pool.
 * @param {() => number} options.random - Injected; [0, 1)
 * @returns {Promise<{ items: Object[], stats: { head: number, songs: number, idents: number, unresolved: string[] } }>}
 */
export async function sequenceQueue({ items, sequence, orderRest, resolveIds, random }) {
  const { head, rest } = splitHead(items, sequence.head);
  const pool = sequence.idents?.pool ?? [];
  const wanted = [...new Set([...head.filter((h) => !h.item).map((h) => h.id), ...pool])];
  const resolved = wanted.length ? await resolveIds(wanted) : new Map();
  const itemsFor = (id) => {
    const v = resolved.get(id);
    return (Array.isArray(v) ? v : [v]).filter(Boolean);
  };
  const unresolved = wanted.filter((id) => !itemsFor(id).length);

  const headItems = head.map((h) => h.item ?? itemsFor(h.id)[0]).filter(Boolean);
  // A station ID the playlist also holds as an ordinary track plays only as an
  // ID: left among the songs it would shuffle in beside an inserted ID.
  const poolIds = new Set(sequence.idents ? pool : []);
  const songs = await orderRest(rest.filter((it) => !poolIds.has(idOf(it))));
  const identItems = pool.flatMap(itemsFor);
  const body = identItems.length
    ? interleaveIdents(songs, sequence.idents, identItems, random)
    : [...songs];

  return {
    items: [...headItems, ...body],
    stats: { head: headItems.length, songs: songs.length, idents: body.length - songs.length, unresolved },
  };
}
