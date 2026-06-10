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

export function readPersistedSession() {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== PERSIST_SCHEMA_VERSION) return 'schema-mismatch';
    if (!parsed?.snapshot) return null;
    return {
      snapshot: parsed.snapshot,
      wasPlayingOnUnload: !!parsed.wasPlayingOnUnload,
    };
  } catch {
    return null;
  }
}

export function clearPersistedSession() {
  localStorage.removeItem(PERSIST_KEY);
}
