import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualPlaybackAdapter } from '#adapters/hardware/playback/VirtualPlaybackAdapter.mjs';
import { SlotStatus } from '#domains/playback-hub/value-objects/SlotStatus.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const makeBus = () => {
  const broadcasts = [];
  return {
    broadcasts,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    of: (type) => broadcasts.filter((b) => b.payload.type === type).map((b) => b.payload),
  };
};

let bus, playback;

beforeEach(() => {
  bus = makeBus();
  playback = new VirtualPlaybackAdapter({ eventBus: bus, targets: ['tv', 'headset'], logger: silent });
});

const dispatchOne = (over = {}) => playback.dispatch({
  target: 'tv', contentId: 'plex:670208', learnerId: 'kid1', durationSec: 600, sessionId: 'ses_1', ...over,
});

describe('construction', () => {
  it('requires an event bus with broadcast', () => {
    expect(() => new VirtualPlaybackAdapter({})).toThrow(/eventBus/);
  });
});

describe('dispatch', () => {
  it('returns a correlator plus the dispatched facts', () => {
    const rec = dispatchOne();
    expect(rec.dispatchId).toMatch(/^dsp_/);
    expect(rec).toMatchObject({
      target: 'tv', contentId: 'plex:670208', learnerId: 'kid1',
      durationSec: 600, positionSec: 0, status: 'playing',
    });
    expect(Date.parse(rec.startedAt)).not.toBeNaN();
  });

  it('mints a distinct dispatchId per dispatch', () => {
    expect(dispatchOne().dispatchId).not.toBe(dispatchOne().dispatchId);
  });

  it('announces the dispatch on the bus', () => {
    const rec = dispatchOne();
    expect(bus.broadcasts[0].topic).toBe('school-playback');
    expect(bus.of('dispatched')[0]).toMatchObject({
      source: 'virtual-playback', dispatchId: rec.dispatchId, target: 'tv', contentId: 'plex:670208', learnerId: 'kid1',
    });
  });

  it('rejects a dispatch with no target or no contentId', () => {
    expect(() => playback.dispatch({ contentId: 'plex:1', learnerId: 'kid1' })).toThrow(/target/);
    expect(() => playback.dispatch({ target: 'tv', learnerId: 'kid1' })).toThrow(/contentId/);
  });

  // The port widening that came with the real screen adapter (§8): the screen
  // fetches its lesson BY session id, so a dispatch that cannot name its
  // session is one no screen could act on. Required here too, deliberately —
  // a double that tolerated its absence would let that ship green.
  it('rejects a dispatch with no sessionId, exactly as the real screen adapter does', () => {
    expect(() => playback.dispatch({ target: 'tv', contentId: 'plex:1', learnerId: 'kid1', durationSec: 60 }))
      .toThrow(/sessionId/);
  });

  it('carries the sessionId on the record and on the wire', () => {
    const rec = dispatchOne();
    expect(rec.sessionId).toBe('ses_1');
    expect(bus.of('dispatched')[0].sessionId).toBe('ses_1');
  });

  it('registers an unknown target as a new slot', () => {
    playback.dispatch({ target: 'garage-speaker', contentId: 'plex:1', learnerId: 'kid1', durationSec: 60, sessionId: 'ses_1' });
    expect(playback.getStatus().map((s) => s.color)).toContain('garage-speaker');
  });
});

