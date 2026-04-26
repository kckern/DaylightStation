/**
 * NFC resolver: turns a (location, tagUid) pair into a resolved trigger
 * intent. Universal tag lookup + reader-default merging + per-reader override
 * + content-shorthand expansion.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless cross-entity
 * logic per domain-layer-guidelines.md. No I/O, no YAML knowledge — receives
 * already-parsed shapes from the adapter.
 *
 * Precedence (later wins):
 *   reader.defaults  <  tag.global  <  tag.overrides[location]
 *
 * Reserved fields (action, target, content) follow the same chain. Other
 * fields (shader, volume, etc.) flow into intent.params.
 *
 * Returns null if the location or tag is not registered (caller treats
 * missing as TRIGGER_NOT_REGISTERED).
 *
 * Throws ValidationError for malformed entries (e.g., ambiguous shorthand).
 *
 * @module domains/trigger/services/NfcResolver
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
]);

function expandShorthand(merged, contentIdResolver) {
  const candidates = Object.entries(merged).filter(([k]) => !RESERVED_KEYS.has(k));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const resolvable = candidates.filter(([k, v]) => contentIdResolver?.resolve(`${k}:${v}`));
    if (resolvable.length > 1) {
      throw new ValidationError(
        `ambiguous shorthand: multiple keys (${resolvable.map(([k]) => k).join(', ')}) resolve as content`,
        { code: 'AMBIGUOUS_SHORTHAND' }
      );
    }
    if (resolvable.length === 1) return { compound: `${resolvable[0][0]}:${resolvable[0][1]}`, key: resolvable[0][0] };
    return null;
  }
  const [[prefix, value]] = candidates;
  const compound = `${prefix}:${value}`;
  if (!contentIdResolver?.resolve(compound)) return null;
  return { compound, key: prefix };
}

/**
 * Stateless domain service. Use static method.
 *
 * @class NfcResolver
 * @stateless
 */
export class NfcResolver {
  /**
   * Resolve an (location, tagUid) pair against the NFC registry slice.
   *
   * @param {Object} args
   * @param {string} args.location  reader location ID (e.g. 'livingroom')
   * @param {string} args.value     raw tag UID (case-insensitive)
   * @param {Object} args.registry  the `nfc` slice of the trigger registry: { locations, tags }
   * @param {Object} args.contentIdResolver  has `.resolve(compound)` -> truthy if valid
   * @returns {Object|null} resolved intent { action, target, content, params, ... } or null if not registered
   * @throws {ValidationError} if shorthand expansion is ambiguous
   */
  static resolve({ location, value, registry, contentIdResolver }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;

    const uid = String(value || '').toLowerCase();
    const tag = registry?.tags?.[uid];
    if (!tag) return null;

    // Merge: readerDefaults < tagGlobal < tagOverridesForLocation
    const merged = {
      ...(locationConfig.defaults || {}),
      ...(tag.global || {}),
      ...(tag.overrides?.[location] || {}),
    };

    // Action and target follow the same chain. Reserved keys can appear in any
    // layer (reader-defaults can NOT today set action/target since those are
    // first-class on the location, but tag-global/tag-overrides can).
    const action = merged.action ?? locationConfig.action;
    const target = merged.target ?? locationConfig.target;

    // Resolve content. Explicit `content` wins; otherwise expand single-prefix shorthand.
    let content = merged.content;
    let consumedKey = null;
    if (!content) {
      const shorthand = expandShorthand(merged, contentIdResolver);
      if (shorthand) {
        content = shorthand.compound;
        consumedKey = shorthand.key;
      }
    }

    // Build params from leftover non-reserved keys.
    const params = {};
    for (const [k, v] of Object.entries(merged)) {
      if (RESERVED_KEYS.has(k)) continue;
      if (k === consumedKey) continue;
      params[k] = v;
    }

    const intent = { action, target, params };
    if (content !== undefined) intent.content = content;
    if (merged.scene !== undefined) intent.scene = merged.scene;
    if (merged.service !== undefined) intent.service = merged.service;
    if (merged.entity !== undefined) intent.entity = merged.entity;
    if (merged.data !== undefined) intent.data = merged.data;

    return intent;
  }
}

export default NfcResolver;
