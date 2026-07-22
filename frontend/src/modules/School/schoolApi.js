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
  report: (userId) => req(`/report${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  materialUnits: (materialId, userId) => req(`/materials/${encodeURIComponent(materialId)}/units${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
  unitProgress: (materialId, unitId, body = {}) => req(`/materials/${encodeURIComponent(materialId)}/units/${encodeURIComponent(unitId)}/progress`, body, 'PUT'),
};

export default schoolApi;