describe('advance — partial progress', () => {
  it('moves the playhead and emits progress without completing', () => {
    const { dispatchId } = dispatchOne();
    const rec = playback.advance(dispatchId, 150);
    expect(rec.positionSec).toBe(150);
    expect(rec.status).toBe('playing');
    const progress = bus.of('progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ dispatchId, seconds: 150, percent: 25 });
    expect(bus.of('complete')).toEqual([]);
  });

  it('accumulates across calls', () => {
    const { dispatchId } = dispatchOne();
    playback.advance(dispatchId, 100);
    expect(playback.advance(dispatchId, 50).positionSec).toBe(150);
  });

  it('clamps at the duration and still does not complete on its own', () => {
    const { dispatchId } = dispatchOne();
    const rec = playback.advance(dispatchId, 9999);
    expect(rec.positionSec).toBe(600);
    expect(rec.status).toBe('playing');
    expect(bus.of('complete')).toEqual([]);
  });

  it('refuses to advance a stopped dispatch', () => {
    const { dispatchId } = dispatchOne();
    playback.interrupt(dispatchId);
    expect(() => playback.advance(dispatchId, 10)).toThrow(/stopped/);
  });

  it('rejects a non-positive advance', () => {
    const { dispatchId } = dispatchOne();
    expect(() => playback.advance(dispatchId, 0)).toThrow();
    expect(() => playback.advance(dispatchId, -5)).toThrow();
  });
});

describe('playToEnd — the completion signal', () => {
  it('parks the playhead at the duration and emits complete', () => {
    const { dispatchId } = dispatchOne();
    const rec = playback.playToEnd(dispatchId);
    expect(rec).toMatchObject({ status: 'completed', positionSec: 600 });
    expect(Date.parse(rec.endedAt)).not.toBeNaN();
    const complete = bus.of('complete');
    expect(complete).toHaveLength(1);
    expect(complete[0]).toMatchObject({
      source: 'virtual-playback', dispatchId, target: 'tv',
      contentId: 'plex:670208', learnerId: 'kid1', seconds: 600, percent: 100,
    });
  });

  it('is idempotent — a second call emits nothing new', () => {
    const { dispatchId } = dispatchOne();
    playback.playToEnd(dispatchId);
    playback.playToEnd(dispatchId);
    expect(bus.of('complete')).toHaveLength(1);
  });

  it('completes after partial progress', () => {
    const { dispatchId } = dispatchOne();
    playback.advance(dispatchId, 120);
    expect(playback.playToEnd(dispatchId).positionSec).toBe(600);
    expect(bus.of('complete')).toHaveLength(1);
  });

  it('refuses to complete an interrupted dispatch', () => {
    const { dispatchId } = dispatchOne();
    playback.interrupt(dispatchId);
    expect(() => playback.playToEnd(dispatchId)).toThrow(/stopped/);
    expect(bus.of('complete')).toEqual([]);
  });

  it('throws for an unknown dispatchId', () => {
    expect(() => playback.playToEnd('dsp_nope')).toThrow(/dsp_nope/);
  });
});

describe('interrupt — the stall path', () => {
  it('records a stop and emits NO completion', () => {
    const { dispatchId } = dispatchOne();
    playback.advance(dispatchId, 90);
    const rec = playback.interrupt(dispatchId);
    expect(rec).toMatchObject({ status: 'stopped', positionSec: 90 });
    expect(bus.of('stop')).toHaveLength(1);
    expect(bus.of('complete')).toEqual([]);
  });

  it('is idempotent', () => {
    const { dispatchId } = dispatchOne();
    playback.interrupt(dispatchId);
    playback.interrupt(dispatchId);
    expect(bus.of('stop')).toHaveLength(1);
  });

  it('cannot un-complete a finished dispatch', () => {
    const { dispatchId } = dispatchOne();
    playback.playToEnd(dispatchId);
    expect(() => playback.interrupt(dispatchId)).toThrow(/completed/);
  });
});

describe('getStatus — mirrors the hub status shape', () => {
  it('returns one SlotStatus per known target, idle by default', () => {
    const slots = playback.getStatus();
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s instanceof SlotStatus)).toBe(true);
    expect(slots.map((s) => s.color)).toEqual(['tv', 'headset']);
    expect(slots.map((s) => s.position)).toEqual([1, 2]);
    expect(slots[0].now_playing).toBe(null);
  });

  it('serializes to the hub wire shape', () => {
    const slot = playback.getStatus()[0];
    const json = {
      position: slot.position,
      color: slot.color,
      bt_connected: slot.bt_connected,
      paused: slot.paused,
      now_playing: slot.now_playing,
      volume: slot.volume,
      playlist_pos: slot.playlist_pos,
      playlist_count: slot.playlist_count,
      armed_source: slot.armed_source,
    };
    expect(Object.keys(json).sort()).toEqual([
      'armed_source', 'bt_connected', 'color', 'now_playing', 'paused',
      'playlist_count', 'playlist_pos', 'position', 'volume',
    ]);
  });

  it('reports now_playing while a dispatch is live', () => {
    dispatchOne();
    const tv = playback.getStatus().find((s) => s.color === 'tv');
    expect(tv.now_playing).toEqual({ queue: { source: 'plex', id: '670208' } });
    expect(tv.paused).toBe(false);
  });

  it('treats a bare content id as a plex id, like the hub adapter does', () => {
    playback.dispatch({ target: 'tv', contentId: '670208', learnerId: 'kid1', durationSec: 60, sessionId: 'ses_1' });
    expect(playback.getStatus().find((s) => s.color === 'tv').now_playing.queue).toEqual({ source: 'plex', id: '670208' });
  });

  it('goes idle again once the dispatch completes', () => {
    const { dispatchId } = dispatchOne();
    playback.playToEnd(dispatchId);
    expect(playback.getStatus().find((s) => s.color === 'tv').now_playing).toBe(null);
  });

  it('goes idle again once the dispatch is interrupted', () => {
    const { dispatchId } = dispatchOne();
    playback.interrupt(dispatchId);
    expect(playback.getStatus().find((s) => s.color === 'tv').now_playing).toBe(null);
  });
});

describe('listDispatches / getDispatch', () => {
  it('lists dispatches in order with their current state', () => {
    const a = dispatchOne();
    const b = dispatchOne({ target: 'headset', contentId: 'plex:2' });
    playback.playToEnd(a.dispatchId);
    expect(playback.listDispatches().map((d) => [d.dispatchId, d.status]))
      .toEqual([[a.dispatchId, 'completed'], [b.dispatchId, 'playing']]);
  });

  it('getDispatch returns null for an unknown id', () => {
    expect(playback.getDispatch('dsp_nope')).toBe(null);
  });

  it('returned records are copies — mutating one does not corrupt the adapter', () => {
    const { dispatchId } = dispatchOne();
    playback.getDispatch(dispatchId).status = 'tampered';
    expect(playback.getDispatch(dispatchId).status).toBe('playing');
  });
});
