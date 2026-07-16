import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';

describe('runSessionBackfill — effort absorb', () => {
  it('absorbs an idle-long ghost forward into the real occupant', () => {
    const entities = [
      { entityId: 'g1', profileId: 'elizabeth', deviceId: '29413', startTime: 0,   endTime: 300000, status: 'active' },
      { entityId: 'g2', profileId: 'grannie',   deviceId: '29413', startTime: 300000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:elizabeth:heart_rate': [116, null, null],
      'user:grannie:heart_rate':   [null, 80, 90]
    };
    const r = runSessionBackfill({ entities, series, sessionEndTime: 600000 });
    expect([...r.removedOccupants]).toContain('elizabeth');
    expect(r.transfers.some(t => t.fromOccupantId === 'elizabeth' && t.toOccupantId === 'grannie')).toBe(true);
  });
});

describe('runSessionBackfill — known-user device swap merge', () => {
  it('unions the same known user across two devices', () => {
    const entities = [
      { entityId: 'a', profileId: 'kckern', deviceId: 'D1', startTime: 0,   endTime: 60000, status: 'active' },
      { entityId: 'b', profileId: 'kckern', deviceId: 'D2', startTime: 60000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:kckern:heart_rate': [120, 121, 122, 123],
      'user:kckern:coins_total': [10, 20, 30, 40]
    };
    const r = runSessionBackfill({ entities, series, sessionEndTime: 120000 });
    // Same id on both devices → no merge transfer needed (already one identity), no removal.
    expect([...r.removedOccupants]).toHaveLength(0);
    expect(r.merges).toEqual([]); // same occupantId, nothing to rename
  });

  it('merges two DISTINCT known-user segments on different devices into one', () => {
    // Simulates a strap-swap recorded under two ids that map to the same known user.
    const entities = [
      { entityId: 'a', profileId: 'kckern',      deviceId: 'D1', startTime: 0,   endTime: 60000, status: 'active' },
      { entityId: 'b', profileId: 'kckern_alt',  deviceId: 'D2', startTime: 60000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:kckern:heart_rate':     [120, 121, null, null],
      'user:kckern_alt:heart_rate': [null, null, 130, 131]
    };
    const r = runSessionBackfill({
      entities, series, sessionEndTime: 120000,
      knownUserAliases: { kckern_alt: 'kckern' }
    });
    expect(r.merges).toContainEqual({ fromOccupantId: 'kckern_alt', toOccupantId: 'kckern', reason: 'known-user-device-swap' });
    expect([...r.removedOccupants]).toContain('kckern_alt');
  });
});
