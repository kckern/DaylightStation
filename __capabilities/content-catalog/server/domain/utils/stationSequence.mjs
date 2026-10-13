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

  let idents = null;
  if (isPresent(raw.idents)) {
    if (!isPlainObject(raw.idents)) {
      problems.push('idents-not-a-mapping');
    } else {
      const every = normalizeEvery(raw.idents.every);
      if (!every) problems.push('idents-every-invalid');
      let pool = [];
      if (!Array.isArray(raw.idents.pool)) {
        problems.push('idents-pool-not-a-list');
      } else {
        pool = raw.idents.pool.map(asId).filter(Boolean);
        if (pool.length !== raw.idents.pool.length) problems.push('idents-pool-entry-invalid');
        if (!raw.idents.pool.length) problems.push('idents-pool-empty');
      }
      if (every && pool.length) idents = { every, pool };
    }
  }

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

/**
 * Drop station IDs between songs: one after every `every` songs (a fresh count
 * from the range after each ID), never after the final song. IDs rotate
 * through a shuffled bag, refilled when empty, and never repeat back-to-back
 * when the pool has more than one.
 *
 * @param {Object[]} songs
 * @param {[number, number]} every
 * @param {Object[]} pool - Resolved ident items
 * @param {() => number} random - Injected; [0, 1)
 * @returns {Object[]} a new array
 */
export function interleaveIdents(songs, every, pool, random) {
  const list = Array.isArray(songs) ? songs : [];
  if (!Array.isArray(pool) || !pool.length || !Array.isArray(every)) return [...list];

  const [min, max] = every;
  const draw = () => min + Math.floor(random() * (max - min + 1));
  let bag = [];
  let last = null;
  const nextIdent = () => {
    if (!bag.length) {
      bag = shuffleItems([...pool], random);
      // The bag is popped from the end: keep the refill from opening with the
      // ID that just played.
      if (bag.length > 1 && idOf(bag[bag.length - 1]) === idOf(last)) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
    }
    last = bag.pop();
    return last;
  };

  const out = [];
  let gap = draw();
  let count = 0;
  list.forEach((song, i) => {
    out.push(song);
    count += 1;
    if (count >= gap && i < list.length - 1) {
      out.push(nextIdent());
      count = 0;
      gap = draw();
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
 * @param {(ids: string[]) => Promise<Map<string, Object|null>>} options.resolveIds - Resolve ids not in the playlist
 * @param {() => number} options.random - Injected; [0, 1)
 * @returns {Promise<{ items: Object[], stats: { head: number, songs: number, idents: number, unresolved: string[] } }>}
 */
export async function sequenceQueue({ items, sequence, orderRest, resolveIds, random }) {
  const { head, rest } = splitHead(items, sequence.head);
  const pool = sequence.idents?.pool ?? [];
  const wanted = [...new Set([...head.filter((h) => !h.item).map((h) => h.id), ...pool])];
  const resolved = wanted.length ? await resolveIds(wanted) : new Map();
  const unresolved = wanted.filter((id) => !resolved.get(id));

  const headItems = head.map((h) => h.item ?? resolved.get(h.id)).filter(Boolean);
  // A station ID the playlist also holds as an ordinary track plays only as an
  // ID: left among the songs it would shuffle in beside an inserted ID.
  const poolIds = new Set(sequence.idents ? pool : []);
  const songs = await orderRest(rest.filter((it) => !poolIds.has(idOf(it))));
  const identItems = pool.map((id) => resolved.get(id)).filter(Boolean);
  const body = identItems.length
    ? interleaveIdents(songs, sequence.idents.every, identItems, random)
    : [...songs];

  return {
    items: [...headItems, ...body],
    stats: { head: headItems.length, songs: songs.length, idents: body.length - songs.length, unresolved },
  };
}
