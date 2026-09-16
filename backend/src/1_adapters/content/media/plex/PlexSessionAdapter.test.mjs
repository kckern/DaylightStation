/**
 * PlexSessionAdapter tests.
 *
 * These pin the wire format that was verified against the live server, because
 * every one of these details was a wrong guess at some point during the
 * investigation:
 *
 *   - a play queue looks required (101 of 102 real calls carry one) and is not;
 *   - `/:/scrobble` writes history but creates no session, so it cannot stand in
 *     for closing one;
 *   - the player name a viewer sees comes from `X-Plex-Device-Name`, not from
 *     the product.
 *
 * They also pin the rule that reporting never breaks playback: a failing Plex
 * must not propagate to a child watching a story.
 */

import { describe, it, expect, vi } from 'vitest';
import { PlexSessionAdapter, toRatingKey } from './PlexSessionAdapter.mjs';
import { PlaybackSession } from '#domains/media/entities/PlaybackSession.mjs';
import { PlexClientIdentity } from '#domains/media/value-objects/PlexClientIdentity.mjs';

const T0 = 1_789_577_175_000;

const identity = () => new PlexClientIdentity({
  clientIdentifier: 'daylight-livingroom-tv',
  product: 'DaylightStation',
  version: '1.0',
  platform: 'Linux',
  device: 'Living Room TV',
});

const session = (over = {}) => PlaybackSession.start({
  surfaceId: 'livingroom-tv',
  contentId: 'plex:674737',
  positionMs: 12_000,
  durationMs: 292_733,
  at: T0,
  ...over,
});

function build() {
  const get = vi.fn().mockResolvedValue({ data: {} });
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const adapter = new PlexSessionAdapter(
    { host: 'http://plex:32400', token: 'tok' },
    { httpClient: { get }, logger },
  );
  return { adapter, get, logger };
}

const urlOf = (get) => new URL(get.mock.calls[0][0]);

describe('toRatingKey', () => {
  it('accepts both the compound and the bare form', () => {
    expect(toRatingKey('plex:674737')).toBe('674737');
    expect(toRatingKey('674737')).toBe('674737');
  });

  it('rejects anything that is not a Plex rating key', () => {
    expect(toRatingKey('files:/some/path.mp3')).toBeNull();
    expect(toRatingKey('')).toBeNull();
    expect(toRatingKey(null)).toBeNull();
  });
});

describe('PlexSessionAdapter.openSession', () => {
  it('opens a session with state=playing and the playhead', async () => {
    const { adapter, get } = build();
    await adapter.openSession(identity(), session());
    const url = urlOf(get);
    expect(url.pathname).toBe('/:/timeline');
    expect(url.searchParams.get('state')).toBe('playing');
    expect(url.searchParams.get('ratingKey')).toBe('674737');
    expect(url.searchParams.get('key')).toBe('/library/metadata/674737');
    expect(url.searchParams.get('time')).toBe('12000');
    expect(url.searchParams.get('duration')).toBe('292733');
  });

  it('sends NO play queue parameters — verified unnecessary', async () => {
    const { adapter, get } = build();
    await adapter.openSession(identity(), session());
    const url = urlOf(get);
    expect(url.searchParams.get('playQueueItemID')).toBeNull();
    expect(url.searchParams.get('playQueueID')).toBeNull();
    expect(url.searchParams.get('containerKey')).toBeNull();
  });

  it('carries the identity that makes the dashboard show a named player', async () => {
    const { adapter, get } = build();
    await adapter.openSession(identity(), session());
    const url = urlOf(get);
    expect(url.searchParams.get('X-Plex-Client-Identifier')).toBe('daylight-livingroom-tv');
    expect(url.searchParams.get('X-Plex-Device-Name')).toBe('Living Room TV');
    expect(url.searchParams.get('X-Plex-Product')).toBe('DaylightStation');
    expect(url.searchParams.get('X-Plex-Platform')).toBe('Linux');
    expect(url.searchParams.get('X-Plex-Token')).toBe('tok');
  });
});

describe('PlexSessionAdapter heartbeat and close', () => {
  it('reports a paused session as paused, not playing', async () => {
    const { adapter, get } = build();
    const s = session();
    s.pause({ at: T0 + 1000 });
    await adapter.heartbeat(identity(), s);
    expect(urlOf(get).searchParams.get('state')).toBe('paused');
  });

  it('closes with state=stopped', async () => {
    const { adapter, get } = build();
    await adapter.closeSession(identity(), session());
    expect(urlOf(get).searchParams.get('state')).toBe('stopped');
  });
});

describe('PlexSessionAdapter.markWatched', () => {
  it('scrobbles against the library agent', async () => {
    const { adapter, get } = build();
    await adapter.markWatched(identity(), 'plex:674737');
    const url = urlOf(get);
    expect(url.pathname).toBe('/:/scrobble');
    expect(url.searchParams.get('key')).toBe('674737');
    expect(url.searchParams.get('identifier')).toBe('com.plexapp.plugins.library');
  });
});

describe('PlexSessionAdapter is not allowed to break playback', () => {
  it('swallows and logs a Plex failure instead of throwing', async () => {
    const { adapter, logger } = build();
    const get = vi.fn().mockRejectedValue(new Error('plex is down'));
    const failing = new PlexSessionAdapter(
      { host: 'http://plex:32400', token: 'tok' },
      { httpClient: { get }, logger },
    );
    await expect(failing.openSession(identity(), session())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('plex.session.timeline.failed', expect.objectContaining({
      error: 'plex is down',
    }));
  });

  it('does nothing for content that is not a Plex item', async () => {
    const { adapter, get, logger } = build();
    await adapter.openSession(identity(), session({ contentId: 'files:/audio/story.mp3' }));
    expect(get).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('plex.session.skipped', expect.objectContaining({
      reason: 'not-a-plex-rating-key',
    }));
  });
});
