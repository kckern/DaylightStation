/**
 * ISequenceStore - Port interface for station-sequence sidecar lookup
 *
 * A sequence is a queue-ordering rule a container (a Plex playlist, typically)
 * carries in a YAML sidecar: which items are pinned at the head, and which
 * station IDs recur between songs. See
 * `#domains/content/utils/stationSequence.mjs` for the rule itself.
 *
 * Synchronous, like ISurroundStore: implementations index the sidecars up
 * front rather than reading per lookup.
 */
export class ISequenceStore {
  /**
   * Find the normalized sequence for a container.
   *
   * Never throws: a missing or malformed sidecar yields null, and the queue is
   * built exactly as it would be without one.
   *
   * @param {string} contentId - Compound content id of the container (e.g. 'plex:757556')
   * @returns {{ head: number|string[], idents: { every: [number, number], pool: string[] }|null }|null}
   */
  lookup(contentId) {
    throw new Error('ISequenceStore.lookup must be implemented');
  }
}

/**
 * Duck-type check for a sequence store.
 * @param {Object} obj
 * @returns {boolean}
 */
export function isSequenceStore(obj) {
  return !!obj && typeof obj.lookup === 'function';
}
