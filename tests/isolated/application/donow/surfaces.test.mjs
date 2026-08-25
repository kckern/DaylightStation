import { describe, it, expect, vi } from 'vitest';
import { PortalSurface } from '#apps/donow/surfaces/PortalSurface.mjs';
import { ThermalSurface } from '#apps/donow/surfaces/ThermalSurface.mjs';
import { LaserSurface } from '#apps/donow/surfaces/LaserSurface.mjs';
import { PlaybackHubSurface } from '#apps/donow/surfaces/PlaybackHubSurface.mjs';
import { LivingroomTvSurface } from '#apps/donow/surfaces/LivingroomTvSurface.mjs';
import { GarageFitnessSurface } from '#apps/donow/surfaces/GarageFitnessSurface.mjs';
import { PianoKioskSurface } from '#apps/donow/surfaces/PianoKioskSurface.mjs';

const NOW_MS = Date.parse('2026-07-30T10:00:00.000Z');
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('PortalSurface', () => {
  it('id', () => expect(new PortalSurface().id).toBe('portal'));

  describe('validateAction', () => {
    it('rejects garbage', () => {
      const s = new PortalSurface();
      expect(s.validateAction(null).length).toBeGreaterThan(0);
      expect(s.validateAction({}).length).toBeGreaterThan(0);
      expect(s.validateAction({ target: {} }).length).toBeGreaterThan(0);
      expect(s.validateAction({ target: { kind: 'bogus' } }).length).toBeGreaterThan(0);
      expect(s.validateAction({ target: { kind: 'bank' } }).length).toBeGreaterThan(0);
      expect(s.validateAction({ target: { kind: 'program' } }).length).toBeGreaterThan(0);
    });
    it('accepts a well-formed bank or program target', () => {
      const s = new PortalSurface();
      expect(s.validateAction({ target: { kind: 'bank', bankId: 'b', unitId: 'u', sessionId: 's' } })).toEqual([]);
      expect(s.validateAction({ target: { kind: 'program', program: 'pe-daily' } })).toEqual([]);
    });
  });

  describe('dispatch', () => {
    it('delegates to eventBus.broadcast with the exact school.launch envelope', async () => {
      const broadcast = vi.fn();
      const s = new PortalSurface({ eventBus: { broadcast }, logger: silentLogger });
      const action = { target: { kind: 'program', program: 'pe-daily' } };
      const result = await s.dispatch({ action, learnerId: 'kid1' });
      expect(result).toEqual({ dispatched: true });
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledWith('school', {
        type: 'school.launch', learnerId: 'kid1', target: action.target,
      });
    });
    it('no eventBus -> dispatched:false, never throws', async () => {
      const s = new PortalSurface({ logger: silentLogger });
      await expect(s.dispatch({ action: { target: { kind: 'program', program: 'x' } }, learnerId: 'kid1' }))
        .resolves.toEqual({ dispatched: false });
    });
    it('a throwing eventBus -> dispatched:false, never throws', async () => {
      const s = new PortalSurface({
        eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silentLogger,
      });
      await expect(s.dispatch({ action: { target: { kind: 'program', program: 'x' } }, learnerId: 'kid1' }))
        .resolves.toEqual({ dispatched: false });
    });
  });

  describe('occupancy', () => {
    it('no schoolActivity -> unknown', async () => {
      const s = new PortalSurface({ logger: silentLogger });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
    it('no open sittings -> idle', async () => {
      const s = new PortalSurface({ schoolActivity: { activeSittings: () => [] }, now: () => NOW_MS });
      await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('a sitting active within freshMs -> active with that occupant', async () => {
      const s = new PortalSurface({
        schoolActivity: { activeSittings: () => [{ userId: 'kid1', lastActiveAt: NOW_MS - 60_000 }] },
        now: () => NOW_MS,
        freshMs: 10 * 60_000,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: 'kid1' });
    });
    it('newest sitting wins among several', async () => {
      const s = new PortalSurface({
        schoolActivity: {
          activeSittings: () => [
            { userId: 'kid1', lastActiveAt: NOW_MS - 9 * 60_000 },
            { userId: 'kid2', lastActiveAt: NOW_MS - 1_000 },
          ],
        },
        now: () => NOW_MS,
        freshMs: 10 * 60_000,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: 'kid2' });
    });
    it('newest sitting stale beyond freshMs -> idle (silence IS idle here)', async () => {
      const s = new PortalSurface({
        schoolActivity: { activeSittings: () => [{ userId: 'kid1', lastActiveAt: NOW_MS - 11 * 60_000 }] },
        now: () => NOW_MS,
        freshMs: 10 * 60_000,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('activeSittings throwing -> unknown (fail closed)', async () => {
      const s = new PortalSurface({
        schoolActivity: { activeSittings: () => { throw new Error('ds down'); } }, logger: silentLogger,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
  });
});

describe('ThermalSurface', () => {
  it('id', () => expect(new ThermalSurface().id).toBe('thermal'));

  it('validateAction rejects garbage, accepts a document', () => {
    const s = new ThermalSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({}).length).toBeGreaterThan(0);
    expect(s.validateAction({ document: 'not-an-object' }).length).toBeGreaterThan(0);
    expect(s.validateAction({ document: { id: 'r1' } })).toEqual([]);
  });

  it('dispatch delegates to receipts.print with the exact document', async () => {
    const print = vi.fn().mockResolvedValue({ printed: true, reason: null });
    const s = new ThermalSurface({ receipts: { print } });
    const document = { id: 'r1', target: ['receipt'] };
    const result = await s.dispatch({ action: { document }, learnerId: 'kid1' });
    expect(print).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledWith(document);
    expect(result).toEqual({ dispatched: true, detail: { printed: true, reason: null } });
  });

  it('receipts.print reporting printed:false -> dispatched:false', async () => {
    const print = vi.fn().mockResolvedValue({ printed: false, reason: 'not_wired' });
    const s = new ThermalSurface({ receipts: { print } });
    const result = await s.dispatch({ action: { document: { id: 'r1' } }, learnerId: null });
    expect(result.dispatched).toBe(false);
  });

  it('no receipts port -> dispatched:false, never throws', async () => {
    const s = new ThermalSurface();
    await expect(s.dispatch({ action: { document: { id: 'r1' } }, learnerId: null }))
      .resolves.toEqual({ dispatched: false });
  });

  it('occupancy is always idle — a queue, not a stage', async () => {
    const s = new ThermalSurface({ receipts: { print: vi.fn() } });
    await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
  });
});

describe('LaserSurface', () => {
  it('id', () => expect(new LaserSurface().id).toBe('laser'));

  it('validateAction rejects garbage, accepts absent or object document', () => {
    const s = new LaserSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({ document: 'nope' }).length).toBeGreaterThan(0);
    expect(s.validateAction({ document: null }).length).toBeGreaterThan(0);
    expect(s.validateAction({})).toEqual([]);
    expect(s.validateAction({ document: { id: 'd1' } })).toEqual([]);
  });

  it('dispatch delegates to issueOrPrint.print with the document + learnerId', async () => {
    const print = vi.fn().mockResolvedValue({ printed: true });
    const s = new LaserSurface({ issueOrPrint: { print }, logger: silentLogger });
    const document = { id: 'd1' };
    // requestedBy arrives as a SIBLING of action (this is the exact shape
    // DoNowService#actDispatch calls adapters with — see the real-service
    // regression test below) — NOT merged into the action payload.
    const result = await s.dispatch({ action: { document }, learnerId: 'kid1', requestedBy: 'school-scan' });
    expect(print).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledWith(document, { learnerId: 'kid1', requestedBy: 'school-scan' });
    expect(result).toEqual({ dispatched: true, detail: { printed: true } });
  });

  it('attribution logging is NON-OPTIONAL: donow.laser.print {learnerId, requestedBy} at info, even with no printer wired', async () => {
    const info = vi.fn();
    const s = new LaserSurface({ logger: { ...silentLogger, info } });
    await s.dispatch({ action: { document: { id: 'd1' } }, learnerId: 'kid1', requestedBy: 'school-scan' });
    expect(info).toHaveBeenCalledWith('donow.laser.print', { learnerId: 'kid1', requestedBy: 'school-scan' });
  });

  it('a throwing issueOrPrint -> dispatched:false, never throws (attribution still logged)', async () => {
    const info = vi.fn();
    const s = new LaserSurface({
      issueOrPrint: { print: () => { throw new Error('printer jammed'); } },
      logger: { ...silentLogger, info },
    });
    await expect(s.dispatch({ action: { document: { id: 'd1' } }, learnerId: 'kid1' }))
      .resolves.toEqual({ dispatched: false });
    expect(info).toHaveBeenCalledWith('donow.laser.print', { learnerId: 'kid1', requestedBy: null });
  });

  it('REGRESSION GUARD (spec §5 laser): a real DoNowService call — where requestedBy is a sibling of action, exactly as the router/DoNowService send it — must NOT log requestedBy:null', async () => {
    const info = vi.fn();
    const s = new LaserSurface({ issueOrPrint: { print: vi.fn().mockResolvedValue({ printed: true }) }, logger: { ...silentLogger, info } });
    const { DoNowService } = await import('#apps/donow/DoNowService.mjs');
    const service = new DoNowService({
      surfaces: new Map([['laser', s]]),
      datastore: { findPending: async () => null, putPending: async () => {}, appendDispatch: async () => {} },
      logger: silentLogger,
    });
    const result = await service.dispatch({
      surface: 'laser', action: { document: { id: 'd1' } }, learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ref1',
    });
    expect(result.decision).toBe('dispatched');
    expect(info).toHaveBeenCalledWith('donow.laser.print', { learnerId: 'kid1', requestedBy: 'school-scan' });
  });

  it('occupancy is always idle', async () => {
    const s = new LaserSurface();
    await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
  });
});

describe('PlaybackHubSurface', () => {
  const slot = (color, playing, paused = false) => ({
    color, now_playing: playing ? { queue: { source: 'plex', id: '1' } } : null, paused,
  });

  it('id', () => expect(new PlaybackHubSurface().id).toBe('playback-hub'));

  it('validateAction rejects garbage, accepts a well-formed action', () => {
    const s = new PlaybackHubSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({}).length).toBeGreaterThan(0);
    expect(s.validateAction({ action: 'play' }).length).toBeGreaterThan(0);
    expect(s.validateAction({ target: 'red' }).length).toBeGreaterThan(0);
    expect(s.validateAction({ action: 'play', target: 'red', contentId: 'plex:1' })).toEqual([]);
  });

  it('dispatch delegates to sendHubCommand.execute with the exact action payload', async () => {
    const execute = vi.fn().mockResolvedValue({ applied: ['red'], skipped: [] });
    const s = new PlaybackHubSurface({ sendHubCommand: { execute }, logger: silentLogger });
    const action = { action: 'play', target: 'red', contentId: 'plex:1', volume: 40 };
    const result = await s.dispatch({ action, learnerId: 'kid1' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(action);
    expect(result).toEqual({ dispatched: true, detail: { applied: ['red'], skipped: [] } });
  });

  it('sendHubCommand.execute reporting nothing applied -> dispatched:false', async () => {
    const execute = vi.fn().mockResolvedValue({ applied: [], skipped: [{ color: 'red', reason: 'unreachable' }] });
    const s = new PlaybackHubSurface({ sendHubCommand: { execute } });
    const result = await s.dispatch({ action: { action: 'play', target: 'red' }, learnerId: null });
    expect(result.dispatched).toBe(false);
  });

  it('a throwing sendHubCommand -> dispatched:false, never throws', async () => {
    const s = new PlaybackHubSurface({
      sendHubCommand: { execute: () => { throw new Error('gateway down'); } }, logger: silentLogger,
    });
    await expect(s.dispatch({ action: { action: 'play', target: 'red' }, learnerId: null }))
      .resolves.toEqual({ dispatched: false });
  });

  it('no sendHubCommand -> dispatched:false, never throws', async () => {
    const s = new PlaybackHubSurface();
    await expect(s.dispatch({ action: { action: 'play', target: 'red' }, learnerId: null }))
      .resolves.toEqual({ dispatched: false });
  });

  describe('occupancy', () => {
    // NOTE: the real call convention is `adapter.occupancy({ action })` (see
    // DoNowService#probeOccupancy) — action is a SIBLING key, never the
    // whole argument. These unit tests mirror that shape directly.
    it('no gateway -> unknown', async () => {
      const s = new PlaybackHubSurface();
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
    it('a matching slot playing (not paused) -> active', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', true), slot('blue', false)]);
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus } });
      await expect(s.occupancy({ action: { target: 'red' } })).resolves.toEqual({ state: 'active', occupantId: null });
    });
    it('a matching slot playing but PAUSED does not count as active (idle)', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', true, true)]);
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus } });
      await expect(s.occupancy({ action: { target: 'red' } })).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('no target scoping (no action) checks every slot', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', false), slot('blue', true)]);
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus } });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: null });
      await expect(s.occupancy({})).resolves.toEqual({ state: 'active', occupantId: null });
    });
    it('no slot playing -> idle', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', false), slot('blue', false)]);
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus } });
      await expect(s.occupancy({ action: { target: 'red,blue' } })).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('getStatus throwing -> unknown (fail closed)', async () => {
      const getStatus = vi.fn().mockRejectedValue(new Error('hub unreachable'));
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus }, logger: silentLogger });
      await expect(s.occupancy({ action: { target: 'red' } })).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
  });

  describe('REGRESSION GUARD (spec §5.1 playback-hub): occupancy scoping through a real DoNowService', () => {
    it('one slot (red) playing + a dispatch targeting a DIFFERENT slot (blue) -> dispatched, not pending', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', true), slot('blue', false)]);
      const execute = vi.fn().mockResolvedValue({ applied: ['blue'], skipped: [] });
      const s = new PlaybackHubSurface({ sendHubCommand: { execute }, headsetHubGateway: { getStatus }, logger: silentLogger });
      const { DoNowService } = await import('#apps/donow/DoNowService.mjs');
      const service = new DoNowService({
        surfaces: new Map([['playback-hub', s]]),
        datastore: { findPending: async () => null, putPending: async () => {}, appendDispatch: async () => {} },
        logger: silentLogger,
      });
      const result = await service.dispatch({
        surface: 'playback-hub', action: { action: 'play', target: 'blue', contentId: 'plex:2' },
        learnerId: null, requestedBy: 'api', ref: 'r-blue',
      });
      expect(result.decision).toBe('dispatched');
    });

    it('one slot (red) playing + a dispatch targeting THAT slot (red) -> pending_approval (busy), not dispatched', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', true), slot('blue', false)]);
      const execute = vi.fn().mockResolvedValue({ applied: ['red'], skipped: [] });
      const s = new PlaybackHubSurface({ sendHubCommand: { execute }, headsetHubGateway: { getStatus }, logger: silentLogger });
      const { DoNowService } = await import('#apps/donow/DoNowService.mjs');
      const service = new DoNowService({
        surfaces: new Map([['playback-hub', s]]),
        datastore: { findPending: async () => null, putPending: async () => {}, appendDispatch: async () => {} },
        notifier: { notify: async () => {} },
        logger: silentLogger,
      });
      const result = await service.dispatch({
        surface: 'playback-hub', action: { action: 'play', target: 'red', contentId: 'plex:1' },
        learnerId: null, requestedBy: 'api', ref: 'r-red',
      });
      expect(result.decision).toBe('pending_approval');
      expect(execute).not.toHaveBeenCalled();
    });

    it('DoNowService.occupancyFor(surface, action) — the approve-time re-check hook — re-scopes to the SAME action, not the whole surface', async () => {
      const getStatus = vi.fn().mockResolvedValue([slot('red', true), slot('blue', false)]);
      const s = new PlaybackHubSurface({ headsetHubGateway: { getStatus }, logger: silentLogger });
      const { DoNowService } = await import('#apps/donow/DoNowService.mjs');
      const service = new DoNowService({
        surfaces: new Map([['playback-hub', s]]),
        datastore: { findPending: async () => null, putPending: async () => {}, appendDispatch: async () => {} },
        logger: silentLogger,
      });
      await expect(service.occupancyFor('playback-hub', { target: 'red' }))
        .resolves.toEqual({ state: 'active', occupantId: null });
      await expect(service.occupancyFor('playback-hub', { target: 'blue' }))
        .resolves.toEqual({ state: 'idle', occupantId: null });
    });
  });
});

