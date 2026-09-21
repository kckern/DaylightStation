import { isContainerInput } from '../session/containerExpansion.js';
import getLogger from '../../../lib/logging/Logger.js';

export const ITEM_ACTIONS = Object.freeze(['playNow', 'shuffle', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'details']);
export function createOperationId(crypto = globalThis.crypto) { return crypto.randomUUID(); }
const pending = new WeakMap();
let log;

/** The UI names an intent; only the selected owner is allowed to apply it. */
export function executeItemAction({ kind, item, collectionItems, destination, operationId = createOperationId(), options = {} }) {
  if (!ITEM_ACTIONS.includes(kind)) return Promise.resolve({ ok: false, code: 'INVALID_ITEM_ACTION' });
  const input = item && { ...item, contentId: item.contentId ?? item.id };
  if (!input?.contentId) return Promise.resolve({ ok: false, code: 'INVALID_ITEM' });
  if (kind === 'details') {
    options.openDetails?.(input.contentId);
    return Promise.resolve({ ok: true });
  }
  if (typeof destination?.execute !== 'function') {
    return Promise.resolve({ ok: false, code: 'ITEM_ACTION_UNSUPPORTED', reason: 'This screen does not support this item action.' });
  }
  const canonicalKind = ({ playOn: 'playNow', addOn: 'add' })[kind] ?? kind;
  const collection = Array.isArray(collectionItems) || isContainerInput(input);
  const clearRest = canonicalKind === 'shuffle' || (canonicalKind === 'playNow' && collection);
  const key = `${canonicalKind}:${input.contentId}`;
  let active = pending.get(destination);
  if (!active) { active = new Map(); pending.set(destination, active); }
  const starts = canonicalKind === 'playNow' || canonicalKind === 'shuffle';
  if (starts && active.has(key)) return active.get(key);
  options.onStarted?.({ operationId });
  log ??= getLogger().child({ component: 'media-item-action' });
  log.info('item-action.started', { kind: canonicalKind, operationId, targetId: destination.id, contentId: input.contentId });
  const command = { kind: canonicalKind, item: input, collectionItems, clearRest, operationId, tappedAt: Date.now(), options };
  let result;
  try { result = destination.execute(command); }
  catch (error) { result = { ok: false, code: 'ITEM_ACTION_FAILED', reason: error.message }; }
  const promise = Promise.resolve(result).then(result => {
    log.info('item-action.finished', { kind: canonicalKind, operationId, targetId: destination.id, ok: result?.ok === true, code: result?.code });
    return result;
  }).finally(() => { if (active.get(key) === promise) active.delete(key); });
  if (starts) active.set(key, promise);
  return promise;
}
