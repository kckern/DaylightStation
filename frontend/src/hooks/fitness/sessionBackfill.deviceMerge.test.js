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

describe('runSessionBackfill — backward absorb skips in-session-transferred ghosts', () => {
  it('does not fold a final insignificant segment into an already-transferred predecessor', () => {
    const entities = [
      // Real, substantial occupant — the only valid backward-absorb target.
      { entityId: 'e0', profileId: 'granny',     deviceId: 'D1', startTime: 0,      endTime: 100000, status: 'active' },
      // Already merged away in-session (status:'transferred') — must be walked PAST, never absorbed into.
      { entityId: 'e1', profileId: 'oldguest',   deviceId: 'D1', startTime: 100000, endTime: 160000, status: 'transferred' },
      // Final, insignificant-effort segment with no successor — triggers OI-1 backward absorb.
      { entityId: 'e2', profileId: 'shortguest', deviceId: 'D1', startTime: 160000, endTime: 165000, status: 'active' }
    ];
    const series = {
      // granny has substantial effort so she's a legitimate absorb target.
      'user:granny:heart_rate': [120, 121, 122, 123],
      'user:granny:coins_total': [5, 10, 15, 20]
      // oldguest and shortguest are left with zero/default effort (insignificant).
    };
    const r = runSessionBackfill({ entities, series, sessionEndTime: 165000 });

    // The transfer target must never be the already-transferred ghost.
    expect(r.transfers.some(t => t.toOccupantId === 'oldguest')).toBe(false);
    // It should instead walk past the ghost to the real, valid predecessor.
    expect(r.transfers).toContainEqual({ fromOccupantId: 'shortguest', toOccupantId: 'granny', reason: 'insignificant-backward' });

    // granny's data survives: she's kept, not removed.
    expect(r.keptOccupants.has('granny')).toBe(true);
    expect([...r.removedOccupants]).not.toContain('granny');
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
    // keptOccupants and removedOccupants must stay a clean partition — the merged-away
    // id must not linger in keptOccupants just because its segment flags weren't touched.
    expect(r.keptOccupants.has('kckern_alt')).toBe(false);
  });
});
