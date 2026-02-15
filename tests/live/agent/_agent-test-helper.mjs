// tests/live/agent/_agent-test-helper.mjs

// Use TEST_BASE_URL set by the live harness, falling back to localhost:3112.
// We avoid importing configHelper.mjs directly because its import.meta.url
// usage conflicts with Jest's Babel CJS transform.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3112';

/**
 * Fetch a JSON endpoint and return { res, data }.
 * Does NOT swallow errors — callers assert on res.status.
 */
async function fetchJSON(url, opts = {}) {
  const { method = 'GET', body, timeout = 5000 } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== undefined) {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOpts);
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    return { res, data };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export function agentAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/agents${path}`, opts);
}

export function dashboardAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/health-dashboard${path}`, opts);
}

export function householdAPI(path, opts) {
  return fetchJSON(`${BASE_URL}/api/v1/admin/household${path || ''}`, opts);
}

export function today() {
  return new Date().toISOString().split('T')[0];
}

export { BASE_URL };
