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
 *
 * Observability contract: every operation returns a DISCRIMINATED result so a
 * caller can never confuse "no save exists" with "the save server failed". A
 * GET is one of `{status:'absent'}` | `{status:'ok', data}` | `{status:'error'}`.
 * A PUT/DELETE is `{status:'ok'}` | `{status:'error'}`. Failures are logged here
 * (warn) — they are NEVER swallowed into a bare null/false.
 */

import getLogger from '@/lib/logging/Logger.js';

let _log;
const moduleLog = () => (_log ??= getLogger().child({ component: 'emulator-save-client' }));

const BASE = '/api/v1/emulator';
export const DEFAULT_SLOT = 'auto';

// Result constructors — the single source of truth for the discriminated shape.
const absent = () => ({ status: 'absent' });
const ok = (data) => (data === undefined ? { status: 'ok' } : { status: 'ok', data });
const errorResult = (httpStatus, error) => ({ status: 'error', httpStatus: httpStatus ?? null, error: error ?? null });

function pickFetch(fetchImpl) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof f !== 'function') throw new Error('saveClient: no fetch implementation');
  return f;
}

/**
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl]  fetch(url, init) — defaults to global fetch.
 * @param {string}   [opts.baseUrl]    endpoint root (default /api/v1/emulator).
 * @param {object}   [opts.logger]     child logger (defaults to module logger).
 */
