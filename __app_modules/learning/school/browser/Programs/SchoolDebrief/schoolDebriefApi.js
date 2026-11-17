/** /api/v1/school/debrief client. Status-aware and never throws. */
import { schoolDebriefLog } from "./schoolDebriefLog.js";
import { createSchoolEndpointClient } from '../../runtime/schoolEndpointClient.js';

const enc = encodeURIComponent;
export function createSchoolDebriefApi({ learnerId, grant, ...options }) {
  const BASE = `/api/v1/school/debrief/${enc(learnerId)}/day`;
  const client = createSchoolEndpointClient({ ...options, base: BASE });
  async function call(day, path, { method = 'GET', body, raw = false, contentType = null } = {}) {
    const result = await client.request(`/${enc(day)}${path}`, {
      method, body, raw, headers: { 'X-School-Debrief-Grant': grant, ...(contentType ? { 'Content-Type': contentType } : {}) },
    });
    if (!result.ok) {
      const detail = { path, method, status: result.status, kind: result.error?.kind };
      if (result.status) schoolDebriefLog.apiRejected(detail); else schoolDebriefLog.apiFailed(detail);
    }
    return client.finish(result);
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
