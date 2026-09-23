/**
 * Status-aware client for the word-ladder "grown-up word controls" routes
 * (`docs/reference/school/word-ladder.md` — Grown-up word controls). Mounted
 * at `/api/v1/school/word-ladder/admin`, a SIBLING of `/api/v1/school/teacher`
 * — not nested under it — so this file does not reuse `teacherWorkspaceApi`'s
 * BASE, the way `schoolApi.js` (`/api/v1/school`) can't be reused either
 * without editing a file outside this directory.
 *
 * `pin` travels as `null` on every write; the school router's own middleware
 * fills it in from the `daylight_teacher_session` cookie when the body's pin
 * is `null` — the same contract every other teacher-console write panel
 * relies on (see `useTeacherWrite.js`).
 */
const BASE = '/api/v1/school/word-ladder/admin';

async function request(path, { method = 'GET', body } = {}) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const wordLadderAdminApi = {
  // Every word the learner can meet, its ladder state, and its judged typed
  // answers from the last 14 study days (word-ladder.md "Grown-up word
  // controls"). `actorId` rides the query string — this is the one admin read
  // that is a GET, so it carries no body for the school router's cookie-pin
  // middleware to patch; the route falls back to reading `pin` off the (empty)
  // body the JSON parser still attaches, so no `pin` param is sent here.
  words: (learnerId, deckId, actorId = null) => {
    const query = new URLSearchParams({ learnerId, deckId });
    if (actorId) query.set('actorId', actorId);
    return request(`/words?${query}`);
  },
  reset: (body) => request('/reset', { method: 'POST', body }),
  markMastered: (body) => request('/mastered', { method: 'POST', body }),
  exclude: (body) => request('/exclude', { method: 'POST', body }),
  dropDeck: (body) => request('/drop-deck', { method: 'POST', body }),
  regrade: (body) => request('/regrade', { method: 'POST', body }),
  // The tuning agent's values vs defaults, its last status + notes, and its
  // history (word-ladder.md "Tuning"). A GET, so `actorId` rides the query
  // like `words` above; the route derives the teacher from the cookie first.
  tuning: (learnerId, deckId, actorId = null) => {
    const query = new URLSearchParams({ learnerId, deckId });
    if (actorId) query.set('actorId', actorId);
    return request(`/tuning?${query}`);
  },
  // Restore one setting's value from before the agent's latest change to it.
  undoTuning: (body) => request('/tuning/undo', { method: 'POST', body }),
};

export default wordLadderAdminApi;
