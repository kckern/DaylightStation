import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionEndMs, findBrokenEndEvents, findStaleDurationEvents } from './backfill-media-durations.lib.mjs';

describe('computeSessionEndMs', () => {
  it('computes end from start + duration_seconds', () => {
    const session = {
      start: '2026-02-24 12:41:37.000',
      duration_seconds: 1800,
    };
    const result = computeSessionEndMs(session);
    const expected = new Date('2026-02-24T12:41:37.000').getTime() + 1800000;
    assert.equal(result, expected);
  });

  it('returns null for missing data', () => {
    assert.equal(computeSessionEndMs({}), null);
    assert.equal(computeSessionEndMs({ start: '2026-01-01' }), null);
    assert.equal(computeSessionEndMs({ duration_seconds: 100 }), null);
  });
});

describe('findBrokenEndEvents', () => {
  it('finds events with null end', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: null } },
      { type: 'media', data: { contentId: 'plex:200', start: 2000, end: 5000 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].data.contentId, 'plex:100');
  });

  it('finds events where end == start', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: 1000 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
  });

  it('finds events where end ~ start (within 1s)', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:100', start: 1000, end: 1014 } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 1);
  });

  it('skips non-media events', () => {
    const events = [
      { type: 'challenge_start', data: { start: 1000, end: null } },
    ];
    const broken = findBrokenEndEvents(events);
    assert.equal(broken.length, 0);
  });
});

describe('findStaleDurationEvents', () => {
  it('finds events whose contentId is in the fix map', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:10551', durationSeconds: 2 } },
      { type: 'media', data: { contentId: 'plex:99999', durationSeconds: 2 } },
    ];
    const fixMap = { 'plex:10551': { source: 'plex' } };
    const stale = findStaleDurationEvents(events, fixMap);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].data.contentId, 'plex:10551');
  });

  it('returns empty for events not in fix map', () => {
    const events = [
      { type: 'media', data: { contentId: 'plex:99999', durationSeconds: 2 } },
    ];
    const stale = findStaleDurationEvents(events, {});
    assert.equal(stale.length, 0);
  });
});
