/**
 * MediaPolicyGate — applies a satellite's media_policy to a list of resolved
 * playable items. Per-satellite library / label / playlist-membership
 * whitelist for voice playback.
 *
 * Policy shape (from satellite.media_policy):
 *   auto_approved_libraries: number[]           // library IDs allowed unconditionally
 *   label_gated:                                // label-based allow path (optional)
 *     libraries: number[]
 *     required_labels: string[]                 // any of these on item / ancestors
 *     check_ancestors: boolean (default true)
 *   playlist_gated:                             // playlist-membership allow path (optional)
 *     allowed_playlist_ids: (string|number)[]   // items in any of these playlists are allowed
 *
 * Behavior — three independent allow paths, OR-combined:
 *   1. Library in auto_approved_libraries → allow.
 *   2. Library in label_gated.libraries AND has required label → allow.
 *   3. Item is a member of any allowed_playlist_ids → allow.
 *   Otherwise → deny (default-deny).
 *
 * Vendor-agnostic: the gate doesn't know about Plex (or any other source).
 * It calls caller-supplied callables (`labelLookup`, `playlistMembershipLookup`)
 * that handle source-specific lookups. The composition root wires them.
 */
export class MediaPolicyGate {
  #labelLookup;
  #playlistMembershipLookup;
  #logger;
  #cache = new Map();
  #playlistMembersCache = new Map();   // playlistId → Promise<Set<itemId>>

  /**
   * @param {Object} deps
   * @param {(item: object, opts: { includeAncestors: boolean }) => Promise<string[]>} [deps.labelLookup]
   *   Returns labels considered relevant for the item. Optional.
   * @param {(playlistId: string|number) => Promise<Set<string>>} [deps.playlistMembershipLookup]
   *   Returns the set of member item IDs for a given playlist. Optional.
   * @param {Object} [deps.logger]
   */
  constructor({ labelLookup = null, playlistMembershipLookup = null, logger = console } = {}) {
    this.#labelLookup = labelLookup;
    this.#playlistMembershipLookup = playlistMembershipLookup;
    this.#logger = logger;
  }

  /**
   * @param {Array} items - resolved playable items
   * @param {Object} satellite - satellite with optional media_policy
   * @returns {Promise<Array>} filtered items
   */
  async apply(items, satellite) {
    const policy = satellite?.media_policy;
    if (!policy) return items;
    const out = [];
    for (const item of items) {
      if (await this.#allow(item, policy)) out.push(item);
    }
    return out;
  }

  async #allow(item, policy) {
    // Path 1: auto-approved libraries (unconditional allow).
    const libId = String(item?.librarySectionID ?? item?.metadata?.librarySectionID ?? '');
    const auto = (policy.auto_approved_libraries ?? []).map(String);
    if (libId && auto.includes(libId)) return true;

    // Path 2: label-based allow (item or ancestor has a required label).
    if (libId && policy.label_gated) {
      const gated = policy.label_gated;
      const gatedLibs = (gated.libraries ?? []).map(String);
      if (gatedLibs.includes(libId)) {
        const required = new Set((gated.required_labels ?? []).map(s => String(s).toLowerCase()));
        if (required.size > 0) {
          const includeAncestors = gated.check_ancestors !== false;
          const labels = await this.#getLabels(item, includeAncestors);
          if (labels.some(l => required.has(l))) return true;
        }
      }
    }

    // Path 3: playlist membership (item is in any allowed playlist).
    if (policy.playlist_gated && this.#playlistMembershipLookup) {
      const allowedIds = (policy.playlist_gated.allowed_playlist_ids ?? []).map(String);
      if (allowedIds.length > 0) {
        const itemKey = String(item?.ratingKey ?? item?.metadata?.ratingKey ?? item?.localId ?? '');
        if (itemKey) {
          for (const playlistId of allowedIds) {
            const members = await this.#getPlaylistMembers(playlistId);
            if (members.has(itemKey)) return true;
          }
        }
      }
    }

    return false;
  }

  async #getPlaylistMembers(playlistId) {
    if (this.#playlistMembersCache.has(playlistId)) return this.#playlistMembersCache.get(playlistId);
    const promise = (async () => {
      try {
        const set = await this.#playlistMembershipLookup(playlistId);
        return set instanceof Set ? set : new Set();
      } catch (err) {
        this.#logger.warn?.('media.policy.playlist_lookup_failed', {
          playlistId, error: err.message,
        });
        return new Set();
      }
    })();
    this.#playlistMembersCache.set(playlistId, promise);
    return promise;
  }

  async #getLabels(item, includeAncestors) {
    // Item-level labels (vendor-agnostic — every adapter exposes a `labels`
    // array on resolved items, or doesn't and we treat it as []).
    const own = (item?.labels ?? item?.metadata?.labels ?? []).map(s => String(s).toLowerCase());

    if (!includeAncestors || !this.#labelLookup) return own;

    // Caller-provided lookup adds ancestor labels (vendor-aware).
    const cacheKey = `${item?.source ?? '?'}::${item?.id ?? item?.localId ?? '?'}`;
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey);

    let combined = own;
    try {
      const ancestor = await this.#labelLookup(item, { includeAncestors: true });
      const norm = (ancestor ?? []).map(s => String(s).toLowerCase());
      combined = [...own, ...norm];
    } catch (err) {
      this.#logger.warn?.('media.policy.label_lookup_failed', {
        item_id: item?.id, error: err.message,
      });
    }
    this.#cache.set(cacheKey, combined);
    return combined;
  }
}

export default MediaPolicyGate;
