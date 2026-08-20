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
 * this attaches NOTHING: a frame with no rail is honest, a rail that lies about
 * position is not. That is why the caller must not fall back to a per-item
 * lookup on an empty result — doing so would hand each episode its own
 * standalone frame, which is exactly the lie being avoided.
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
 * @returns {{ items: Array<Object>, surroundFor: Map<string, {payload: Object, part: number}> }|null}
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

  // Compared against the authored order RESTRICTED to the parts present: a
  // queue missing a part is incomplete, not mis-ordered, and only the second
  // makes a rail lie about position.
  const authored = slots.map((slot) => idOf(slot.contentId)).filter((id) => onRailIds.includes(id));
  const matchesAuthored = onRailIds.length === authored.length
    && onRailIds.every((id, i) => id === authored[i]);

  if (!enforceOrder && !matchesAuthored) {
    logger?.warn?.('surround.order.mismatch', {
      containerId,
      surroundId: container.id,
      enforceOrder: false,
      parts: slots.length,
      authored,
      queued: queuedIds
    });
    // The queue plays in whatever order it arrived; it just does so unframed.
    return { items: queued, surroundFor: new Map() };
  }

  let ordered = queued;
  if (enforceOrder) {
    const rank = new Map(slots.map((slot, i) => [idOf(slot.contentId), i]));
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
  return { items: ordered, surroundFor };
}

export default planSurroundQueue;
