/** Status-aware client for the additive teacher-workspace endpoints. */
const BASE = '/api/v1/school/teacher';

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
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
  session: (sessionId) => request(`/sessions/${encodeURIComponent(sessionId)}`),
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
  artifact: (artifactId) => request(`/artifacts/${encodeURIComponent(artifactId)}`),
};

export default teacherWorkspaceApi;
