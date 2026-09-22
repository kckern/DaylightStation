/** Decode the additive wake/load operation without losing its tap identity. */
export function decodeItemAction(value) {
  if (value == null) return null;
  const action = typeof value === 'string' ? JSON.parse(value) : value;
  if (!action || !['playNow', 'shuffle', 'playNext', 'playFirst', 'add'].includes(action.kind)
    || typeof action.operationId !== 'string' || !action.operationId
    || !Number.isFinite(action.tappedAt)
    || typeof action.item?.contentId !== 'string' || !action.item.contentId) {
    throw new TypeError('Invalid item action');
  }
  return { ...action, op: 'item-action' };
}
