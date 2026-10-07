// Journey helpers for the SEEDED household backend of the acceptance server
// (tests/_lib/media-household-fixture.mjs). The page talks to the REAL
// household routes; nothing is faked in the browser. Because every journey
// shares one server, a journey that writes (favourite, remove, watched) starts
// from the seed again via `resetHouseholdAt(request, baseURL)` in a beforeEach.
import { HOUSEHOLD_SEED_IDS } from '../../../../_lib/media-household-fixture.mjs';

export { HOUSEHOLD_SEED_IDS as SEED };
export const SEED_TESTER = Object.freeze({ clientId: 'acceptance-tester', name: 'Acceptance browser', deviceId: 'browser:acceptance-tester' });

/** Put the seeded household, screen registry, routine history and device-control record back. */
export async function resetHouseholdAt(request, baseURL) {
  const response = await request.post(`${baseURL}/api/v1/media/_fixture/reset`);
  if (!response.ok()) throw new Error(`fixture reset failed: ${response.status()}`);
}

/**
 * Record (never answer) every request the page makes to the household routes:
 * `{ method, path, query, body, device }`. The server answers them for real.
 */
export function recordHouseholdRequests(page, pattern = /\/api\/v1\/media\/(household|suggestions|screens)/) {
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!pattern.test(url.pathname)) return;
    let body = null;
    if (request.method() !== 'GET') { try { body = request.postDataJSON(); } catch { body = null; } }
    requests.push({ method: request.method(), path: url.pathname, query: Object.fromEntries(url.searchParams), body, device: request.headers()['x-daylight-device'] ?? null });
  });
  return requests;
}

/** Record the page's progress reports and (server writes are blocked) answer them. */
export async function captureProgressLogs(page) {
  const logs = [];
  await page.route('**/api/v1/play/log', async (route) => {
    const request = route.request();
    logs.push({ body: request.postDataJSON(), device: request.headers()['x-daylight-device'] ?? null });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  return logs;
}

/**
 * Make this browser a known seeded screen (`browser:<clientId>`) before the app
 * loads, so its own suggestions / "Played earlier" read that screen's seeded history.
 */
export async function pinBrowserIdentity(target, { clientId, name } = SEED_TESTER) {
  await target.addInitScript(({ clientId: id, name: displayName }) => {
    try {
      localStorage.setItem('media-app.client-id', id);
      localStorage.setItem('media-app.display-name', displayName);
      localStorage.setItem('media-app.browser-identity', JSON.stringify({
        clientId: id, deviceId: `browser:${id}`, name: displayName, connectedAt: new Date().toISOString(),
      }));
    } catch { /* storage unavailable: the journey will fail loudly on identity */ }
  }, { clientId, name });
}

/** Fetch a household route from the page's own origin, as the app would. */
export async function household(page, path, init = {}) {
  return page.evaluate(async ({ path: p, init: i }) => {
    const response = await fetch(`/api/v1/media${p}`, i);
    return response.json();
  }, { path, init });
}
