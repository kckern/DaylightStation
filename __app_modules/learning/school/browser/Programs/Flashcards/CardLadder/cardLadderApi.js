/**
 * /api/v1/school/card-ladder client (and …/card-ladder/test for read-only
 * test sittings — the door's `test` param). Status-aware and never throws:
 * the program must tell 403 from 404 from 0.
 */
import { cardLadderLog } from "./cardLadderLog.js";
import { createSchoolEndpointClient } from '../../../runtime/schoolEndpointClient.js';

const enc = encodeURIComponent;

export function createCardLadderApi({ test = false, ...options } = {}) {
  const BASE = `/api/v1/school/card-ladder${test ? '/test' : ''}`;

  const client = createSchoolEndpointClient({ ...options, base: BASE });
  async function call(path, { method = 'GET', body, raw = false, contentType = null, ...requestOptions } = {}) {
    const startedAt = Date.now();
    const result = await client.request(path, {
      ...requestOptions, method, body, raw, headers: contentType ? { 'Content-Type': contentType } : {},
    });
    if (!result.ok) {
      const detail = { path: path.split('?')[0], method, status: result.status, ms: Date.now() - startedAt, kind: result.error?.kind, test };
      if (result.status) cardLadderLog.apiRejected(detail);
      else cardLadderLog.apiFailed(detail);
    }
    return client.finish(result);
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
    /** This week's dictation (spec 2026-11-06): a focused run in the sitting,
     *  before or after the daily goal. */
    dictation: (sittingId, { userId }) => call(`/sittings/${enc(sittingId)}/dictation`, { method: 'POST', body: { userId } }),
    /** The practice menu on request — review is open anytime (owner, 2026-11-06). */
    menu: (sittingId, { userId }) => call(`/sittings/${enc(sittingId)}/menu`, { method: 'POST', body: { userId } }),
    /** Learn more words (ruling 2026-09-23): one more guided round over the
     *  next new words, from the menu or the Done summary. */
    learnMore: (sittingId, { userId }) => call(`/sittings/${enc(sittingId)}/learn-more`, { method: 'POST', body: { userId } }),
    /** "My words" (practice menu). `sittingId` is required on the test mount
     *  (it reads that sitting's shadow); live accepts it too. */
    words: ({ userId, deckId, sittingId = null }) => call(`/words?userId=${enc(userId)}&deckId=${enc(deckId)}${sittingId ? `&sittingId=${enc(sittingId)}` : ''}`),
  };
}

export default createCardLadderApi;
