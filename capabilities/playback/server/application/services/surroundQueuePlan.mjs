// backend/src/3_applications/content/services/surroundQueuePlan.mjs

const asArray = (v) => (Array.isArray(v) ? v : []);
const idOf = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * Decide what a queue built FROM A CONTAINER plays, in what order, and which
 * surround frame each of its items carries.
 *
 * This is the seam where "how playback started" becomes visible. The store can
 * answer both questions about one media item — what is authored against it, and
 * what rail it is a segment of — but only the caller knows which was asked. A
 * queue request names the container, so here an étude episode is part 1 of a
 * programme; a play request for the same id names nothing above it, so there it
 * is a whole work with its own frame. Neither reading is derivable from the id.
 *
 * Ordering, per the design's §5: an enriched container imposes its authored
 * order over shuffle — a programme is a programme, and playing the Revolutionary
 * étude third would be wrong in a way no rail can rescue. `enforceOrder: false`
 * opts out, and when it is off AND the queue disagrees with the authored order
 * this REFUSES: a frame with no rail is honest, a rail that lies about position
 * is not.
 *
 * `refused` is what distinguishes that from an ordinary miss, and the two must
 * not be conflated. A refusal is total — no item in the queue may be framed,
 * because falling back to each item's own sidecar there is the same lie in a
 * different costume. An item merely *not on* a successful plan's rail is not
 * refused anything: a container naming three of a collection's ten items leaves
 * the other seven exactly as they were, each free to find its own sidecar.
 *
 * Returns `null` for everything that is not an enriched container queue, which
 * is the signal to behave exactly as before this existed.
 *
 * Never throws: a store that breaks its own never-throw contract costs the
 * queue its enrichment, never its items.
 *
 * @param {Object} options
 * @param {import('#apps/content/ports/ISurroundStore.mjs').ISurroundStore} [options.surroundStore]
 * @param {string} options.containerId - Compound id the queue was requested for
 * @param {Array<{id: string}>} options.items - Resolved queue items, in adapter order
 * @param {boolean} [options.enforceOrder=true] - Config `surround.enforceOrder`
 * @param {Object} [options.logger] - Structured logger (already scoped to surround)
 * @returns {{ items: Array<Object>, surroundFor: Map<string, {payload: Object, part: number}>,
 *   refused: boolean }|null}
 */
export function planSurroundQueue({ surroundStore, containerId, items, enforceOrder = true, logger = null } = {}) {
  if (typeof surroundStore?.lookup !== 'function') return null;
  const queued = asArray(items);
  if (!queued.length) return null;

  let container = null;
  try {
    // No title to rebind against — a container id is asked for by id or not at
    // all. Its own event name, distinct from the per-item `surround.attach.failed`,
    // so a broken index here is not mistaken for a broken sidecar on one episode.
    container = surroundStore.lookup(containerId, null) ?? null;
  } catch (err) {
    logger?.warn?.('surround.container.failed', { containerId, error: err?.message });
    return null;
  }

  // A container's rail names OTHER media items; an ordinary piece's rail names
  // only itself (YamlSurroundStore#indexParts: "A composed container makes no
  // claim on ITSELF"). So the test for "is this a container" is a property of
  // the payload, not of the id — which matters because a season and an episode
  // are the same kind of string.
  const slots = asArray(container?.timeline?.parts)
    .filter((slot) => idOf(slot?.contentId) && idOf(slot.contentId) !== idOf(containerId));
  if (!slots.length) return null;

  const slotById = new Map(slots.map((slot) => [idOf(slot.contentId), slot]));
  const queuedIds = queued.map((qi) => idOf(qi?.id));
  const onRailIds = queuedIds.filter((id) => slotById.has(id));
  if (!onRailIds.length) {
    // The container is enriched but this queue holds none of its parts — a
    // Plex rescan that reminted the episodes' ratingKeys looks exactly like
    // this, and it is otherwise indistinguishable from an unauthored season.
    logger?.debug?.('surround.container.unmatched', {
      containerId, surroundId: container.id, parts: slots.length, queued: queued.length
    });
    return null;
  }

  // "Does the queue DISAGREE with the authored order" — asked as: do the parts
  // it holds appear in non-decreasing authored rank. Not as list equality,
  // which conflates three different things with mis-ordering. A queue missing a
  // part is incomplete (ranks 0,2 — still ascending); a queue repeating one is
  // odd but not out of order (0,0,1); only an actual inversion (1,0) makes a
  // rail lie about position, and only that may cost the frame.
  const rank = new Map(slots.map((slot, i) => [idOf(slot.contentId), i]));
  const queuedRanks = onRailIds.map((id) => rank.get(id));
  const matchesAuthored = queuedRanks.every((r, i) => i === 0 || queuedRanks[i - 1] <= r);
  // Reported, not compared: the authored order of the parts this queue holds,
  // so the warn below names both sides of the disagreement.
  const authored = slots.map((slot) => idOf(slot.contentId)).filter((id) => onRailIds.includes(id));

  if (!enforceOrder && !matchesAuthored) {
    logger?.warn?.('surround.order.mismatch', {
      containerId,
      surroundId: container.id,
      enforceOrder: false,
      parts: slots.length,
      authored,
      queued: queuedIds
    });
    // The queue plays in whatever order it arrived; it just does so unframed —
    // every item of it, which is what `refused` tells the caller.
    return { items: queued, surroundFor: new Map(), refused: true };
  }

  let ordered = queued;
  if (enforceOrder) {
    // Items the rail does not know keep their relative order and follow the
    // programme, rather than being dropped or interleaved at an arbitrary point.
    const onRail = queued
      .filter((qi) => rank.has(idOf(qi?.id)))
      .sort((a, b) => rank.get(idOf(a.id)) - rank.get(idOf(b.id)));
    const offRail = queued.filter((qi) => !rank.has(idOf(qi?.id)));
    ordered = [...onRail, ...offRail];

    logger?.info?.('surround.order.enforced', {
      containerId,
      surroundId: container.id,
      parts: slots.length,
      queued: queued.length,
      onRail: onRail.length,
      // Whether this actually MOVED anything — the difference between a season
      // played in order and a shuffle that was overridden.
      reordered: ordered.some((qi, i) => qi !== queued[i]),
      order: ordered.map((qi) => idOf(qi?.id))
    });
  }

  // One payload object shared by every part of this queue. `lookup` already
  // handed back a clone owned by this request, so nothing indexed is exposed;
  // the response is serialized immediately after, where sharing costs nothing.
  const surroundFor = new Map();
  for (const id of new Set(onRailIds)) {
    surroundFor.set(id, { payload: container, part: slotById.get(id).index });
  }
  return { items: ordered, surroundFor, refused: false };
}

export default planSurroundQueue;
