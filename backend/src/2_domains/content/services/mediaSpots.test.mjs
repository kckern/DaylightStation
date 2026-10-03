import { describe, it, expect } from 'vitest';
import {
  SPOT_DEFAULTS,
  normalizeSpotDeviceId,
  isSpotFinished,
  isSpotOpen,
  recordSpot,
  openSpotsOf,
  spotDeviceKind,
} from './mediaSpots.mjs';

describe('normalizeSpotDeviceId', () => {
  it('keeps fleet: and browser: ids as they are', () => {
    expect(normalizeSpotDeviceId('fleet:livingroom-tv')).toBe('fleet:livingroom-tv');
    expect(normalizeSpotDeviceId('browser:c74fee96a6134c13')).toBe('browser:c74fee96a6134c13');
  });
  it('treats a bare fleet name as a fleet device', () => {
    expect(normalizeSpotDeviceId('livingroom-tv')).toBe('fleet:livingroom-tv');
  });
  it('refuses ephemeral ids, user-agent strings and junk', () => {
    expect(normalizeSpotDeviceId('ephemeral:abc')).toBeNull();
    expect(normalizeSpotDeviceId('Mozilla/5.0 (Linux; Android 10)')).toBeNull();
    expect(normalizeSpotDeviceId('')).toBeNull();
    expect(normalizeSpotDeviceId(null)).toBeNull();
    expect(normalizeSpotDeviceId(42)).toBeNull();
  });
  it('names the kind of device', () => {
    expect(spotDeviceKind('fleet:office-tv')).toBe('screen');
    expect(spotDeviceKind('browser:abc')).toBe('browser');
    expect(spotDeviceKind(null)).toBe('unknown');
  });
});

describe('finished / unfinished rule (RQ-FIND-12 defaults)', () => {
  it('uses 5 minutes or 5% to start counting, 90% to finish', () => {
    expect(SPOT_DEFAULTS).toMatchObject({ unfinishedMinSeconds: 300, unfinishedMinPercent: 5, finishedPercent: 90 });
  });
  it('a spot 4 min into a 2 h film (3%) is not yet unfinished', () => {
    expect(isSpotOpen({ playhead: 240, duration: 7200 })).toBe(false);
  });
  it('a spot 5 min into a 2 h film is unfinished', () => {
    expect(isSpotOpen({ playhead: 300, duration: 7200 })).toBe(true);
  });
  it('a spot at 5% of a short item is unfinished', () => {
    expect(isSpotOpen({ playhead: 30, duration: 600 })).toBe(true);
  });
  it('a spot at 90% (credits) is finished, not open', () => {
    expect(isSpotFinished({ playhead: 6480, duration: 7200 })).toBe(true);
    expect(isSpotOpen({ playhead: 6480, duration: 7200 })).toBe(false);
  });
  it('falls back to a stored percent when duration is unknown', () => {
    expect(isSpotOpen({ playhead: 400, duration: 0, percent: 50 })).toBe(true);
    expect(isSpotFinished({ playhead: 0, duration: 0, percent: 100 })).toBe(true);
  });
});

describe('recordSpot', () => {
  it('adds a spot for a device without touching the others', () => {
    const before = { 'fleet:livingroom-tv': { playhead: 4800, duration: 7200, percent: 67, lastPlayed: '2026-10-01 21:00:00' } };
    const after = recordSpot(before, 'browser:kid', { playhead: 720, duration: 7200, at: '2026-10-02 08:00:00' });
    expect(after['fleet:livingroom-tv']).toEqual(before['fleet:livingroom-tv']);
    expect(after['browser:kid']).toEqual({ playhead: 720, duration: 7200, percent: 10, lastPlayed: '2026-10-02 08:00:00' });
    expect(before['browser:kid']).toBeUndefined();
  });
  it('overwrites the same device spot', () => {
    const after = recordSpot({ 'fleet:a': { playhead: 1, duration: 100, percent: 1, lastPlayed: 'x' } }, 'fleet:a', { playhead: 50, duration: 100, at: 'y' });
    expect(after['fleet:a']).toEqual({ playhead: 50, duration: 100, percent: 50, lastPlayed: 'y' });
  });
});

describe('openSpotsOf', () => {
  it('lists open spots newest first and skips finished ones', () => {
    const record = {
      playhead: 720, duration: 7200, lastDevice: 'browser:kid',
      spots: {
        'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' },
        'browser:kid': { playhead: 720, duration: 7200, lastPlayed: '2026-10-02 08:00:00' },
        'fleet:office-tv': { playhead: 7000, duration: 7200, lastPlayed: '2026-10-02 09:00:00' },
      },
    };
    expect(openSpotsOf(record).map((s) => s.deviceId)).toEqual(['browser:kid', 'fleet:livingroom-tv']);
  });
  it('an item finished on one screen is still open while another screen holds a spot', () => {
    const record = {
      playhead: 7100, duration: 7200, completedAt: '2026-10-02 09:00:00', lastDevice: 'fleet:office-tv',
      spots: {
        'fleet:office-tv': { playhead: 7100, duration: 7200, lastPlayed: '2026-10-02 09:00:00' },
        'fleet:livingroom-tv': { playhead: 4800, duration: 7200, lastPlayed: '2026-10-01 21:00:00' },
      },
    };
    expect(openSpotsOf(record).map((s) => s.deviceId)).toEqual(['fleet:livingroom-tv']);
  });
  it('a legacy record (no spots, no device) yields one anonymous spot when unfinished', () => {
    const spots = openSpotsOf({ playhead: 1200, duration: 3600, lastPlayed: '2026-09-01 10:00:00' });
    expect(spots).toEqual([{ deviceId: null, playhead: 1200, duration: 3600, percent: 33, lastPlayed: '2026-09-01 10:00:00' }]);
    expect(openSpotsOf({ playhead: 3500, duration: 3600 })).toEqual([]);
  });
  it('a record whose spots were cleared (marked watched/unwatched) has no open spots', () => {
    expect(openSpotsOf({ playhead: 1200, duration: 3600, spots: {}, lastDevice: 'fleet:a' })).toEqual([]);
  });
});
