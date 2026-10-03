// frontend/src/modules/Media/session/persistence.js
// PersistedSession v1 — byte-compatible with sessions written by the previous
// app generation (docs/reference/media/media-app-technical.md §11.2/§11.3).
// Do not change the serialized shape without a schema bump + migration.
import { STORAGE_KEYS, SESSION_SCHEMA_VERSION } from '../constants.js';

export const PERSIST_KEY = STORAGE_KEYS.SESSION;
export const PERSIST_SCHEMA_VERSION = SESSION_SCHEMA_VERSION;

function serialize(snapshot, { wasPlayingOnUnload } = {}) {
  return JSON.stringify({
    schemaVersion: PERSIST_SCHEMA_VERSION,
    sessionId: snapshot.sessionId,
    updatedAt: new Date().toISOString(),
    wasPlayingOnUnload: !!wasPlayingOnUnload,
    snapshot,
  });
}

function truncatePastPlayed(snapshot) {
  const { items, currentIndex } = snapshot.queue;
  if (currentIndex <= 0) return snapshot; // nothing to truncate
  const trimmed = items.slice(currentIndex);
  return {
    ...snapshot,
    queue: { ...snapshot.queue, items: trimmed, currentIndex: 0 },
  };
}

export function writePersistedSession(snapshot, { wasPlayingOnUnload } = {}) {
  const firstPayload = serialize(snapshot, { wasPlayingOnUnload });
  try {
    localStorage.setItem(PERSIST_KEY, firstPayload);
    return { ok: true };
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')) {
      const truncated = truncatePastPlayed(snapshot);
      try {
        localStorage.setItem(PERSIST_KEY, serialize(truncated, { wasPlayingOnUnload }));
        return { ok: true, truncated: true };
      } catch (err2) {
        return { ok: false, error: err2 };
      }
    }
    return { ok: false, error: err };
  }
}

const SESSION_STATES = new Set(['idle', 'ready', 'loading', 'playing', 'paused', 'buffering', 'stalled', 'ended', 'error']);
const isText = (value) => typeof value === 'string' && value.length > 0;

/**
 * Structural validity of a persisted snapshot (RELY.7a): only data this
 * generation can restore truthfully is accepted. Lenient on optional
 * metadata (the v1 contract never required it), strict on everything the
 * session, queue, config and resume spot are rebuilt from.
 */
export function isRestorableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (!isText(snapshot.sessionId) || !SESSION_STATES.has(snapshot.state)) return false;
  if (snapshot.currentItem !== null && (typeof snapshot.currentItem !== 'object' || !isText(snapshot.currentItem?.contentId))) return false;
  if (typeof snapshot.position !== 'number' || !Number.isFinite(snapshot.position) || snapshot.position < 0) return false;
  const queue = snapshot.queue;
  if (!queue || !Array.isArray(queue.items)) return false;
  if (!queue.items.every((item) => item && isText(item.queueItemId) && isText(item.contentId))) return false;
  if (!Number.isInteger(queue.currentIndex) || queue.currentIndex < -1 || queue.currentIndex >= queue.items.length) return false;
  const config = snapshot.config;
  if (!config || typeof config !== 'object' || typeof config.shuffle !== 'boolean'
    || !['off', 'one', 'all'].includes(config.repeat)) return false;
  if (!snapshot.meta || typeof snapshot.meta !== 'object') return false;
  return true;
}

/**
 * @returns {null | 'schema-mismatch' | 'malformed' | { snapshot, wasPlayingOnUnload }}
 * Older/other schema versions and malformed data are reported (never
 * guessed at) so the caller discards them and starts clean.
 */
export function readPersistedSession() {
  let raw = null;
  try { raw = localStorage.getItem(PERSIST_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return 'malformed'; }
  if (!parsed || typeof parsed !== 'object') return 'malformed';
  if (parsed.schemaVersion !== PERSIST_SCHEMA_VERSION) return 'schema-mismatch';
  if (!isRestorableSnapshot(parsed.snapshot)) return 'malformed';
  return {
    snapshot: parsed.snapshot,
    wasPlayingOnUnload: !!parsed.wasPlayingOnUnload,
  };
}

export function clearPersistedSession() {
  try { localStorage.removeItem(PERSIST_KEY); } catch { /* storage unavailable */ }
}
