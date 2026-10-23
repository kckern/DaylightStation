import { describe, expect, it } from 'vitest';
import { committedZoneId } from './committedZone.js';
describe('earned-zone consumers', () => {
  it('uses committed state and never raw readings', () => {
    expect(committedZoneId({ zoneId: 'active', rawZoneId: 'fire' })).toBe('active');
    expect(committedZoneId({ rawZoneId: 'fire' })).toBeNull();
  });
  it.each([{ zoneTrusted: false, zoneId: 'fire' }, { currentZoneId: null }, { zoneId: null }])('preserves explicit unavailable earned state %j', (record) => {
    expect(committedZoneId(record, { zoneId: 'hot' })).toBeNull();
  });
});
