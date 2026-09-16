import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

/**
 * Session identity: stable client, unique session.
 *
 * Plex records one `devices` row per distinct `X-Plex-Client-Identifier` and
 * NEVER prunes them. The old sessionless fallback minted `api-${random}` per
 * request, so every backend-initiated stream — cron harvests, previews, queue
 * resolves — added a permanent row. On 2026-09-16 that table held 81,001 rows,
 * 73,994 of them `api-*`, and Plex's periodic per-device statistics pass
 * (`Statistics/Device.cpp`) held a write transaction for ~25s of every ~55s
 * while it ground through them. Any request that opens a streaming session
 * blocked behind that lock: a child's book took 24.7s to start, a piano lesson
 * 14.7s.
 *
 * The fix is the architecture this file already documented 40 lines below the
 * bug: clientIdentifier identifies the CLIENT and stays stable;
 * sessionIdentifier is what must be unique per request. Isolation lives in the
 * session id, so a stable client id costs nothing and creates one device row
 * instead of tens of thousands.
 */

function adapter() {
  return new PlexAdapter(
    { host: 'http://plex.test:32400', token: 't', logger: { error: vi.fn(), warn: vi.fn() } },
    {
      httpClient: { get: vi.fn(), post: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn() },
    },
  );
}

describe('_generateSessionIds — sessionless (backend-initiated) requests', () => {
  it('reuses ONE stable client identifier instead of minting a new device per request', () => {
    const plex = adapter();

    const a = plex._generateSessionIds(null);
    const b = plex._generateSessionIds(null);
    const c = plex._generateSessionIds(undefined);

    expect(a.clientIdentifier).toBe(b.clientIdentifier);
    expect(b.clientIdentifier).toBe(c.clientIdentifier);
    // Never the old per-request random shape, which is what created the rows.
    expect(a.clientIdentifier).not.toMatch(/^api-[a-z0-9]{20,}$/);
  });

  it('still gives every request its own session identifier, so streams stay isolated', () => {
    const plex = adapter();

    const a = plex._generateSessionIds(null);
    const b = plex._generateSessionIds(null);

    expect(a.sessionIdentifier).not.toBe(b.sessionIdentifier);
    expect(a.sessionUUID).not.toBe(b.sessionUUID);
  });
});

describe('_generateSessionIds — frontend-supplied sessions are unchanged', () => {
  it('derives the client identifier from the caller session', () => {
    const plex = adapter();

    const { clientIdentifier } = plex._generateSessionIds('00e78fc143:0-jxVmSraK9W');

    expect(clientIdentifier).toBe('00e78fc143:0-jxVmSraK9W');
  });

  it('appends the variant so a second stream from one client is its own device', () => {
    const plex = adapter();

    const { clientIdentifier, sessionIdentifier } = plex._generateSessionIds(
      '00e78fc143:0-jxVmSraK9W',
      'audio',
    );

    expect(clientIdentifier).toBe('00e78fc143:0-jxVmSraK9W-audio');
    expect(sessionIdentifier).toMatch(/^00e78fc143:0-jxVmSraK9W-audio-/);
  });

  it('keeps the session identifier unique across repeat requests from one client', () => {
    const plex = adapter();

    const a = plex._generateSessionIds('stable-session');
    const b = plex._generateSessionIds('stable-session');

    expect(a.clientIdentifier).toBe(b.clientIdentifier);
    expect(a.sessionIdentifier).not.toBe(b.sessionIdentifier);
  });
});
