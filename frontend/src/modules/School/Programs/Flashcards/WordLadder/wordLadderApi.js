/**
 * /api/v1/school/word-ladder client (and …/word-ladder/test for read-only
 * test sittings — the door's `test` param). Status-aware and never throws:
 * the program must tell 403 from 404 from 0.
 */
import { wordLadderLog } from './wordLadderLog.js';

const enc = encodeURIComponent;

export function createWordLadderApi({ test = false } = {}) {
  const BASE = `/api/v1/school/word-ladder${test ? '/test' : ''}`;

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
      if (!r.ok) wordLadderLog.apiRejected({ path: path.split('?')[0], method, status: r.status, ms: Date.now() - startedAt, error: data?.error ?? null, test });
      return { ok: r.ok, status: r.status, data };
    } catch (error) {
      wordLadderLog.apiFailed({ path: path.split('?')[0], method, error: error?.message ?? String(error), test });
      return { ok: false, status: 0, data: null };
    }
  }

  return {
    test,
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
    /** Practice-menu entry after the day's goal/cap is reached (spec §6). */
    practice: (sittingId, {
      userId, mode, help = null, filter = null, chosen = null, frontSide = null,
    }) => call(`/sittings/${enc(sittingId)}/practice`, {
      method: 'POST', body: { userId, mode, help, filter, chosen, frontSide },
    }),
    /** "My words" (practice menu). */
    words: ({ userId, deckId }) => call(`/words?userId=${enc(userId)}&deckId=${enc(deckId)}`),
  };
}

export default createWordLadderApi;
