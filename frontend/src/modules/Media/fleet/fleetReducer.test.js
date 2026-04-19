import { describe, it, expect } from 'vitest';
import { reduceFleet, initialFleetState } from './fleetReducer.js';

const makeSnap = (state = 'playing', contentId = 'plex:1') => ({
  sessionId: 's1', state, currentItem: { contentId, format: 'video' }, position: 0,
  queue: { items: [], currentIndex: -1, upNextCount: 0 },
  config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
  meta: { ownerId: 'lr', updatedAt: '2026-04-18T00:00:00Z' },
});

describe('fleetReducer', () => {
  it('RECEIVED stores snapshot + clears stale flag + updates lastSeenAt', () => {
    const state = reduceFleet(initialFleetState, {
      type: 'RECEIVED',
      deviceId: 'lr',
      snapshot: makeSnap(),
      reason: 'heartbeat',
      ts: '2026-04-18T10:00:00Z',
    });
    const entry = state.byDevice.get('lr');
    expect(entry.snapshot.state).toBe('playing');
    expect(entry.reason).toBe('heartbeat');
    expect(entry.isStale).toBe(false);
    expect(entry.offline).toBe(false);
    expect(entry.lastSeenAt).toBe('2026-04-18T10:00:00Z');
  });

  it('OFFLINE (via RECEIVED with reason="offline") flips offline flag but keeps last snapshot', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'lr', snapshot: makeSnap('playing'), reason: 'heartbeat', ts: 't1',
    });
    state = reduceFleet(state, {
      type: 'RECEIVED', deviceId: 'lr', snapshot: makeSnap('playing'), reason: 'offline', ts: 't2',
    });
    const entry = state.byDevice.get('lr');
    expect(entry.offline).toBe(true);
    expect(entry.snapshot.state).toBe('playing'); // preserved
    expect(entry.reason).toBe('offline');
  });

  it('STALE marks every entry stale without clearing snapshots', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'a', snapshot: makeSnap(), reason: 'heartbeat', ts: 't1',
    });
    state = reduceFleet(state, {
      type: 'RECEIVED', deviceId: 'b', snapshot: makeSnap(), reason: 'change', ts: 't2',
    });
    state = reduceFleet(state, { type: 'STALE' });
    expect(state.byDevice.get('a').isStale).toBe(true);
    expect(state.byDevice.get('b').isStale).toBe(true);
    expect(state.byDevice.get('a').snapshot.state).toBe('playing');
  });

  it('RESET empties byDevice', () => {
    let state = reduceFleet(initialFleetState, {
      type: 'RECEIVED', deviceId: 'a', snapshot: makeSnap(), reason: 'initial', ts: 't',
    });
    state = reduceFleet(state, { type: 'RESET' });
    expect(state.byDevice.size).toBe(0);
  });

  it('unknown action type returns prior state reference', () => {
    const s1 = reduceFleet(initialFleetState, { type: 'NOPE' });
    expect(s1).toBe(initialFleetState);
  });
});
