/** Status-aware client for the additive teacher-workspace endpoints. */
const BASE = '/api/v1/school/teacher';

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
  authStatus: () => request('/auth/status'),
  unlock: (userId, pin) => request('/auth/unlock', { method: 'POST', body: { userId, pin } }),
  lock: () => request('/auth/lock', { method: 'POST', body: {} }),
  stepUp: ({ pin, action, resource }) => request('/auth/step-up', {
    method: 'POST', body: { pin, action, resource },
  }),
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
  agendaDispatch: (learnerId, body, idempotencyKey, grantToken = null) => request(
    `/learners/${encodeURIComponent(learnerId)}/agenda/dispatch`,
    { method: 'POST', body: { ...body, idempotencyKey }, headers: {
      'Idempotency-Key': idempotencyKey,
      ...(grantToken ? { 'X-Teacher-Step-Up': grantToken } : {}),
    } },
  ),
  adjustGrade: (sessionId, body, grantToken = null) => request(
    `/sessions/${encodeURIComponent(sessionId)}/grade-adjustments`, { method: 'POST', body,
      headers: grantToken ? { 'X-Teacher-Step-Up': grantToken } : {} },
  ),
  retractGradeAdjustment: (sessionId, adjustmentId, body, grantToken = null) => request(
    `/sessions/${encodeURIComponent(sessionId)}/grade-adjustments/${encodeURIComponent(adjustmentId)}/retract`,
    { method: 'POST', body, headers: grantToken ? { 'X-Teacher-Step-Up': grantToken } : {} },
  ),
  artifact: (artifactId) => request(`/artifacts/${encodeURIComponent(artifactId)}`),
  artifactPostview: (artifactId, grantToken) => requestBlob(
    `/artifacts/${encodeURIComponent(artifactId)}/postview.pdf`,
    { headers: { 'X-Teacher-Step-Up': grantToken } },
  ),
};

export default teacherWorkspaceApi;
