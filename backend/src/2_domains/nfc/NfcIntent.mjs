/**
 * Intent resolution: merge reader defaults with tag overrides;
 * expand single-content-prefix shorthand via the ContentIdResolver.
 * @module domains/nfc/NfcIntent
 */

const RESERVED_KEYS = new Set([
  'action', 'target', 'content',
  'scene', 'service', 'entity', 'data',
]);

function expandShorthand(tagEntry, contentIdResolver) {
  const candidates = Object.entries(tagEntry).filter(([k]) => !RESERVED_KEYS.has(k));
  if (candidates.length !== 1) return null;
  const [prefix, value] = candidates[0];
  const compound = `${prefix}:${value}`;
  if (!contentIdResolver?.resolve(compound)) return null;
  return compound;
}

export function resolveIntent(reader, tag, contentIdResolver) {
  if (!reader) throw new Error('reader is required');
  if (!tag) throw new Error('tag is required');

  const action = tag.action ?? reader.action;
  const target = tag.target ?? reader.target;

  let content = tag.content;
  let consumedKey = null;
  if (!content) {
    const expanded = expandShorthand(tag, contentIdResolver);
    if (expanded) {
      content = expanded;
      consumedKey = expanded.split(':')[0];
    }
  }

  const params = {};
  for (const [k, v] of Object.entries(tag)) {
    if (RESERVED_KEYS.has(k)) continue;
    if (k === consumedKey) continue;
    params[k] = v;
  }

  const intent = { action, target, params };
  if (content !== undefined) intent.content = content;
  if (tag.scene !== undefined) intent.scene = tag.scene;
  if (tag.service !== undefined) intent.service = tag.service;
  if (tag.entity !== undefined) intent.entity = tag.entity;
  if (tag.data !== undefined) intent.data = tag.data;

  return intent;
}

export default resolveIntent;
