/**
 * /api/v1/school/word-ladder client (and …/word-ladder/test for read-only
 * test sittings — the door's `test` param). Status-aware and never throws:
 * the program must tell 403 from 404 from 0.
 */
import { wordLadderLog } from './wordLadderLog.js';

const enc = encodeURIComponent;

export function createWordLadderApi({ test = false } = {}) {
  const BASE = `/api/v1/school/word-ladder${test ? '/test' : ''}`;

  async function call(path, { method = 'GET', body } = {}) {
    const startedAt = Date.now();
    try {
      const init = { method, credentials: 'same-origin', headers: {} };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
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
    open: ({ userId, deckId, scenario = null }) => call('/open', { method: 'POST', body: { userId, deckId, ...(test && scenario ? { scenario } : {}) } }),
    respond: (sittingId, { userId, itemId, response }) => call(`/sittings/${enc(sittingId)}/items/${enc(itemId)}`, { method: 'POST', body: { userId, response } }),
    get: (sittingId, userId) => call(`/sittings/${enc(sittingId)}?userId=${enc(userId)}`),
    close: (sittingId, { userId, reason }) => call(`/sittings/${enc(sittingId)}/close`, { method: 'POST', body: { userId, reason } }),
  };
}

export default createWordLadderApi;
