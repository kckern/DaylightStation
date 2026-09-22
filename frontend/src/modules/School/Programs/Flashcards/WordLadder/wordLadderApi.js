/**
 * /api/v1/school/word-ladder client. Status-aware and never throws, like
 * schoolApi.js: the program must tell 403 (not assigned) from 404 (session
 * gone) from 0 (offline).
 */
import { wordLadderLog } from './wordLadderLog.js';

const BASE = '/api/v1/school/word-ladder';
const enc = encodeURIComponent;

async function call(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const startedAt = Date.now();
  try {
    const init = { method, credentials: 'same-origin', headers: { ...headers } };
    if (body !== undefined) {
      if (raw) init.body = body;
      else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    const r = await fetch(`${BASE}${path}`, init);
    const data = await r.json().catch(() => null);
    if (!r.ok) wordLadderLog.apiRejected({ path: path.split('?')[0], method, status: r.status, ms: Date.now() - startedAt, error: data?.error ?? null });
    return { ok: r.ok, status: r.status, data };
  } catch (error) {
    wordLadderLog.apiFailed({ path: path.split('?')[0], method, error: error?.message ?? String(error) });
    return { ok: false, status: 0, data: null };
  }
}

const extFor = (type = '') => (type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm');

export const wordLadderApi = {
  open: ({ userId, deckId }) => call('/open', { method: 'POST', body: { userId, deckId } }),
  plan: (sessionId, userId) => call(`/${enc(sessionId)}/plan?userId=${enc(userId)}`),
  answer: (sessionId, { userId, wordId, choice }) => call(`/${enc(sessionId)}/checks/${enc(wordId)}`, { method: 'POST', body: { userId, choice } }),
  uploadRecording: (sessionId, { userId, wordId, blob }) => call(
    `/${enc(sessionId)}/cards/${enc(wordId)}/recording?userId=${enc(userId)}&ext=${extFor(blob?.type)}`,
    { method: 'POST', body: blob, raw: true, headers: { 'Content-Type': blob?.type || 'audio/webm' } },
  ),
  mark: (sessionId, { userId, wordId, mark, recording = null }) => call(`/${enc(sessionId)}/cards/${enc(wordId)}/mark`, { method: 'POST', body: { userId, mark, recording } }),
  viewReview: (sessionId, { userId, wordId }) => call(`/${enc(sessionId)}/review/${enc(wordId)}`, { method: 'POST', body: { userId } }),
  latestRecordingUrl: (sessionId, { userId, wordId }) => `${BASE}/${enc(sessionId)}/cards/${enc(wordId)}/recording/latest?userId=${enc(userId)}`,
};

export default wordLadderApi;
