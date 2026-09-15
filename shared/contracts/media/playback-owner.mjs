// Additive owner provenance for handoff-capable session snapshots. This module
// intentionally validates only the optional extension so legacy snapshots stay
// byte-compatible; shapes.mjs composes it with the base SessionSnapshot check.
const isString = (value) => typeof value === 'string' && value.length > 0;
const isRevision = (value) => Number.isInteger(value) && value >= 0;

const result = (errors) => ({ valid: errors.length === 0, errors });
const IDENTITY_FIELDS = Object.freeze([
  'ownerInstanceId', 'playbackRevision', 'queueRevision',
  'sessionId', 'contentId', 'queueItemId',
]);
const SESSION_STATES = new Set(['idle', 'loading', 'playing', 'paused', 'buffering', 'stalled', 'ended', 'error', 'ready']);
const PLAYABLE_FORMATS = new Set([
  'video', 'dash_video', 'hls_video', 'audio', 'singalong', 'readalong',
  'readable_paged', 'readable_flow', 'app', 'image', 'composite', 'game',
]);

export function samePlaybackOwnerIdentity(left, right) {
  return Boolean(left && right && IDENTITY_FIELDS.every((key) => left[key] === right[key]));
}

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
  } else if (owner != null && (owner.contentId !== null || owner.queueItemId !== null)) {
    errors.push('playbackOwner: idle queue requires null content and entry identity');
  }
  return result(errors);
}

/**
 * Validate the identity-bearing parts of an incoming owner snapshot before an
 * existing playback owner mutates. Legacy snapshots may omit the additive
 * owner/order fields; their deterministic forward order is derived from the
 * current queue cursor. Scalar playback config follows the same bounded
 * normalization used by the concrete owners.
 */
export function preparePlaybackOwnerAdoption(snapshot) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, errors: ['SessionSnapshot: required object'], snapshot: null };
  }

  let detached;
  try {
    detached = structuredClone(snapshot);
  } catch {
    return { valid: false, errors: ['SessionSnapshot: must be detachable'], snapshot: null };
  }

  const queue = detached.queue;
  const items = Array.isArray(queue?.items) ? queue.items : null;
  if (!isString(detached.sessionId)) errors.push('sessionId: required string');
  if (!SESSION_STATES.has(detached.state)) errors.push('state: invalid');
  if (!detached.meta || !isString(detached.meta.ownerId) || !isString(detached.meta.updatedAt)) {
    errors.push('meta: required ownerId and updatedAt');
  }
  if (!detached.config || typeof detached.config !== 'object') errors.push('config: required object');
  if (!items) errors.push('queue.items: required array');
  if (!Number.isInteger(queue?.currentIndex)) errors.push('queue.currentIndex: required integer');
  if (!Number.isInteger(queue?.upNextCount) || queue.upNextCount < 0) {
    errors.push('queue.upNextCount: required non-negative integer');
  }
  if (items) {
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') errors.push(`queue.items[${index}]: required object`);
      else {
        if (!isString(item.queueItemId)) errors.push(`queue.items[${index}].queueItemId: required string`);
        if (!isString(item.contentId)) errors.push(`queue.items[${index}].contentId: required string`);
        if (item.priority != null && item.priority !== 'queue' && item.priority !== 'upNext') {
          errors.push(`queue.items[${index}].priority: invalid`);
        }
      }
    });
  }

  const current = items && Number.isInteger(queue?.currentIndex) && queue.currentIndex >= 0
    ? items[queue.currentIndex]
    : null;
  if (current) {
    if (!detached.currentItem || typeof detached.currentItem !== 'object') {
      errors.push('currentItem: required for current queue entry');
    } else {
      if (!isString(detached.currentItem.contentId) || detached.currentItem.contentId !== current.contentId) {
        errors.push('currentItem.contentId: must match current queue entry');
      }
      if (!PLAYABLE_FORMATS.has(detached.currentItem.format)) errors.push('currentItem.format: invalid');
    }
  } else if (detached.currentItem != null) {
    if (typeof detached.currentItem !== 'object'
      || !isString(detached.currentItem.contentId)
      || !PLAYABLE_FORMATS.has(detached.currentItem.format)) {
      errors.push('currentItem: invalid playable item');
    }
  }

  if (errors.length === 0 && queue.executionOrder == null) {
    queue.executionOrder = queue.currentIndex >= 0
      ? items.slice(queue.currentIndex).map((item) => item.queueItemId)
      : [];
  }

  if (errors.length === 0) {
    const ownerResult = validatePlaybackOwnerSessionSnapshot(detached);
    if (!ownerResult.valid) errors.push(...ownerResult.errors);
  }
  if (errors.length > 0) return { valid: false, errors, snapshot: null };

  const position = Number(detached.position);
  detached.position = Number.isFinite(position) ? Math.max(0, position) : 0;
  const config = detached.config && typeof detached.config === 'object' ? detached.config : {};
  const volume = Number(config.volume);
  const playbackRate = Number(config.playbackRate);
  detached.config = {
    shuffle: typeof config.shuffle === 'boolean' ? config.shuffle : false,
    repeat: ['off', 'one', 'all'].includes(config.repeat) ? config.repeat : 'off',
    shader: config.shader === null || typeof config.shader === 'string' ? config.shader : null,
    volume: Number.isFinite(volume) ? Math.round(Math.min(100, Math.max(0, volume))) : 50,
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
  };
  queue.upNextCount = items.filter((item) => item.priority === 'upNext').length;
  return { valid: true, errors: [], snapshot: detached };
}
