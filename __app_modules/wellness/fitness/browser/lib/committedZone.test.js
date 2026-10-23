import { describe, expect, it } from 'vitest';
import { committedZoneId, earnedZoneFields } from './committedZone.js';
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
