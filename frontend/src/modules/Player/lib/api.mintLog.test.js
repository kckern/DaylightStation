/**
 * Stream-URL request counting — Tier 1.2, frontend half.
 *
 * `fetchMediaInfo` is where the player asks the backend for a playable url, and
 * every answer opens a Plex transcode session. It logged only failures. On
 * 2026-08-16 it succeeded 495 times in four minutes and produced zero lines, so
 * the count came from Plex's server log rather than ours.
 *
 * The three events form one family — `fetch-media-succeeded`, `-failed`,
 * `-skipped` — so that the absence of all three means the function was never
 * called, rather than "we did not look". The backend half (`plex.stream.mint`
 * and its own -failed/-skipped, at proxy.mjs) uses the same `session` value, so
 * the two sides can be joined on it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sampled = [];
const playbackLogCalls = [];
const plexIdentityCalls = [];

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

vi.mock('./playbackLogger.js', () => ({
  __esModule: true,
  playbackLog: (event, payload, options) => { playbackLogCalls.push({ event, payload, options }); },
  // Tier 2.1: the mint path also adopts the identifier Plex will log for this
  // stream, so every later playback line can be joined to Plex's own log.
  setPlexSessionIdentity: (value) => { plexIdentityCalls.push(value); },
  default: (event, payload, options) => { playbackLogCalls.push({ event, payload, options }); }
}));

vi.mock('../../../lib/logging/Logger.js', () => {
  const stub = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    sampled: (event, data, options) => { sampled.push({ event, data, options }); },
    child: () => stub
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

const BASE_TIME = new Date('2026-08-16T11:32:00Z').getTime();

const successes = () => sampled.filter((s) => s.event === 'playback.fetch-media-succeeded');
const named = (event) => playbackLogCalls.filter((c) => c.event === event);

/** Fresh module state per test: requestSeq is module-monotonic by design. */
const loadApi = async () => {
  vi.resetModules();
  const { DaylightAPI } = await import('../../../lib/api.mjs');
  // resetModules gives api.js fresh module state, but the mock instance itself
  // is shared across the file and would otherwise carry the previous test's calls.
  DaylightAPI.mockReset();
  const mod = await import('./api.js');
  return { fetchMediaInfo: mod.fetchMediaInfo, DaylightAPI };
};

beforeEach(() => {
  sampled.length = 0;
  playbackLogCalls.length = 0;
  plexIdentityCalls.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE_TIME);
});

afterEach(() => { vi.useRealTimers(); });

describe('fetchMediaInfo — stream-URL request counting', () => {
  it('logs a line per successful mint, with the fields the backend can be joined on', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1', mediaUrl: '/proxy/x.mpd' });

    await fetchMediaInfo({ contentId: 'plex:694719', session: 'IIni70e01E' });

    // Tier 2.1: whatever the backend said about Plex's own identifier is
    // adopted on this path — including its absence, which is a distinct fact.
    expect(plexIdentityCalls).toEqual([undefined]);
    expect(successes()).toHaveLength(1);
    expect(successes()[0].data).toMatchObject({
      contentId: 'plex:694719',
      session: 'IIni70e01E',
      requestSeq: 1,
      shuffle: false
    });
  });

  it('numbers requests monotonically and times the gap between them', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });

    await fetchMediaInfo({ contentId: 'plex:694719' });
    // null, not 0: there was no previous request, which is a different fact
    // from "the previous request was in the same millisecond".
    expect(successes()[0].data.msSinceLastRequest).toBeNull();

    vi.setSystemTime(BASE_TIME + 250);
    await fetchMediaInfo({ contentId: 'plex:694719' });
    expect(successes()[1].data.requestSeq).toBe(2);
    expect(successes()[1].data.msSinceLastRequest).toBe(250);
  });

  it('says which absence a missing session is', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });

    await fetchMediaInfo({ contentId: 'plex:694719' });
    // The caller minted no client session, so the backend mints a random one per
    // request — which is how Plex came to log 495 distinct clients for one tablet.
    expect(successes()[0].data.session).toBeNull();
  });

  it('records the resume mode as a state, never as a bare default', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });

    await fetchMediaInfo({ contentId: 'plex:694719' });
    expect(successes()[0].data.resume).toBe('server-default');

    await fetchMediaInfo({ contentId: 'plex:694719', resume: false });
    expect(successes()[1].data.resume).toBe('suppressed');
  });

  it('counts a shuffle mint too', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });

    await fetchMediaInfo({ contentId: 'plex:694719', shuffle: true });
    expect(successes()).toHaveLength(1);
    expect(successes()[0].data.shuffle).toBe(true);
  });

  it('is rate limited on the same budget as the backend mint counter', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });

    await fetchMediaInfo({ contentId: 'plex:694719' });
    expect(successes()[0].options).toMatchObject({ maxPerMinute: 20, aggregate: true });
  });

  it('gives a failure the same sequence number a success would have had', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();
    DaylightAPI.mockResolvedValue({ id: 'a1' });
    await fetchMediaInfo({ contentId: 'plex:694719' });

    DaylightAPI.mockRejectedValueOnce(new Error('HTTP 404 Not Found'));
    vi.setSystemTime(BASE_TIME + 40);
    await expect(fetchMediaInfo({ contentId: 'plex:694719', session: 's1' })).rejects.toThrow();

    expect(named('fetch-media-failed')).toHaveLength(1);
    // One numbering across the family, so a run of failures and a run of
    // successes can be counted together rather than side by side.
    expect(named('fetch-media-failed')[0].payload).toMatchObject({
      requestSeq: 2,
      msSinceLastRequest: 40,
      session: 's1'
    });
  });

  it('says so when it never asked at all', async () => {
    const { fetchMediaInfo, DaylightAPI } = await loadApi();

    const result = await fetchMediaInfo({ contentId: null });

    expect(result).toBeNull();
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(named('fetch-media-skipped')).toHaveLength(1);
    expect(named('fetch-media-skipped')[0].payload).toMatchObject({ reason: 'no-content-id' });
    expect(successes()).toHaveLength(0);
  });
});
