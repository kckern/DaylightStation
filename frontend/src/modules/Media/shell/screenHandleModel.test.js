import { describe, it, expect } from 'vitest';
import { pickHandleScreen } from './screenHandleModel.js';

const entries = {
  tv: { snapshot: { state: 'playing', currentItem: { title: 'Bluey' } } },
  kitchen: { snapshot: { state: 'paused', currentItem: { title: 'Jazz' } } },
  idle: { snapshot: { state: 'idle', currentItem: null } },
  off: { offline: true, snapshot: { state: 'playing', currentItem: { title: 'x' } } },
};
const entryFor = (id) => entries[id] ?? null;

describe('pickHandleScreen (STEER.1a/AC4)', () => {
  it('prefers the screen most recently steered while it is playing or paused', () => {
    expect(pickHandleScreen({ lastSteeredId: 'kitchen', aimIds: ['tv'], entryFor })).toEqual({ deviceId: 'kitchen', why: 'steered' });
  });
  it('falls back to an aimed screen that is playing', () => {
    expect(pickHandleScreen({ lastSteeredId: 'idle', aimIds: ['idle', 'tv'], entryFor })).toEqual({ deviceId: 'tv', why: 'aimed' });
  });
  it('is none when the screen is idle, offline, unknown or this device', () => {
    expect(pickHandleScreen({ lastSteeredId: 'idle', aimIds: [], entryFor })).toBeNull();
    expect(pickHandleScreen({ lastSteeredId: 'off', aimIds: ['nope'], entryFor })).toBeNull();
    expect(pickHandleScreen({ lastSteeredId: 'tv', aimIds: [], entryFor, isLocal: (id) => id === 'tv' })).toBeNull();
    expect(pickHandleScreen({ entryFor })).toBeNull();
  });
});
