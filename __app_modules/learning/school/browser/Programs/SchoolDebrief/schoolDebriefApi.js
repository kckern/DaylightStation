/** /api/v1/school/debrief client. Status-aware and never throws. */
import { schoolDebriefLog } from "./schoolDebriefLog.js";

const enc = encodeURIComponent;
export function createSchoolDebriefApi({ learnerId, grant }) {
  const BASE = `/api/v1/school/debrief/${enc(learnerId)}/day`;
  async function call(day, path, { method = 'GET', body, raw = false, contentType = null } = {}) {
    try {
      const init = { method, credentials: 'same-origin', headers: { 'X-School-Debrief-Grant': grant } };
      if (body !== undefined) {
        if (raw) { init.body = body; if (contentType) init.headers['Content-Type'] = contentType; }
        else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
      }
      const r = await fetch(`${BASE}/${enc(day)}${path}`, init);
      const data = await r.json().catch(() => null);
      if (!r.ok) schoolDebriefLog.apiRejected({ path, method, status: r.status, error: data?.error ?? null });
      return { ok: r.ok, status: r.status, data };
    } catch (error) {
      schoolDebriefLog.apiFailed({ path, method, error: error?.message ?? String(error) });
      return { ok: false, status: 0, data: null };
    }
  }
  return {
    day: (d) => call(d, ''),
    open: (d) => call(d, '/open', { method: 'POST' }),
    take: (d, blob) => call(d, '/take', { method: 'POST', body: blob, raw: true, contentType: blob?.type || 'audio/webm' }),
    entry: (d, body) => call(d, '/entry', { method: 'POST', body }),
    submit: (d) => call(d, '/submit', { method: 'POST' }),
    clarify: (d, body) => call(d, '/clarify', { method: 'POST', body }),
    answer: (d, body) => call(d, '/answer', { method: 'POST', body }),
    complete: (d) => call(d, '/complete', { method: 'POST' }),
  };
}
export default createSchoolDebriefApi;