export function createSaveClient({ fetchImpl, baseUrl = BASE, logger } = {}) {
  const log = () => logger || moduleLog();
  const doFetch = (...args) => pickFetch(fetchImpl)(...args);
  const q = (user) => `?user=${encodeURIComponent(user)}`;
  const seg = (s) => encodeURIComponent(s);

  const saveUrl = (system, gameId, user) =>
    `${baseUrl}/save/${seg(system)}/${seg(gameId)}${q(user)}`;
  const stateUrl = (system, gameId, slot, user) =>
    `${baseUrl}/state/${seg(system)}/${seg(gameId)}/${seg(slot)}${q(user)}`;

  // GET → discriminated result.
  //   204/404            → absent
  //   ok + bytes         → ok(data)
  //   ok + empty body    → absent
  //   non-OK / thrown    → error (logged warn)
  async function getBlob(url) {
    let res;
    try {
      res = await doFetch(url);
    } catch (err) {
      log().warn('save.get-failed', { url, httpStatus: null, error: err && err.message });
      return errorResult(null, err && err.message);
    }
    if (!res || res.status === 204 || res.status === 404) return absent();
    if (!res.ok) {
      log().warn('save.get-failed', { url, httpStatus: res.status });
      return errorResult(res.status);
    }
    let buf;
    try {
      buf = await res.arrayBuffer();
    } catch (err) {
      log().warn('save.get-failed', { url, httpStatus: res.status, error: err && err.message });
      return errorResult(res.status, err && err.message);
    }
    return buf && buf.byteLength > 0 ? ok(buf) : absent();
  }

  async function putBlob(url, body) {
    let res;
    try {
      res = await doFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    } catch (err) {
      log().warn('save.put-failed', { url, httpStatus: null, error: err && err.message });
      return errorResult(null, err && err.message);
    }
    if (res && res.ok) return ok();
    log().warn('save.put-failed', { url, httpStatus: res && res.status });
    return errorResult(res && res.status);
  }

  async function deleteBlob(url) {
    let res;
    try {
      res = await doFetch(url, { method: 'DELETE' });
    } catch (err) {
      log().warn('save.delete-failed', { url, httpStatus: null, error: err && err.message });
      return errorResult(null, err && err.message);
    }
    if (res && res.ok) return ok();
    log().warn('save.delete-failed', { url, httpStatus: res && res.status });
    return errorResult(res && res.status);
  }

  return {
    // --- low-level, explicit (all return discriminated results) ---
    getSave: (system, gameId, user) => getBlob(saveUrl(system, gameId, user)),
    putSave: (system, gameId, user, body) => putBlob(saveUrl(system, gameId, user), body),
    deleteSave: (system, gameId, user) => deleteBlob(saveUrl(system, gameId, user)),
    getState: (system, gameId, user, slot = DEFAULT_SLOT) => getBlob(stateUrl(system, gameId, slot, user)),
    putState: (system, gameId, user, body, slot = DEFAULT_SLOT) => putBlob(stateUrl(system, gameId, slot, user), body),
    deleteState: (system, gameId, user, slot = DEFAULT_SLOT) => deleteBlob(stateUrl(system, gameId, slot, user)),

    // --- saveMode-aware convenience (used by the launch flow) ---
    /**
     * Load the resume blob, snapshot-preferred for battery. Returns a
     * discriminated result with `kind` ('state'|'battery') on success so the
     * caller injects via the matching engine path.
     */
    async loadResume({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') {
        const r = await getBlob(stateUrl(system, gameId, slot, user));
        return r.status === 'ok' ? { ...r, kind: 'state' } : r;
      }
      if (saveMode === 'battery') {
        const s = await getBlob(stateUrl(system, gameId, slot, user));
        if (s.status === 'ok') return { ...s, kind: 'state' };
        const b = await getBlob(saveUrl(system, gameId, user));
        if (b.status === 'ok') return { ...b, kind: 'battery' };
        return s.status === 'error' ? s : b; // surface an error over a plain absent
      }
      return absent();
    },
    /**
     * Persist the resume blob(s) for the mode. `captured` is { state?, battery? };
     * battery writes both. Returns ok only if every write succeeds.
     */
    async persistResume({ system, gameId, user, saveMode, captured, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') {
        if (!captured?.state) return errorResult(null, 'no state bytes');
        return putBlob(stateUrl(system, gameId, slot, user), captured.state);
      }
      if (saveMode === 'battery') {
        const results = [];
        if (captured?.state) results.push(await putBlob(stateUrl(system, gameId, slot, user), captured.state));
        if (captured?.battery) results.push(await putBlob(saveUrl(system, gameId, user), captured.battery));
        if (!results.length) return errorResult(null, 'no bytes');
        return results.every((r) => r.status === 'ok') ? ok() : errorResult(null, 'partial persist');
      }
      return errorResult(null, `unsupported saveMode: ${saveMode}`);
    },
    /** Erase all resume blobs for the mode (reset / overwrite). */
    async clearResume({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'state') return deleteBlob(stateUrl(system, gameId, slot, user));
      if (saveMode === 'battery') {
        const a = await deleteBlob(stateUrl(system, gameId, slot, user));
        const b = await deleteBlob(saveUrl(system, gameId, user));
        return a.status === 'ok' && b.status === 'ok' ? ok() : errorResult(null, 'partial clear');
      }
      return errorResult(null, `unsupported saveMode: ${saveMode}`);
    },
    /** Persist the resume blob for this game's save mode. Returns a discriminated result. */
    persist({ system, gameId, user, saveMode, body, slot = DEFAULT_SLOT }) {
      if (saveMode === 'battery') return putBlob(saveUrl(system, gameId, user), body);
      if (saveMode === 'state') return putBlob(stateUrl(system, gameId, slot, user), body);
      return Promise.resolve(errorResult(null, `unsupported saveMode: ${saveMode}`));
    },
    /** Erase the resume blob for this game's save mode (reset / start over). */
    clear({ system, gameId, user, saveMode, slot = DEFAULT_SLOT }) {
      if (saveMode === 'battery') return deleteBlob(saveUrl(system, gameId, user));
      if (saveMode === 'state') return deleteBlob(stateUrl(system, gameId, slot, user));
      return Promise.resolve(errorResult(null, `unsupported saveMode: ${saveMode}`));
    },
  };
}

export default createSaveClient;
