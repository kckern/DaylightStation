import { describe, expect, it } from 'vitest';
import { committedZoneId, earnedZoneFields, shownZoneId } from './committedZone.js';

// 2026-11-10: a rider at 132 bpm read "NO ZONE" on the player sidebar until the
// zone store had sustained readings. The card shows the committed zone when
// there is one, else the live reading's zone on the same ladder.
describe('shownZoneId', () => {
  it('shows the committed zone whenever there is one', () => {
    expect(shownZoneId({ committed: 'Warm', heartRate: 132, liveZoneId: 'hot' })).toBe('warm');
  });
  it('shows the live reading\'s zone while the store has not trusted the rider yet', () => {
    expect(shownZoneId({ committed: null, heartRate: 132, liveZoneId: 'Active' })).toBe('active');
  });
  it.each([null, 0, undefined, NaN])('shows nothing without a reading (%s): no zone is invented', (heartRate) => {
    expect(shownZoneId({ committed: null, heartRate, liveZoneId: 'active' })).toBeNull();
  });
  it('shows nothing when a reading has no ladder to read it on', () => {
    expect(shownZoneId({ committed: null, heartRate: 132, liveZoneId: null })).toBeNull();
  });
});
describe('earned-zone consumers', () => {
  it('uses committed state and never raw readings', () => {
    expect(committedZoneId({ zoneId: 'active', rawZoneId: 'fire' })).toBe('active');
    expect(committedZoneId({ rawZoneId: 'fire' })).toBeNull();
  });
  it.each([{ zoneTrusted: false, zoneId: 'fire' }, { currentZoneId: null }, { zoneId: null }])('preserves explicit unavailable earned state %j', (record) => {
    expect(committedZoneId(record, { zoneId: 'hot' })).toBeNull();
  });
});

describe('earnedZoneFields', () => {
  const none = { zoneId: null, zoneName: null, zoneColor: null, zoneTrusted: false };
  it('earns nothing before the store has a profile (startup packets)', () => {
    expect(earnedZoneFields(null)).toEqual(none);
  });
  it('earns nothing while untrusted, even with a zone present', () => {
    expect(earnedZoneFields({ zoneTrusted: false, zoneId: 'hot', zoneColor: 'orange' })).toEqual(none);
  });
  it('publishes the trusted committed zone', () => {
    expect(earnedZoneFields({ zoneTrusted: true, zoneId: 'Warm', zoneName: 'Warm', zoneColor: 'yellow' }))
      .toEqual({ zoneId: 'warm', zoneName: 'Warm', zoneColor: 'yellow', zoneTrusted: true });
  });
});
