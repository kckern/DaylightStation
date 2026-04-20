/**
 * Plex Play Refresh Behavior Test
 *
 * Verifies that /api/v1/play/plex/mpd/:id mints a fresh Plex transcode
 * session UUID on every call (no caching by clientIdentifier or session).
 *
 * This is the critical backend property that makes the stale-session
 * recovery work: when the client appends ?_refresh=<ts> to force a fresh
 * MPD fetch, the backend MUST return a different Plex session so that
 * Plex actually starts a new transcode. If sessions were reused, the
 * client-side cache-bust would fetch the same stale MPD.
 *
 * Endpoint under test: GET /api/v1/play/plex/mpd/:id
 *
 * Route: backend/src/4_api/v1/routers/play.mjs → /plex/mpd/:id
 * Session minting: PlexAdapter._generateSessionIds() — Math.random() per call,
 *   no memoization. Confirmed: every call gets a unique sessionUUID.
 *
 * The _refresh query param is intentionally passed through; the route only
 * reads `id` from params and `maxVideoBitrate` from query — unknown params
 * like `_refresh` are silently ignored (no crash). The session freshness
 * comes from the unconditional Math.random() in _generateSessionIds.
 */

import { getAppPort } from '../../../_lib/configHelper.mjs';

// Allow override for CI or local fixture targeting
const TEST_ID = process.env.TEST_PLEX_ID || '674498';

const PORT = getAppPort();
const MPD_URL = (id, qs = '') =>
  `http://localhost:${PORT}/api/v1/play/plex/mpd/${id}${qs}`;

/**
 * Fetch the MPD endpoint without following redirects.
 * Returns the Location header and any session UUID extracted from it.
 */
async function fetchMpdSession(id, refreshParam = null) {
  const qs = refreshParam !== null ? `?_refresh=${refreshParam}` : '';
  const res = await fetch(MPD_URL(id, qs), { redirect: 'manual' });
  const location = res.headers.get('location') || '';

  // Session UUID appears in X-Plex-Session-Identifier=<uuid>
  const sessionMatch = location.match(/X-Plex-Session-Identifier=([a-z0-9]+)/i);
  const clientMatch = location.match(/X-Plex-Client-Identifier=([a-z0-9-]+)/i);

  return {
    status: res.status,
    location,
    sessionIdentifier: sessionMatch?.[1] ?? null,
    clientIdentifier: clientMatch?.[1] ?? null,
  };
}

describe('GET /api/v1/play/plex/mpd/:id — session freshness', () => {
  // Sanity-check the dev server is reachable before any tests run.
  // On failure, all tests in this suite will be skipped with a clear message.
  beforeAll(async () => {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/v1/fitness`, {
        signal: AbortSignal.timeout(5000),
      });
      // A 404 is still "reachable" — server is up, endpoint may not exist.
      // We only care that the HTTP stack responds (not 5xx network error).
      if (r.status >= 500) {
        throw new Error(`Server returned ${r.status} on health probe`);
      }
    } catch (err) {
      throw new Error(
        `Dev server not reachable at port ${PORT}: ${err.message}. ` +
        `Ensure the dev server is running before running live API tests.`
      );
    }
  });

  test('returns 302 redirect to Plex transcode URL', async () => {
    const r = await fetchMpdSession(TEST_ID);
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/\/api\/v1\/proxy\/plex\/video/);
    expect(r.location).toContain('start.mpd');
  });

  test('Location header contains a session identifier', async () => {
    const r = await fetchMpdSession(TEST_ID);
    expect(r.sessionIdentifier).not.toBeNull();
    expect(r.sessionIdentifier?.length).toBeGreaterThan(8);
  });

  test('_refresh query param does not crash the endpoint', async () => {
    const r = await fetchMpdSession(TEST_ID, Date.now());
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/start\.mpd/);
  });

  test('each call mints a unique session UUID (no server-side caching)', async () => {
    // Call without _refresh
    const r1 = await fetchMpdSession(TEST_ID);
    // Small gap to avoid any timing-based dedup (none exists, but be safe)
    await new Promise(done => setTimeout(done, 50));
    // Call with _refresh (mirrors real recovery flow)
    const r2 = await fetchMpdSession(TEST_ID, Date.now());

    const s1 = r1.sessionIdentifier;
    const s2 = r2.sessionIdentifier;

    if (!s1 || !s2) {
      throw new Error(
        `Could not extract session identifiers from Location headers. ` +
        `r1.location="${r1.location}", r2.location="${r2.location}". ` +
        `Response format may have changed — inspect PlexAdapter._buildTranscodeUrl().`
      );
    }

    // Core assertion: every call to getMediaUrl() calls _generateSessionIds()
    // which uses Math.random() — no memoization, no cache. Sessions MUST differ.
    expect(s2).not.toBe(s1);
  });

  test('two consecutive bare calls also produce distinct sessions', async () => {
    // Confirms the "no cache" property holds even without _refresh.
    // This is an observational test that documents behavior.
    const r1 = await fetchMpdSession(TEST_ID);
    await new Promise(done => setTimeout(done, 50));
    const r2 = await fetchMpdSession(TEST_ID);

    const s1 = r1.sessionIdentifier;
    const s2 = r2.sessionIdentifier;

    console.log(
      `[play-refresh] Session UUIDs — bare call 1: ${s1}, bare call 2: ${s2}, differ: ${s1 !== s2}`
    );

    // Both must be non-null (server responded with valid redirect)
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    // And they must be different (the whole point of Math.random() per call)
    expect(s2).not.toBe(s1);
  });
});
