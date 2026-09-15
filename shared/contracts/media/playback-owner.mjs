// Additive owner provenance for handoff-capable session snapshots. This module
// intentionally validates only the optional extension so legacy snapshots stay
// byte-compatible; shapes.mjs composes it with the base SessionSnapshot check.
const isString = (value) => typeof value === 'string' && value.length > 0;
const isRevision = (value) => Number.isInteger(value) && value >= 0;

const result = (errors) => ({ valid: errors.length === 0, errors });

export function validatePlaybackOwnerIdentity(identity) {
  const errors = [];
  if (!identity || typeof identity !== 'object') return result(['PlaybackOwnerIdentity: required object']);
  if (!isString(identity.ownerInstanceId)) errors.push('ownerInstanceId: required string');
  for (const key of ['playbackRevision', 'queueRevision']) {
    if (!isRevision(identity[key])) errors.push(`${key}: required non-negative integer`);
  }
  if (!isString(identity.sessionId)) errors.push('sessionId: required string');
  if (identity.contentId !== null && !isString(identity.contentId)) errors.push('contentId: string or null');
  if (identity.queueItemId !== null && !isString(identity.queueItemId)) errors.push('queueItemId: string or null');
  if ((identity.contentId === null) !== (identity.queueItemId === null)) {
    errors.push('contentId and queueItemId: both null or both strings');
  }
  return result(errors);
}

export function validatePlaybackOwnerSessionSnapshot(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') return result(['SessionSnapshot: required object']);
  const owner = snapshot.meta?.playbackOwner;
  if (owner != null) {
    const ownerResult = validatePlaybackOwnerIdentity(owner);
    if (!ownerResult.valid) errors.push(...ownerResult.errors.map((error) => `playbackOwner.${error}`));
  }
  const order = snapshot.queue?.executionOrder;
  const items = Array.isArray(snapshot.queue?.items) ? snapshot.queue.items : [];
  const currentIndex = snapshot.queue?.currentIndex;
  const current = Number.isInteger(currentIndex) && currentIndex >= 0 ? items[currentIndex] : null;
  const ids = items.map((item) => item?.queueItemId);
  if (new Set(ids).size !== ids.length) errors.push('queue.items: duplicate queue item ID');
  if (Number.isInteger(currentIndex) && (currentIndex < -1 || currentIndex >= items.length)) {
    errors.push('queue.currentIndex: out of range');
  }
  if (order != null) {
    if (!Array.isArray(order) || order.some((id) => !isString(id))) {
      errors.push('queue.executionOrder: optional array of queue item IDs');
    } else {
      const knownIds = new Set(items.map((item) => item?.queueItemId));
      if (order.some((id) => !knownIds.has(id))) errors.push('queue.executionOrder: references unknown item');
      if (order.length > 0 && order[0] !== current?.queueItemId) {
        errors.push('queue.executionOrder: must begin at current entry');
      }
      if (current && order.length === 0) errors.push('queue.executionOrder: required for current entry');
    }
  }
  if (owner != null && owner.sessionId !== snapshot.sessionId) {
    errors.push('playbackOwner.sessionId: must match snapshot session');
  }
  if (owner != null && current) {
    if (owner.queueItemId !== current.queueItemId || owner.contentId !== current.contentId) {
      errors.push('playbackOwner: must match current queue entry');
    }
  }
  return result(errors);
}