describe('LivingroomTvSurface', () => {
  it('id', () => expect(new LivingroomTvSurface().id).toBe('livingroom-tv'));

  it('validateAction rejects garbage, accepts a query', () => {
    const s = new LivingroomTvSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({}).length).toBeGreaterThan(0);
    expect(s.validateAction({ query: { play: 'plex:1' } })).toEqual([]);
  });

  it('dispatch delegates to wakeAndLoad.execute(deviceId, action.query)', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, deviceId: 'livingroom-tv' });
    const s = new LivingroomTvSurface({ wakeAndLoad: { execute }, deviceId: 'livingroom-tv', logger: silentLogger });
    const action = { query: { play: 'plex:12345', volume: 20 } };
    const result = await s.dispatch({ action, learnerId: 'kid1' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('livingroom-tv', action.query);
    expect(result).toEqual({ dispatched: true, detail: { ok: true, deviceId: 'livingroom-tv' } });
  });

  it('wakeAndLoad reporting ok:false -> dispatched:false', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false, error: 'Display did not turn on' });
    const s = new LivingroomTvSurface({ wakeAndLoad: { execute } });
    const result = await s.dispatch({ action: { query: {} }, learnerId: null });
    expect(result.dispatched).toBe(false);
  });

  it('a throwing wakeAndLoad -> dispatched:false, never throws', async () => {
    const s = new LivingroomTvSurface({
      wakeAndLoad: { execute: () => { throw new Error('device offline'); } }, logger: silentLogger,
    });
    await expect(s.dispatch({ action: { query: {} }, learnerId: null })).resolves.toEqual({ dispatched: false });
  });

  it('no wakeAndLoad -> dispatched:false, never throws', async () => {
    const s = new LivingroomTvSurface();
    await expect(s.dispatch({ action: { query: {} }, learnerId: null })).resolves.toEqual({ dispatched: false });
  });

  describe('occupancy (three-step rule)', () => {
    it('no tvState -> unknown', async () => {
      const s = new LivingroomTvSurface({ logger: silentLogger });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
    it('TV power off -> idle, regardless of playback tracker', async () => {
      const s = new LivingroomTvSurface({
        tvState: { isOn: async () => false }, playback: { playingRecently: () => true },
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('power on + recent playback.log frames -> active, occupant always null', async () => {
      const s = new LivingroomTvSurface({
        tvState: { isOn: async () => true }, playback: { playingRecently: () => true },
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: null });
    });
    it('power on with no recent frames (paused/menu) -> idle', async () => {
      const s = new LivingroomTvSurface({
        tvState: { isOn: async () => true }, playback: { playingRecently: () => false },
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('power on, no playback tracker injected -> idle (nothing to prove active)', async () => {
      const s = new LivingroomTvSurface({ tvState: { isOn: async () => true } });
      await expect(s.occupancy()).resolves.toEqual({ state: 'idle', occupantId: null });
    });
    it('tvState.isOn() throwing -> unknown (fail closed)', async () => {
      const s = new LivingroomTvSurface({
        tvState: { isOn: () => { throw new Error('HA unreachable'); } }, logger: silentLogger,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
  });
});

describe('GarageFitnessSurface', () => {
  it('id', () => expect(new GarageFitnessSurface().id).toBe('garage-fitness'));

  it('validateAction rejects garbage, accepts an episodeId', () => {
    const s = new GarageFitnessSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({}).length).toBeGreaterThan(0);
    expect(s.validateAction({ episodeId: 123 }).length).toBeGreaterThan(0);
    expect(s.validateAction({ episodeId: 'plex:12345' })).toEqual([]);
  });

  it('dispatch delegates to eventBus.broadcast with the exact fitness.launch envelope', async () => {
    const broadcast = vi.fn();
    const s = new GarageFitnessSurface({ eventBus: { broadcast }, logger: silentLogger });
    const result = await s.dispatch({ action: { episodeId: 'plex:12345' }, learnerId: 'kid1' });
    expect(result).toEqual({ dispatched: true });
    expect(broadcast).toHaveBeenCalledWith('fitness', {
      type: 'fitness.launch', learnerId: 'kid1', episodeId: 'plex:12345',
    });
  });

  it('no eventBus -> dispatched:false, never throws', async () => {
    const s = new GarageFitnessSurface({ logger: silentLogger });
    await expect(s.dispatch({ action: { episodeId: 'plex:12345' }, learnerId: 'kid1' }))
      .resolves.toEqual({ dispatched: false });
  });

  it('a throwing eventBus -> dispatched:false, never throws', async () => {
    const s = new GarageFitnessSurface({
      eventBus: { broadcast: () => { throw new Error('bus down'); } }, logger: silentLogger,
    });
    await expect(s.dispatch({ action: { episodeId: 'plex:12345' }, learnerId: 'kid1' }))
      .resolves.toEqual({ dispatched: false });
  });

  describe('occupancy', () => {
    it('delegates directly to presence.occupancy()', async () => {
      const occupancy = vi.fn().mockReturnValue({ state: 'active', occupantId: null });
      const s = new GarageFitnessSurface({ presence: { occupancy } });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: null });
      expect(occupancy).toHaveBeenCalledTimes(1);
    });
    it('no presence tracker -> unknown', async () => {
      const s = new GarageFitnessSurface({ logger: silentLogger });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
    it('presence.occupancy() throwing -> unknown (fail closed)', async () => {
      const s = new GarageFitnessSurface({
        presence: { occupancy: () => { throw new Error('tracker broke'); } }, logger: silentLogger,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
  });
});

describe('PianoKioskSurface', () => {
  it('id', () => expect(new PianoKioskSurface().id).toBe('piano-kiosk'));

  it('validateAction rejects garbage, accepts a contentId', () => {
    const s = new PianoKioskSurface();
    expect(s.validateAction(null).length).toBeGreaterThan(0);
    expect(s.validateAction({}).length).toBeGreaterThan(0);
    expect(s.validateAction({ contentId: 42 }).length).toBeGreaterThan(0);
    expect(s.validateAction({ contentId: 'hymn:12' })).toEqual([]);
  });

  it('dispatch delegates to eventBus.broadcast with the exact kiosk.launch envelope, addressed by kioskDeviceParam', async () => {
    const broadcast = vi.fn();
    const s = new PianoKioskSurface({ eventBus: { broadcast }, kioskDeviceParam: 'piano-tablet-1', logger: silentLogger });
    const result = await s.dispatch({ action: { contentId: 'hymn:12' }, learnerId: 'kid1' });
    expect(result).toEqual({ dispatched: true });
    expect(broadcast).toHaveBeenCalledWith('kiosk.launch', {
      topic: 'kiosk.launch', deviceId: 'piano-tablet-1', contentId: 'hymn:12', type: 'piano.launch',
    });
  });

  // Remote PLAY (2026-08-23): the bus can ask the kiosk to open a score AND
  // perform it. An unknown mode is refused at validation rather than forwarded —
  // same honesty rule as contentId: never report dispatched:true for a payload
  // the kiosk will ignore.
  it('validateAction accepts a known play mode and rejects an unknown one', () => {
    const s = new PianoKioskSurface();
    expect(s.validateAction({ contentId: 'hymn:12', play: 'listen' })).toEqual([]);
    expect(s.validateAction({ contentId: 'hymn:12', play: 'perform' })).toEqual([]);
    expect(s.validateAction({ contentId: 'hymn:12', play: 'karaoke' }).length).toBeGreaterThan(0);
  });

  it('dispatch carries the play hint, and omits the key entirely without one', async () => {
    const broadcast = vi.fn();
    const s = new PianoKioskSurface({ eventBus: { broadcast }, kioskDeviceParam: 'piano-tablet-1', logger: silentLogger });

    await s.dispatch({ action: { contentId: 'files:docs/x.mxl', play: 'listen' }, learnerId: 'kid1' });
    expect(broadcast).toHaveBeenCalledWith('kiosk.launch', {
      topic: 'kiosk.launch', deviceId: 'piano-tablet-1', contentId: 'files:docs/x.mxl',
      type: 'piano.launch', play: 'listen',
    });

    broadcast.mockClear();
    await s.dispatch({ action: { contentId: 'hymn:12' }, learnerId: 'kid1' });
    expect(broadcast.mock.calls[0][1]).not.toHaveProperty('play');
  });

  it('validates and dispatches a structured course lesson with learner identity', async () => {
    const broadcast = vi.fn();
    const s = new PianoKioskSurface({ eventBus: { broadcast }, kioskDeviceParam: 'piano-tablet-1', logger: silentLogger });
    const action = {
      kind: 'course-lesson', learnerId: 'felix', courseId: 'plex:675689', courseTitle: 'Hoffman Academy',
      unitId: 'season-4', unitTitle: 'Unit 4', lessonId: 'plex:9001', lessonTitle: 'Lesson 1',
    };
    expect(s.validateAction(action)).toEqual([]);
    await expect(s.dispatch({ action, learnerId: 'felix' })).resolves.toEqual({ dispatched: true });
    expect(broadcast).toHaveBeenCalledWith('kiosk.launch', expect.objectContaining({
      type: 'piano.course-lesson.launch', deviceId: 'piano-tablet-1', learnerId: 'felix',
      courseId: 'plex:675689', unitId: 'season-4', lessonId: 'plex:9001',
    }));
  });

  it('no eventBus -> dispatched:false, never throws', async () => {
    const s = new PianoKioskSurface({ kioskDeviceParam: 'piano-tablet-1', logger: silentLogger });
    await expect(s.dispatch({ action: { contentId: 'hymn:12' }, learnerId: 'kid1' }))
      .resolves.toEqual({ dispatched: false });
  });

  it('a throwing eventBus -> dispatched:false, never throws', async () => {
    const s = new PianoKioskSurface({
      eventBus: { broadcast: () => { throw new Error('bus down'); } },
      kioskDeviceParam: 'piano-tablet-1',
      logger: silentLogger,
    });
    await expect(s.dispatch({ action: { contentId: 'hymn:12' }, learnerId: 'kid1' }))
      .resolves.toEqual({ dispatched: false });
  });

  describe('occupancy', () => {
    it('delegates directly to presence.occupancy()', async () => {
      const occupancy = vi.fn().mockReturnValue({ state: 'active', occupantId: null });
      const s = new PianoKioskSurface({ presence: { occupancy } });
      await expect(s.occupancy()).resolves.toEqual({ state: 'active', occupantId: null });
      expect(occupancy).toHaveBeenCalledTimes(1);
    });
    it('no presence tracker -> unknown', async () => {
      const s = new PianoKioskSurface({ logger: silentLogger });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
    it('presence.occupancy() throwing -> unknown (fail closed)', async () => {
      const s = new PianoKioskSurface({
        presence: { occupancy: () => { throw new Error('tracker broke'); } }, logger: silentLogger,
      });
      await expect(s.occupancy()).resolves.toEqual({ state: 'unknown', occupantId: null });
    });
  });
});
