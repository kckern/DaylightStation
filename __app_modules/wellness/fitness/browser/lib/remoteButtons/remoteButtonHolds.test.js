import { afterEach, describe, expect, it } from 'vitest';
import {
  claimRemote, holdRemoteButtons, isRemoteClaimed, isRemoteHeld, remoteButtonHolds, resetRemoteButtonHolds,
} from './remoteButtonHolds.js';

afterEach(() => resetRemoteButtonHolds());

describe('remote button holds and claims', () => {
  it('a hold owns every remote until it is released', () => {
    expect(isRemoteHeld('AA:BB:CC:00:00:01')).toBe(false);
    const release = holdRemoteButtons('skyline-glider');
    expect(remoteButtonHolds()).toEqual(['skyline-glider']);
    expect(isRemoteHeld('AA:BB:CC:00:00:01')).toBe(true);
    expect(isRemoteHeld('AA:BB:CC:00:00:02')).toBe(true);
    release();
    expect(isRemoteHeld('AA:BB:CC:00:00:01')).toBe(false);
  });

  it('holds are counted: one holder releasing leaves the other in place', () => {
    const a = holdRemoteButtons('skyline-glider');
    const b = holdRemoteButtons('skyline-invaders');
    a();
    expect(remoteButtonHolds()).toEqual(['skyline-invaders']);
    a(); // a second release of the same hold is harmless
    expect(isRemoteHeld('x')).toBe(true);
    b();
    expect(isRemoteHeld('x')).toBe(false);
  });

  it('a claim owns one remote by address, case-insensitively', () => {
    const release = claimRemote('aa:bb:cc:00:00:01');
    expect(isRemoteClaimed('AA:BB:CC:00:00:01')).toBe(true);
    expect(isRemoteHeld('AA:BB:CC:00:00:01')).toBe(true);
    expect(isRemoteHeld('AA:BB:CC:00:00:02')).toBe(false);
    release();
    expect(isRemoteClaimed('AA:BB:CC:00:00:01')).toBe(false);
  });
});
