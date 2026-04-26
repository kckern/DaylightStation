/**
 * State resolver: looks up a (location, stateValue) pair in the per-location
 * states map and produces a trigger intent. Unlike NFC, there is no universal
 * registry — every state event is location-scoped (the entity_id that emitted
 * it belongs to a single location).
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless cross-entity
 * logic. No I/O, no YAML knowledge.
 *
 * Returns null if the location or state value is not registered.
 *
 * Throws ValidationError if the state entry is malformed (e.g. missing action).
 *
 * @module domains/trigger/services/StateResolver
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const RESERVED_KEYS = new Set(['action', 'target', 'content', 'scene', 'service', 'entity', 'data']);

/**
 * Stateless domain service. Use static method.
 *
 * @class StateResolver
 * @stateless
 */
export class StateResolver {
  /**
   * @param {Object} args
   * @param {string} args.location  state-source location ID
   * @param {string} args.value     raw state value (case-insensitive, e.g. 'off')
   * @param {Object} args.registry  the `state` slice of the trigger registry: { locations }
   * @returns {Object|null} resolved intent or null if not registered
   * @throws {ValidationError} if the state entry has no action
   */
  static resolve({ location, value, registry }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;

    const stateValue = String(value || '').toLowerCase();
    const stateEntry = locationConfig.states?.[stateValue];
    if (!stateEntry) return null;

    if (!stateEntry.action) {
      throw new ValidationError(
        `state "${stateValue}" at location "${location}" has no action`,
        { code: 'STATE_MISSING_ACTION', field: stateValue }
      );
    }

    const params = {};
    for (const [k, v] of Object.entries(stateEntry)) {
      if (RESERVED_KEYS.has(k)) continue;
      params[k] = v;
    }

    const intent = {
      action: stateEntry.action,
      target: stateEntry.target ?? locationConfig.target,
      params,
    };
    if (stateEntry.content !== undefined) intent.content = stateEntry.content;
    if (stateEntry.scene !== undefined) intent.scene = stateEntry.scene;
    if (stateEntry.service !== undefined) intent.service = stateEntry.service;
    if (stateEntry.entity !== undefined) intent.entity = stateEntry.entity;
    if (stateEntry.data !== undefined) intent.data = stateEntry.data;

    return intent;
  }
}

export default StateResolver;
