/**
 * Find other content ids that address the SAME underlying file.
 *
 * Filesystem-backed sources are rooted at overlapping directories — the canvas
 * root defaults to `<media>/img/art`, which lives inside the `files` root. So
 * one picture has two ids:
 *
 *   files:art/fhe/esther.jpg    → PlayableItem   → capabilities: playable
 *   canvas:fhe/esther.jpg       → DisplayableItem → capabilities: displayable
 *
 * Same bytes, different capabilities. A list row asking to Display the first
 * one resolves, streams, and renders nothing, because the adapter that answered
 * doesn't publish an image URL. Knowing the second id exists turns that dead
 * end into a one-click fix.
 *
 * Adapters opt in by implementing two optional methods — `resolveFilePath(id)`
 * and `localIdForFilePath(absPath)`. Sources with no filesystem identity
 * (Plex, YouTube, apps) implement neither and are skipped, so this costs them
 * nothing.
 */

/**
 * Capabilities for an item, preferring the adapter's own answer.
 * Mirrors the info router's derivation so the admin sees consistent values.
 *
 * @param {Object} item
 * @param {Object} adapter
 * @returns {string[]}
 */
function capabilitiesFor(item, adapter) {
  if (typeof adapter?.getCapabilities === 'function') {
    return adapter.getCapabilities(item) || [];
  }
  const capabilities = [];
  if (item.mediaUrl) capabilities.push('playable');
  if (item.thumbnail || item.imageUrl) capabilities.push('displayable');
  if (item.items || item.itemType === 'container') capabilities.push('listable');
  return capabilities;
}

export class ContentAlternatesService {
  #registry;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.registry - ContentSourceRegistry
   * @param {Object} [config.logger]
   */
  constructor({ registry, logger = console }) {
    if (!registry) throw new Error('ContentAlternatesService requires a registry');
    this.#registry = registry;
    this.#logger = logger;
  }

  /**
   * @param {string} contentId - e.g. "files:art/fhe/esther.jpg"
   * @returns {Promise<Array<{contentId: string, source: string, title: string, capabilities: string[]}>>}
   *   empty when the id has no filesystem identity or nothing else reaches it
   */
  async findAlternates(contentId) {
    const resolved = this.#registry.resolve?.(contentId);
    const adapter = resolved?.adapter;
    if (typeof adapter?.resolveFilePath !== 'function') return [];

    const filePath = adapter.resolveFilePath(resolved.localId);
    if (!filePath) return [];

    const alternates = [];
    for (const sourceName of this.#registry.list()) {
      const candidate = this.#registry.get(sourceName);
      if (!candidate || candidate === adapter) continue;
      if (typeof candidate.localIdForFilePath !== 'function') continue;

      const localId = candidate.localIdForFilePath(filePath);
      if (!localId) continue;

      // The id is what a list row will store, so it must use the PREFIX the
      // resolver accepts ('canvas'), not the adapter's internal source name
      // ('canvas-filesystem') — those differ, and only one of them resolves.
      const prefix = candidate.prefixes?.[0]?.prefix || candidate.source;
      const altId = `${prefix}:${localId}`;
      if (altId === contentId) continue;

      try {
        const item = await candidate.getItem(localId);
        if (!item) continue;
        alternates.push({
          contentId: altId,
          source: prefix,
          title: item.title || null,
          capabilities: capabilitiesFor(item, candidate),
        });
      } catch (err) {
        // One uncooperative adapter must not sink the whole lookup — this is
        // an advisory feature, not a critical path.
        this.#logger.warn?.('alternates.candidate_failed', {
          contentId, candidate: prefix, error: err.message,
        });
      }
    }

    return alternates;
  }
}

export default ContentAlternatesService;
