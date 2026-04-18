import { isSessionState, isRepeatMode } from './commands.mjs';

const FORMATS = new Set([
  'video', 'dash_video', 'audio', 'singalong', 'readalong',
  'readable_paged', 'readable_flow', 'app', 'image', 'composite',
]);

const isStr   = (v) => typeof v === 'string' && v.length > 0;
const isNum   = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool  = (v) => typeof v === 'boolean';
const isInt0  = (v) => isNum(v) && Number.isInteger(v) && v >= 0;
const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;

function result(errors) {
  return { valid: errors.length === 0, errors };
}

export function validatePlayableItem(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['PlayableItem: not an object']);
  if (!isStr(obj.contentId)) e.push('PlayableItem.contentId: required string');
  if (!isStr(obj.format) || !FORMATS.has(obj.format)) e.push('PlayableItem.format: invalid');
  if (obj.title != null && !isStr(obj.title)) e.push('PlayableItem.title: must be string');
  if (obj.duration != null && !isNum(obj.duration)) e.push('PlayableItem.duration: must be number');
  return result(e);
}

export function validateQueueItem(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['QueueItem: not an object']);
  if (!isStr(obj.queueItemId)) e.push('QueueItem.queueItemId: required');
  if (!isStr(obj.contentId))   e.push('QueueItem.contentId: required');
  if (obj.priority && obj.priority !== 'upNext' && obj.priority !== 'queue') {
    e.push('QueueItem.priority: must be "upNext" or "queue"');
  }
  return result(e);
}

export function validateQueueSnapshot(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['QueueSnapshot: not an object']);
  if (!Array.isArray(obj.items)) e.push('QueueSnapshot.items: required array');
  else {
    obj.items.forEach((item, i) => {
      const r = validateQueueItem(item);
      if (!r.valid) e.push(`QueueSnapshot.items[${i}]: ${r.errors.join('; ')}`);
    });
  }
  if (!Number.isInteger(obj.currentIndex)) e.push('QueueSnapshot.currentIndex: required integer');
  if (!isInt0(obj.upNextCount)) e.push('QueueSnapshot.upNextCount: required non-negative int');
  return result(e);
}

export function validateSessionSnapshot(obj) {
  const e = [];
  if (!obj || typeof obj !== 'object') return result(['SessionSnapshot: not an object']);
  if (!isStr(obj.sessionId))  e.push('SessionSnapshot.sessionId: required');
  if (!isSessionState(obj.state)) e.push('SessionSnapshot.state: invalid');
  if (obj.currentItem !== null) {
    const r = validatePlayableItem(obj.currentItem);
    if (!r.valid) e.push(`SessionSnapshot.currentItem: ${r.errors.join('; ')}`);
  }
  if (!isNum(obj.position) || obj.position < 0) e.push('SessionSnapshot.position: required non-negative number');
  const qr = validateQueueSnapshot(obj.queue);
  if (!qr.valid) e.push(`SessionSnapshot.queue: ${qr.errors.join('; ')}`);
  const c = obj.config;
  if (!c || typeof c !== 'object') e.push('SessionSnapshot.config: required object');
  else {
    if (!isBool(c.shuffle))          e.push('config.shuffle: required boolean');
    if (!isRepeatMode(c.repeat))     e.push('config.repeat: required enum');
    if (c.shader !== null && !isStr(c.shader)) e.push('config.shader: string or null');
    if (!inRange(c.volume, 0, 100))  e.push('config.volume: 0..100');
    if (c.playbackRate != null && !isNum(c.playbackRate)) e.push('config.playbackRate: number');
  }
  if (!obj.meta || !isStr(obj.meta.ownerId) || !isStr(obj.meta.updatedAt)) {
    e.push('SessionSnapshot.meta: required { ownerId, updatedAt }');
  }
  return result(e);
}

export function createEmptyQueueSnapshot() {
  return { items: [], currentIndex: -1, upNextCount: 0 };
}

export function createIdleSessionSnapshot({ sessionId, ownerId, now = new Date() } = {}) {
  return {
    sessionId,
    state: 'idle',
    currentItem: null,
    position: 0,
    queue: createEmptyQueueSnapshot(),
    config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
    meta: { ownerId, updatedAt: now.toISOString() },
  };
}
