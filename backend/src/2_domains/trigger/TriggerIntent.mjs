/**
 * Intent resolution: merge location defaults with per-value entry overrides;
 * expand single-content-prefix shorthand via the ContentIdResolver.
 * @module domains/trigger/TriggerIntent
 */

import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

/**
 * Keys reserved for first-class intent fields. Action handlers consume these by name; any other tag-level key flows into intent.params.
 */
export const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
]);

function expandShorthand(valueEntry, contentIdResolver) {
  const candidates = Object.entries(valueEntry).filter(([k]) => !RESERVED_KEYS.has(k));
  if (candidates.length !== 1) return null;
  const [prefix, value] = candidates[0];
  const compound = `${prefix}:${value}`;
  if (!contentIdResolver?.resolve(compound)) return null;
  return compound;
}

export function resolveIntent(locationConfig, valueEntry, contentIdResolver) {
  if (!locationConfig) throw new ValidationError('locationConfig is required', { code: 'MISSING_LOCATION_CONFIG' });
  if (!valueEntry) throw new ValidationError('valueEntry is required', { code: 'MISSING_VALUE_ENTRY' });

  const action = valueEntry.action ?? locationConfig.action;
  const target = valueEntry.target ?? locationConfig.target;

  let content = valueEntry.content;
  let consumedKey = null;
  if (!content) {
    const expanded = expandShorthand(valueEntry, contentIdResolver);
    if (expanded) {
      content = expanded;
      consumedKey = expanded.split(':')[0];
    }
  }

  const params = {};
  for (const [k, v] of Object.entries(valueEntry)) {
    if (RESERVED_KEYS.has(k)) continue;
    if (k === consumedKey) continue;
    params[k] = v;
  }

  const intent = { action, target, params };
  if (content !== undefined) intent.content = content;
  if (valueEntry.scene !== undefined) intent.scene = valueEntry.scene;
  if (valueEntry.service !== undefined) intent.service = valueEntry.service;
  if (valueEntry.entity !== undefined) intent.entity = valueEntry.entity;
  if (valueEntry.data !== undefined) intent.data = valueEntry.data;

  return intent;
}

export default resolveIntent;
