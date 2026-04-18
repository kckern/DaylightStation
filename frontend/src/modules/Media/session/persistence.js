export const PERSIST_KEY = 'media-app.session';
export const PERSIST_SCHEMA_VERSION = 1;

function serialize(snapshot, { wasPlayingOnUnload } = {}) {
  return JSON.stringify({
    schemaVersion: PERSIST_SCHEMA_VERSION,
    sessionId: snapshot.sessionId,
    updatedAt: new Date().toISOString(),
    wasPlayingOnUnload: !!wasPlayingOnUnload,
    snapshot,
  });
}

export function writePersistedSession(snapshot, { wasPlayingOnUnload } = {}) {
  const payload = serialize(snapshot, { wasPlayingOnUnload });
  try {
    localStorage.setItem(PERSIST_KEY, payload);
    return { ok: true };
  } catch (err) {
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
