/**
 * /api/v1/school/card-ladder client (and …/card-ladder/test for read-only
 * test sittings — the door's `test` param). Status-aware and never throws:
 * the program must tell 403 from 404 from 0.
 */
import { cardLadderLog } from './cardLadderLog.js';

const enc = encodeURIComponent;

export function createCardLadderApi({ test = false } = {}) {
  const BASE = `/api/v1/school/card-ladder${test ? '/test' : ''}`;

  async function call(path, { method = 'GET', body, raw = false, contentType = null } = {}) {
    const startedAt = Date.now();
    try {
      const init = { method, credentials: 'same-origin', headers: {} };
      if (body !== undefined) {
        if (raw) {
          init.body = body;
          if (contentType) init.headers['Content-Type'] = contentType;
        } else {
          init.body = JSON.stringify(body);
          init.headers['Content-Type'] = 'application/json';
        }
      }
      const r = await fetch(`${BASE}${path}`, init);
      const data = await r.json().catch(() => null);
      if (!r.ok) cardLadderLog.apiRejected({ path: path.split('?')[0], method, status: r.status, ms: Date.now() - startedAt, error: data?.error ?? null, test });
      return { ok: r.ok, status: r.status, data };
    } catch (error) {
      cardLadderLog.apiFailed({ path: path.split('?')[0], method, error: error?.message ?? String(error), test });
      return { ok: false, status: 0, data: null };
    }
  }

  return {
    test,
    /** The start card (read-only — nothing opens before Start). Test mode reads what `scenario` would open on. */
    intro: ({ userId, deckId, scenario = null }) => call(`/intro?userId=${enc(userId)}&deckId=${enc(deckId)}${test && scenario ? `&scenario=${enc(scenario)}` : ''}`),
    open: ({ userId, deckId, scenario = null, capabilities = null }) => call('/open', {
      method: 'POST',
      body: { userId, deckId, ...(test && scenario ? { scenario } : {}), ...(capabilities ? { capabilities } : {}) },
    }),
    respond: (sittingId, { userId, itemId, response }) => call(`/sittings/${enc(sittingId)}/items/${enc(itemId)}`, { method: 'POST', body: { userId, response } }),
    get: (sittingId, userId) => call(`/sittings/${enc(sittingId)}?userId=${enc(userId)}`),
    close: (sittingId, { userId, reason }) => call(`/sittings/${enc(sittingId)}/close`, { method: 'POST', body: { userId, reason } }),
    /** A say task's take — raw audio, Content-Type = the blob's own mime type
     *  (never JSON-wrapped: this is a body, not a field). */
    uploadRecording: (sittingId, { userId, itemId, blob, ext = null }) => {
      const q = new URLSearchParams({ userId });
      if (ext) q.set('ext', ext);
      return call(`/sittings/${enc(sittingId)}/recordings/${enc(itemId)}?${q.toString()}`, {
        method: 'POST', body: blob, raw: true, contentType: blob?.type || 'application/octet-stream',
      });
    },
    /** Practice-menu entry after the day's goal/cap is reached (spec §6).
     *  Unset options are left out, never sent as null: the route's defaults
     *  (filter 'introduced', frontSide 'term', help true) apply only to an
     *  ABSENT field, and the engine refuses a null filter or front side. */
    practice: (sittingId, {
      userId, mode, help = null, filter = null, chosen = null, frontSide = null,
    }) => call(`/sittings/${enc(sittingId)}/practice`, {
      method: 'POST',
      body: Object.fromEntries(Object.entries({ userId, mode, help, filter, chosen, frontSide }).filter(([, v]) => v !== null && v !== undefined)),
    }),
    /** "My words" (practice menu). `sittingId` is required on the test mount
     *  (it reads that sitting's shadow); live accepts it too. */
    words: ({ userId, deckId, sittingId = null }) => call(`/words?userId=${enc(userId)}&deckId=${enc(deckId)}${sittingId ? `&sittingId=${enc(sittingId)}` : ''}`),
  };
}

export default createCardLadderApi;
