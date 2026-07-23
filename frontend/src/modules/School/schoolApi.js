/**
 * Status-aware fetch client for /api/v1/school. NOT DaylightAPI: the runners
 * must distinguish 403 (guest/assigned), 410 (session gone), and 500 (attempt
 * unrecorded — spec §8), and DaylightAPI hides status codes. Never throws.
 */
const BASE = '/api/v1/school';

async function req(path, body, method) {
  try {
    const opts = body === undefined
      ? { method: method || 'GET' }
      : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const r = await fetch(BASE + path, opts);
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const schoolApi = {
  roster: () => req('/roster'),
  banks: (audience) => req(`/banks${audience ? `?audience=${encodeURIComponent(audience)}` : ''}`),
  bank: (id) => req(`/banks/${encodeURIComponent(id)}`),
  openSession: ({ userId = null, bankId, mode }) => req('/sessions', { userId, bankId, mode }),
  answer: (sessionId, body = {}) => req(`/sessions/${encodeURIComponent(sessionId)}/answer`, body),
  results: (userId, bankId) => req(`/users/${encodeURIComponent(userId)}/results${bankId ? `?bankId=${encodeURIComponent(bankId)}` : ''}`),
  materials: () => req('/materials'),
  // `audience` filters metrics SERVER-SIDE: a learner request never receives
  // parent instrumentation, so a child's device cannot render it by accident.
  report: (userId, audience) => {
    const p = new URLSearchParams();
    if (userId) p.set('userId', userId);
    if (audience) p.set('audience', audience);
    const qs = p.toString();
    return req(`/report${qs ? `?${qs}` : ''}`);
  },
  materialWorks: (materialId) => req(`/materials/${encodeURIComponent(materialId)}/works`),
  materialUnits: (materialId, userId) => req(`/materials/${encodeURIComponent(materialId)}/units${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  quizRequests: (materialId) => req(`/quiz-requests${materialId ? `?materialId=${encodeURIComponent(materialId)}` : ''}`),
  requestQuiz: (body) => req('/quiz-requests', body),
  printables: () => req('/print/printables'),
  printQuota: (userId) => req(`/print/quota${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  requestPrint: (body) => req('/print/request', body),
  printPending: () => req('/print/pending'),
  approvePrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/approve`, { approver }),
  denyPrint: (requestId, approver) => req(`/print/${encodeURIComponent(requestId)}/deny`, { approver }),
  unitProgress: (materialId, unitId, body = {}) => req(`/materials/${encodeURIComponent(materialId)}/units/${encodeURIComponent(unitId)}/progress`, body, 'PUT'),
};

export default schoolApi;
