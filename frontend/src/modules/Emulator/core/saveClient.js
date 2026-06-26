/**
 * saveClient — thin, injectable HTTP client for per-user emulator saves/states.
 *
 * Talks to the emulator router's blob endpoints:
 *   GET/PUT/DELETE /save/:system/:gameId            (battery .srm)
 *   GET/PUT/DELETE /state/:system/:gameId/:slot      (save-state)
 *
 * The backend keys blobs by the `user` query param. The save model is
 * structurally many-slots-per-user, but the UX surfaces a single resume point —
 * hence DEFAULT_SLOT. fetch is injected so this is fully unit-testable.
 */

const BASE = '/api/v1/emulator';
export const DEFAULT_SLOT = 'auto';

function pickFetch(fetchImpl) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof f !== 'function') throw new Error('saveClient: no fetch implementation');
  return f;
}

/**
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl]  fetch(url, init) — defaults to global fetch.
 * @param {string}   [opts.baseUrl]    endpoint root (default /api/v1/emulator).
 */
export function createSaveClient({ fetchImpl, baseUrl = BASE } = {}) {
  const doFetch = (...args) => pickFetch(fetchImpl)(...args);
  const q = (user) => `?user=${encodeURIComponent(user)}`;
  const seg = (s) => encodeURIComponent(s);

  const saveUrl = (system, gameId, user) =>
    `${baseUrl}/save/${seg(system)}/${seg(gameId)}${q(user)}`;
  const stateUrl = (system, gameId, slot, user) =>
    `${baseUrl}/state/${seg(system)}/${seg(gameId)}/${seg(slot)}${q(user)}`;

  // GET → ArrayBuffer, or null when the blob is absent (204) or any non-OK.
  async function getBlob(url) {
    const res = await doFetch(url);
    if (!res || res.status === 204 || res.status === 404) return null;
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf && buf.byteLength > 0 ? buf : null;
  }

  async function putBlob(url, body) {
    const res = await doFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
    return !!(res && res.ok);
  }

  async function deleteBlob(url) {
    const res = await doFetch(url, { method: 'DELETE' });
    return !!(res && res.ok);
  }

  return {
    // --- low-level, explicit ---
    getSave: (system, gameId, user) => getBlob(saveUrl(system, gameId, user)),
    putSave: (system, gameId, user, body) => putBlob(saveUrl(system, gameId, user), body),
    deleteSave: (system, gameId, user) => deleteBlob(saveUrl(system, gameId, user)),
    getState: (system, gameId, user, slot = DEFAULT_SLOT) => getBlob(stateUrl(system, gameId, slot, user)),
    putState: (system, gameId, user, body, slot = DEFAULT_SLOT) => putBlob(stateUrl(system, gameId, slot, user), body),
    deleteState: (system, gameId, user, slot = DEFAULT_SLOT) => deleteBlob(stateUrl(system, gameId, slot, user)),

    // --- saveMode-aware convenience (used by the launch flow) ---
    /** Load the resume blob for this game's save mode (null if none/absent). */
    loadResume({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'battery') return getBlob(saveUrl(system, gameId, user));
      if (saveMode === 'state') return getBlob(stateUrl(system, gameId, slot, user));
      return Promise.resolve(null);
    },
    /** Persist the resume blob for this game's save mode. */
    persist({ system, gameId, user, saveMode, body, slot = DEFAULT_SLOT }) {
      if (saveMode === 'battery') return putBlob(saveUrl(system, gameId, user), body);
      if (saveMode === 'state') return putBlob(stateUrl(system, gameId, slot, user), body);
      return Promise.resolve(false);
    },
    /** Erase the resume blob for this game's save mode (reset / start over). */
    clear({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'battery') return deleteBlob(saveUrl(system, gameId, user));
      if (saveMode === 'state') return deleteBlob(stateUrl(system, gameId, slot, user));
      return Promise.resolve(false);
    },
  };
}

export default createSaveClient;
