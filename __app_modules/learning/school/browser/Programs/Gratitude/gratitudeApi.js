import { createSchoolEndpointClient } from '../../runtime/schoolEndpointClient.js';
import { gratitudeLog } from './gratitudeLog.js';

export function createGratitudeApi({ learnerId, grant, ...options }) {
  const client = createSchoolEndpointClient({ ...options, base: `/api/v1/school/gratitude/${encodeURIComponent(learnerId)}/day` });
  async function call(day, path, { method = 'GET', body, raw = false, takeId } = {}) {
    const result = await client.request(`/${encodeURIComponent(day)}${path}`, {
      method, body, raw,
      headers: {
        'X-School-Gratitude-Grant': grant,
        ...(takeId ? { 'X-School-Take-Id': takeId } : {}),
        ...(raw ? { 'Content-Type': body?.type || 'audio/webm' } : {}),
      },
    });
    if (!result.ok) {
      const detail = { path, status: result.status, kind: result.error?.kind, error: result.data?.error ?? null };
      if (result.status) gratitudeLog.apiRejected(detail); else gratitudeLog.apiFailed(detail);
    }
    return client.finish(result);
  }
  return {
    day: d => call(d, ''), open: d => call(d, '/open', { method: 'POST' }),
    draft: (d, body) => call(d, '/draft', { method: 'POST', body }),
    submit: (d, body) => call(d, '/submit', { method: 'POST', body }),
    retry: (d, body) => call(d, '/retry', { method: 'POST', body }),
    take: (d, blob, takeId) => call(d, '/take', { method: 'POST', body: blob, raw: true, takeId }),
  };
}
