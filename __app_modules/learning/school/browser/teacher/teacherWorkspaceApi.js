/** Status-aware client for the additive teacher-workspace endpoints. */
const BASE = '/api/v1/school/teacher';
const byQuery = (by) => (by ? `?by=${encodeURIComponent(by)}` : '');

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function requestBlob(path, { headers = {} } = {}) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: 'GET', credentials: 'same-origin', headers,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      return { ok: false, status: response.status, data };
    }
    return { ok: true, status: response.status, data: await response.blob() };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const teacherWorkspaceApi = {
  timeline: (learnerId, { limit = 100, before = null, unitId = null } = {}) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set('before', before);
    if (unitId) query.set('unitId', unitId);
    return request(`/learners/${encodeURIComponent(learnerId)}/timeline?${query}`);
  },
  launchPreviewUrl: (learnerId, subject, { continueToday = false } = {}) => {
    const query = new URLSearchParams({ subject });
    if (continueToday) query.set('continueToday', '1');
    return `${BASE}/learners/${encodeURIComponent(learnerId)}/launch-preview?${query}`;
  },
  // One child's reading shelf, for a grown-up. The child reads the same view
  // through `/books/:learnerId/shelf` with a launch grant; a grown-up holds no
  // launch, so the learner is the URL's and the picked teacher is the gate:
  // GETs carry them as `?by=`, and a read that names nobody is refused as a
  // stranger.
  readingShelf: (learnerId, by = null) => request(`/learners/${encodeURIComponent(learnerId)}/reading${byQuery(by)}`),
  // One reading, every entry, and the full `revisions` list the editor undoes
  // from — plus the `baseRevisionCount` every write below must carry back, and
  // the `countedWindow` a re-date is judged against. Both are served rather
  // than derived here: a second way to compute the value a save is judged on
  // is a second way to be wrong about it.
  readingDetail: (learnerId, readingId, by = null) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}${byQuery(by)}`,
  ),
  // The nine edit verbs. Every one of them carries `baseRevisionCount` in its
  // body — the router reads it off `req.body`, so it belongs in the body and
  // not in a header, and a DELETE therefore sends one too.
  updateReading: (learnerId, readingId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}`,
    { method: 'PATCH', body },
  ),
  addReadingEntry: (learnerId, readingId, body, idempotencyKey = null) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}/entries`,
    { method: 'POST', body, ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) },
  ),
  updateReadingEntry: (learnerId, readingId, entryId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'PATCH', body },
  ),
  deleteReadingEntry: (learnerId, readingId, entryId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE', body },
  ),
  // A book opened on the child's behalf: the shelf's own verb, and the one
  // write here that carries NO `baseRevisionCount` — nothing was loaded,
  // because the reading does not exist yet. Idempotent on the client's key, so
  // a double tap adds one book.
  addReadingForLearner: (learnerId, body, idempotencyKey = null) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading`,
    { method: 'POST', body, ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) },
  ),
  // One book, every enrolled learner: logged today, the open reading a
  // check-in or finish must land on, and the mode a new reading defaults to.
  // The quick-log sheet's read; the console works none of this out itself.
  bookReaders: (isbn, by = null) => request(`/books/${encodeURIComponent(isbn)}/readers${byQuery(by)}`),
  undoReadingRevision: (learnerId, readingId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}/undo`,
    { method: 'POST', body },
  ),
  moveReading: (learnerId, readingId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}/reassign`,
    { method: 'POST', body },
  ),
  deleteReading: (learnerId, readingId, body) => request(
    `/learners/${encodeURIComponent(learnerId)}/reading/${encodeURIComponent(readingId)}`,
    { method: 'DELETE', body },
  ),
  session: (sessionId) => request(`/sessions/${encodeURIComponent(sessionId)}`),
  course: (courseId) => request(`/curriculum/${encodeURIComponent(courseId)}`),
  lesson: (courseId, lessonId) => request(`/curriculum/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`),
  lessonPreviewUrl: (courseId, lessonId, { answerKey = false } = {}) => (
    `${BASE}/curriculum/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/preview.pdf${answerKey ? '?answerKey=1' : ''}`
  ),
  learnerCourse: (learnerId, courseId) => request(`/learners/${encodeURIComponent(learnerId)}/courses/${encodeURIComponent(courseId)}`),
  curriculumExceptions: () => request('/curriculum-exceptions'),
  answerSheet: (cardId) => request(`/answer-sheets/${encodeURIComponent(cardId)}`),
  learnerAnswerSheets: (learnerId) => request(`/learners/${encodeURIComponent(learnerId)}/answer-sheets`),
  changeCurriculumException: (body) => request('/curriculum-exceptions', { method: 'POST', body }),
  retractCurriculumException: (exceptionId, body) => request(
    `/curriculum-exceptions/${encodeURIComponent(exceptionId)}/retract`, { method: 'POST', body },
  ),
  agendaDispatchPreview: (learnerId, learnerName = null) => request(
    `/learners/${encodeURIComponent(learnerId)}/agenda/dispatch/preview`,
    { method: 'POST', body: { learnerName } },
  ),
  agendaDispatch: (learnerId, body, idempotencyKey) => request(
    `/learners/${encodeURIComponent(learnerId)}/agenda/dispatch`,
    { method: 'POST', body: { ...body, idempotencyKey }, headers: { 'Idempotency-Key': idempotencyKey } },
  ),
  adjustGrade: (sessionId, body) => request(
    `/sessions/${encodeURIComponent(sessionId)}/grade-adjustments`, { method: 'POST', body },
  ),
  retractGradeAdjustment: (sessionId, adjustmentId, body) => request(
    `/sessions/${encodeURIComponent(sessionId)}/grade-adjustments/${encodeURIComponent(adjustmentId)}/retract`,
    { method: 'POST', body },
  ),
  // The escape hatch for a broken read-along. A POST, because the reveal is
  // recorded on the server and the body names who asked. Its answer is never
  // cached and never held anywhere but the component that asked for it.
  revealCompanionFinishCode: (sessionId, body) => request(
    `/sessions/${encodeURIComponent(sessionId)}/companion-finish-code`,
    { method: 'POST', body },
  ),
  artifact: (artifactId) => request(`/artifacts/${encodeURIComponent(artifactId)}`),
  artifactOriginal: (artifactId) => requestBlob(`/artifacts/${encodeURIComponent(artifactId)}/original`),
  reprintArtifact: (artifactId, body, idempotencyKey) => request(
    `/artifacts/${encodeURIComponent(artifactId)}/reprint`, { method: 'POST', body: { ...body, idempotencyKey },
      headers: { 'Idempotency-Key': idempotencyKey } },
  ),
  artifactPostview: (artifactId, by = null) => requestBlob(
    `/artifacts/${encodeURIComponent(artifactId)}/postview.pdf${byQuery(by)}`,
  ),
};

export default teacherWorkspaceApi;
