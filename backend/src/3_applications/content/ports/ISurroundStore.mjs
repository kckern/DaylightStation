/**
 * ISurroundStore - Port interface for surround sidecar lookup
 *
 * A "surround" is the presentation shell drawn around a shrunken player: a
 * composer card, a segment map, a cue ticker. Its data is authored as YAML
 * sidecars alongside the content corpus; implementations abstract that storage.
 *
 * Synchronous by design, matching IListStore: the play and queue projections
 * that consume it are themselves synchronous, and the implementation indexes
 * the sidecar tree up front rather than reading per lookup.
 *
 * A surround is NOT playable content and must never register as a content
 * source. It decorates an item that some other source already resolved.
 */
export class ISurroundStore {
  /**
   * Find the surround payload for a piece of content.
   *
   * Never throws: a missing, malformed, or ambiguous sidecar yields null, and
   * the caller attaches nothing. The surround is always additive — it can never
   * be the reason something fails to play.
   *
   * TWO SEGMENT LISTS REACH THE PAYLOAD, and picking the wrong one is silent.
   * For a single-item piece they carry the same segments and either reads
   * correctly, which is exactly why the mistake survives review — it only
   * surfaces on a container, where they are different lists.
   *
   *   `segments`      the COMPOSED SOUNDING RAIL. One entry per segment across
   *                   every media item the surround spans, each carrying
   *                   `offset` and `duration` in sounding seconds plus the
   *                   `contentId` and `part` it belongs to. This is what
   *                   `timeline` describes and what a position maps onto.
   *   `pieceSegments` the PIECE'S OWN AUTHORED LIST, in authored order, with
   *                   this recording's `starts` written onto it. No offsets, no
   *                   part, and for a container it is the container work's own
   *                   list rather than its parts'.
   *
   * USE `segments` for anything positional — where the playhead is, which
   * segment is sounding, how wide a segment is drawn. Use `pieceSegments` only
   * for what the work itself says: names, translations, `listen` notes.
   *
   * @param {string} contentId - Canonical content identifier (e.g. 'plex:663134')
   * @param {string} [title] - Live item title, used to rebind when a library
   *   rescan has invalidated the authored contentId
   * @returns {{
   *   id: string,
   *   definition: Object,
   *   piece: Object,
   *   segments: Array,
   *   pieceSegments: Array,
   *   timeline: { totalSounding: number, parts: Array },
   *   cues: Array,
   *   facts: Array,
   *   composer: Object,
   *   assetBase: string
   * }|null} Resolved payload, or null when no sidecar applies
   */
  lookup(contentId, title) {
    throw new Error('ISurroundStore.lookup must be implemented');
  }

  /**
   * Find the surround whose rail this piece of content is a SEGMENT of.
   *
   * A surround may span several media items — a season of three étude episodes
   * presents one twenty-seven segment rail — so the payload a played item needs
   * is not always the one authored against its own id. Where a container claims
   * an item, this answers with the container and the item's position in it;
   * where nothing does, an item is part 0 of its own single-item rail.
   *
   * Never throws, for the same reason `lookup` never does.
   *
   * @param {string} contentId - Canonical content identifier
   * @returns {{ payload: Object, part: number }|null} The rail and the position
   *   on it, or null when no surround covers this item
   */
  lookupByPart(contentId) {
    throw new Error('ISurroundStore.lookupByPart must be implemented');
  }
}

/**
 * Duck-type check for a surround store.
 * @param {Object} obj
 * @returns {boolean}
 */
export function isSurroundStore(obj) {
  return !!obj && typeof obj.lookup === 'function';
}
