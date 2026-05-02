/**
 * MediaPolicyGate — applies a satellite's media_policy to a list of resolved
 * playable items. Per-satellite library + label whitelist for voice playback.
 *
 * Policy shape (from satellite.media_policy):
 *   auto_approved_libraries: number[]           // library IDs allowed without label check
 *   label_gated:
 *     libraries: number[]                       // library IDs that need a label match
 *     required_labels: string[]                 // any of these on item / ancestors
 *     check_ancestors: boolean (default true)   // include ancestor labels
 *
 * Behavior:
 *   - No media_policy on satellite → pass-through (back-compat).
 *   - Library in auto_approved_libraries → always allow.
 *   - Library in label_gated.libraries → allow only if a required label is present.
 *   - Library in NEITHER list → deny (default-deny — explicit list, no surprises).
 *
 * Vendor-agnostic: the gate doesn't know about Plex (or any other source).
 * It calls a caller-supplied `labelLookup(item, opts)` that returns the
 * label strings considered relevant for the item. The composition root
 * decides how to compute those labels for each source.
 */
export class MediaPolicyGate {
  #labelLookup;
  #logger;
  #cache = new Map();

  /**
   * @param {Object} deps
   * @param {(item: object, opts: { includeAncestors: boolean }) => Promise<string[]>} [deps.labelLookup]
   *   Optional. Returns ALL labels considered relevant for the item. If
   *   absent, only item-level `labels` (read straight off the item) are
   *   considered.
   * @param {Object} [deps.logger]
   */
  constructor({ labelLookup = null, logger = console } = {}) {
    this.#labelLookup = labelLookup;
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
    const libId = String(item?.librarySectionID ?? item?.metadata?.librarySectionID ?? '');
    if (!libId) {
      // Item has no library — can't policy-check it, deny conservatively.
      return false;
    }

    const auto = (policy.auto_approved_libraries ?? []).map(String);
    if (auto.includes(libId)) return true;

    const gated = policy.label_gated;
    if (!gated) return false;

    const gatedLibs = (gated.libraries ?? []).map(String);
    if (!gatedLibs.includes(libId)) {
      // Not in any listed library — default deny.
      return false;
    }

    const required = new Set((gated.required_labels ?? []).map(s => String(s).toLowerCase()));
    if (required.size === 0) return false;

    const includeAncestors = gated.check_ancestors !== false;   // default true
    const labels = await this.#getLabels(item, includeAncestors);
    return labels.some(l => required.has(l));
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
