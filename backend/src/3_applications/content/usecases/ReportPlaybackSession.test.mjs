/**
 * ReportPlaybackSession tests.
 *
 * This is the layer that turns a stream of progress pings into a session
 * lifecycle, so these pin the orchestration decisions that are invisible until
 * someone looks at the Plex dashboard mid-story:
 *
 *   - the superseded session is closed BEFORE the new one opens, or one screen
 *     briefly shows two things playing;
 *   - finishing marks watched, stopping does not — abandoning a story halfway
 *     must never credit it as watched;
 *   - a surface with no identity is skipped entirely. Composition now resolves
 *     one for every caller, so this path is policy held open rather than a case
 *     that fires today; it is tested so the choice stays this layer's to make.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReportPlaybackSession } from './ReportPlaybackSession.mjs';
import { PlaybackSessionRegistry } from '../runtime/PlaybackSessionRegistry.mjs';
import { PlexClientIdentity } from '#domains/media/value-objects/PlexClientIdentity.mjs';

const T0 = 1_789_577_175_000;

const IDENTITY = new PlexClientIdentity({
  clientIdentifier: 'daylight-livingroom-tv',
  product: 'DaylightStation',
  device: 'Living Room TV',
});

function build({ identityFor } = {}) {
  const gateway = {
    openSession: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    markWatched: vi.fn().mockResolvedValue(undefined),
  };
  const useCase = new ReportPlaybackSession({
    sessionRegistry: new PlaybackSessionRegistry(),
    sessionGateway: gateway,
    identityFor: identityFor ?? (() => IDENTITY),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  return { useCase, gateway };
}

const report = (over = {}) => ({
  surfaceId: 'livingroom-tv',
  contentId: 'plex:674737',
  positionMs: 1_000,
  durationMs: 292_733,
  at: T0,
  ...over,
});

describe('ReportPlaybackSession.execute', () => {
  it('opens a session on the first report', async () => {
    const { useCase, gateway } = build();
    const result = await useCase.execute(report());
    expect(result).toMatchObject({ reported: true, opened: true });
    expect(gateway.openSession).toHaveBeenCalledTimes(1);
    expect(gateway.heartbeat).not.toHaveBeenCalled();
  });

  it('heartbeats on subsequent reports instead of re-opening', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.execute(report({ positionMs: 15_000, at: T0 + 15_000 }));
    expect(gateway.openSession).toHaveBeenCalledTimes(1);
    expect(gateway.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('closes the superseded session before opening the new one', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.execute(report({ contentId: 'plex:999', at: T0 + 20_000 }));

    expect(gateway.closeSession).toHaveBeenCalledTimes(1);
    const closeOrder = gateway.closeSession.mock.invocationCallOrder[0];
    const openOrder = gateway.openSession.mock.invocationCallOrder[1];
    expect(closeOrder).toBeLessThan(openOrder);
  });

  it('skips surfaces that are not declared Plex clients', async () => {
    const { useCase, gateway } = build({ identityFor: () => null });
    const result = await useCase.execute(report({ surfaceId: 'speaker-red' }));
    expect(result).toEqual({ reported: false });
    expect(gateway.openSession).not.toHaveBeenCalled();
  });

  it('ignores a report with no surface or no content', async () => {
    const { useCase, gateway } = build();
    expect(await useCase.execute(report({ surfaceId: '' }))).toEqual({ reported: false });
    expect(await useCase.execute(report({ contentId: '' }))).toEqual({ reported: false });
    expect(gateway.openSession).not.toHaveBeenCalled();
  });
});

describe('ReportPlaybackSession completion', () => {
  it('closes the session AND marks watched when the item finishes', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    const result = await useCase.execute(report({ positionMs: 292_733, completed: true, at: T0 + 292_733 }));

    expect(result).toMatchObject({ completed: true });
    expect(gateway.closeSession).toHaveBeenCalledTimes(1);
    expect(gateway.markWatched).toHaveBeenCalledWith(IDENTITY, 'plex:674737');
  });

  it('does NOT mark watched when playback merely stops', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.execute(report({ positionMs: 30_000, at: T0 + 30_000 }));
    expect(gateway.markWatched).not.toHaveBeenCalled();
  });
});

describe('ReportPlaybackSession.stop', () => {
  it('closes the session WITHOUT marking it watched', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    const result = await useCase.stop({ surfaceId: 'livingroom-tv', at: T0 + 30_000 });

    expect(result).toEqual({ stopped: true });
    expect(gateway.closeSession).toHaveBeenCalledTimes(1);
    // The whole point: stopping a story halfway is not finishing it.
    expect(gateway.markWatched).not.toHaveBeenCalled();
  });

  it('is idempotent, so a caller polling `idle` can call it every tick', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.stop({ surfaceId: 'livingroom-tv', at: T0 + 30_000 });
    const second = await useCase.stop({ surfaceId: 'livingroom-tv', at: T0 + 33_000 });

    expect(second).toEqual({ stopped: false });
    expect(gateway.closeSession).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a surface that was never playing', async () => {
    const { useCase, gateway } = build();
    expect(await useCase.stop({ surfaceId: 'garage-tv', at: T0 })).toEqual({ stopped: false });
    expect(gateway.closeSession).not.toHaveBeenCalled();
  });

  it('ignores a stop with no surface, and one with no identity', async () => {
    const { useCase } = build();
    expect(await useCase.stop({ surfaceId: '', at: T0 })).toEqual({ stopped: false });
    const anon = build({ identityFor: () => null });
    expect(await anon.useCase.stop({ surfaceId: 'whatever', at: T0 })).toEqual({ stopped: false });
  });

  it('lets the surface start something new afterwards', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.stop({ surfaceId: 'livingroom-tv', at: T0 + 30_000 });
    const result = await useCase.execute(report({ contentId: 'plex:999', at: T0 + 40_000 }));
    expect(result).toMatchObject({ opened: true });
    expect(gateway.openSession).toHaveBeenCalledTimes(2);
  });
});

describe('ReportPlaybackSession.sweep', () => {
  it('ends sessions whose surface went quiet', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    const reaped = await useCase.sweep({ now: T0 + 61_000, ttlMs: 60_000 });
    expect(reaped).toBe(1);
    expect(gateway.closeSession).toHaveBeenCalledTimes(1);
  });

  it('leaves live sessions alone', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    expect(await useCase.sweep({ now: T0 + 5_000, ttlMs: 60_000 })).toBe(0);
    expect(gateway.closeSession).not.toHaveBeenCalled();
  });
});

describe('ReportPlaybackSession.keepAlive', () => {
  it('heartbeats every live session, because client pings are not dependable', async () => {
    const { useCase, gateway } = build();
    await useCase.execute(report());
    await useCase.execute(report({ surfaceId: 'garage-tv', contentId: 'plex:111' }));
    gateway.heartbeat.mockClear();

    const refreshed = await useCase.keepAlive();
    expect(refreshed).toBe(2);
    expect(gateway.heartbeat).toHaveBeenCalledTimes(2);
  });
});
