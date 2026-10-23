import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoneProfileStore } from './ZoneProfileStore.js';

const zones = [
  { id: 'cool', min: 60 }, { id: 'active', min: 110 },
  { id: 'warm', min: 135 }, { id: 'hot', min: 160 }, { id: 'fire', min: 190 }
];
const user = (heartRate, extra = {}) => ({ id: 'rider-a', name: 'Rider A', zoneConfig: zones, currentData: { heartRate }, ...extra });
const advance = (ms) => vi.setSystemTime(Date.now() + ms);

// Breaks caught: deriving earned Cool from HR 0; bypassing acceptance during
// another rider's sync; replaying stateful profiles instead of advancing time.
describe('ZoneProfileStore accepted baseline and stateful transitions', () => {
  let store;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); store = new ZoneProfileStore(); });
  afterEach(() => vi.useRealTimers());
  const read = (hr, extra) => { store.syncFromUsers([user(hr, extra)]); return store.getProfile('rider-a'); };
  const establishCool = () => { read(90); advance(6000); };

  it.each([null, 0, undefined])('does not count synthetic Cool (%s) as a baseline for initial Fire', (hr) => {
    expect(read(hr)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null, heartRate: 195, displayZoneId: 'fire' });
  });

  it('accepts only a real eligible Cool before climbing', () => {
    expect(read(90, { zoneReadingEligible: false }).zoneTrusted).toBe(false);
    expect(read(195).currentZoneId).toBeNull();
    expect(read(90)).toMatchObject({ zoneTrusted: true, currentZoneId: 'cool' });
    advance(6000);
    expect(read(190)).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire', zoneEntry: { heartRate: 190, threshold: 190 } });
  });

  it('preserves trust through a brief dropout but requires Cool after confirmed loss', () => {
    establishCool(); read(195); advance(1000);
    expect(read(null)).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire' });
    store.resetZoneState('rider-a', 'confirmed-loss');
    expect(read(null)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(read(90)).toMatchObject({ zoneTrusted: true, currentZoneId: 'cool' });
  });

  it('clears trust and historical profiles at wearer and session boundaries', () => {
    establishCool(); read(195);
    store.resetZoneState('rider-a', 'wearer-change');
    expect(store.getProfile('rider-a')).toMatchObject({ zoneTrusted: false, currentZoneId: null, zoneEntry: null });
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    establishCool(); read(195); store.clear();
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('commits a steady repeated reading when its hysteresis stability expires', () => {
    establishCool(); read(115); advance(1000); read(195);
    advance(3000);
    expect(read(195).currentZoneId).toBe('fire');
  });

  it.each([
    { id: 'rider-a', low: 115, high: 190, fire: 190 },
    { id: 'rider-b', low: 169, high: 185, fire: 185 }
  ])('repeated below-Fire readings interrupt a pending spike for $id', ({ id, low, high, fire }) => {
    const personal = id === 'rider-b' ? { cool: 80, active: 120, warm: 140, hot: 165, fire: 185 } : { cool: 70, active: 110, warm: 135, hot: 160, fire: 190 };
    const ladder = zones.map(z => ({ ...z, min: personal[z.id] }));
    const sync = (hr) => { store.syncFromUsers([{ ...user(hr), id, zoneConfig: ladder }]); return store.getProfile(id); };
    sync(90); advance(6000); sync(low); sync(low); // seed repeated input
    advance(1000); sync(high); // rapid upward spike starts pending Fire
    advance(1000); sync(low); // must reset that pending stability clock
    advance(2100);
    const current = sync(high + 1); // another brief spike, not continuous Fire
    expect(current.currentZoneId).toBe(id === 'rider-a' ? 'active' : 'hot');
    expect(sync(low).currentZoneId).not.toBe('fire');
  });
});
