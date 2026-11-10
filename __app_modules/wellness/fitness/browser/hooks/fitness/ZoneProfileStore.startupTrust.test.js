import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZoneProfileStore, ZONE_TRUST_RESUME_WINDOW_MS } from './ZoneProfileStore.js';

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
    expect(read(190).currentZoneId).toBe('cool'); // one sample is not a climb
    advance(1000);
    expect(read(191)).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire', zoneEntry: { heartRate: 191, threshold: 190 } });
  });

  it('preserves trust through a brief dropout', () => {
    establishCool(); read(195); advance(1000); read(195);
    expect(read(null)).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire' });
  });
});

// Bug #5, 2026-10-23: Rider C stepped out for a drink at Hot, came back at
// 145-171, and had no zone for 2m13s because a confirmed loss re-imposed the
// startup Cool rule. Same strap, same session, evidence within the hour now
// resumes the zone from the current reading.
describe('ZoneProfileStore resume from recent trusted evidence', () => {
  let store;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); store = new ZoneProfileStore(); });
  afterEach(() => vi.useRealTimers());
  const read = (hr, extra = {}) => {
    store.syncFromUsers([user(hr, { zoneReadingDeviceId: 'strap-c1', zoneReadingAt: Date.now(), ...extra })]);
    return store.getProfile('rider-a');
  };
  // Cool baseline, then a confirmed climb to Hot at 174.
  const trustedAtHot = () => { read(90); advance(6000); read(174); advance(1000); read(174); expect(store.getProfile('rider-a').currentZoneId).toBe('hot'); };
  const loseReading = () => { advance(1000); store.resetZoneState('rider-a', 'confirmed-loss'); };

  it('resumes Hot on the first eligible reading after a confirmed loss (inverts the old Cool rule)', () => {
    trustedAtHot(); loseReading();
    expect(read(null)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    advance(16000);
    const back = read(165);
    expect(back).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
    expect(back.zoneEntry).toMatchObject({ zoneId: 'hot', heartRate: 165, resumed: true });
  });

  it('resumes from the CURRENT reading, so a rider who cooled to Warm resumes Warm', () => {
    trustedAtHot(); loseReading(); advance(20000);
    expect(read(155)).toMatchObject({ zoneTrusted: true, currentZoneId: 'warm' });
  });

  it('does not resume on a spike that happens to be the first packet back', () => {
    trustedAtHot(); loseReading(); advance(16000);
    expect(read(204)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    advance(250);
    expect(read(166)).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
  });

  it('resumes after a long break once two consistent readings agree', () => {
    trustedAtHot(); loseReading(); advance(30 * 60 * 1000);
    expect(read(120).zoneTrusted).toBe(false); // 54 bpm below the evidence: wait
    advance(1000);
    expect(read(121)).toMatchObject({ zoneTrusted: true, currentZoneId: 'active' });
  });

  it('refuses evidence older than the window', () => {
    trustedAtHot(); loseReading(); advance(ZONE_TRUST_RESUME_WINDOW_MS + 1);
    expect(read(170)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    advance(1000);
    expect(read(170)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    expect(read(90)).toMatchObject({ zoneTrusted: true, currentZoneId: 'cool' });
  });

  it('refuses a reading from a different strap', () => {
    trustedAtHot(); loseReading(); advance(10000);
    expect(read(170, { zoneReadingDeviceId: '99999' })).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('refuses after a wearer change and after a session reset', () => {
    trustedAtHot(); store.resetZoneState('rider-a', 'wearer-change'); advance(1000);
    expect(read(170)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    trustedAtHot(); store.clear(); advance(1000);
    expect(read(170)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('keeps evidence through a configuration rebuild', () => {
    trustedAtHot(); store.clear({ preserveTrust: true }); loseReading(); advance(10000);
    expect(read(170)).toMatchObject({ zoneTrusted: true, currentZoneId: 'hot' });
  });

  it('never refreshes evidence from a held spike', () => {
    trustedAtHot();
    advance(1000); read(204); // raw Fire, not committed
    expect(store.getTrustEvidence('rider-a')).toMatchObject({ zoneId: 'hot', heartRate: 174 });
  });

  it('still requires Cool on a first attach with no evidence (stale previous-day Fire)', () => {
    expect(read(187)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    advance(1000);
    expect(read(187)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });
});

describe('ZoneProfileStore wearer and session boundaries', () => {
  let store;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); store = new ZoneProfileStore(); });
  afterEach(() => vi.useRealTimers());
  const read = (hr, extra) => { store.syncFromUsers([user(hr, extra)]); return store.getProfile('rider-a'); };
  const establishCool = () => { read(90); advance(6000); };

  it('clears trust and historical profiles at wearer and session boundaries', () => {
    establishCool(); read(195);
    store.resetZoneState('rider-a', 'wearer-change');
    expect(store.getProfile('rider-a')).toMatchObject({ zoneTrusted: false, currentZoneId: null, zoneEntry: null });
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    establishCool(); read(195); store.clear();
    expect(read(195)).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('keeps trust and the Fire entry through a configuration rebuild', () => {
    establishCool(); read(195); advance(3000);
    const before = read(195);
    expect(before).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire' });
    store.clear({ preserveTrust: true });
    const after = read(195);
    expect(after).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire' });
    expect(after.zoneEntry.id).toBe(before.zoneEntry.id);
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
    sync(90); advance(6000); sync(low); advance(1000); sync(low); // seed a confirmed climb
    advance(1000); sync(high); // rapid upward spike starts pending Fire
    advance(1000); sync(low); // must reset that pending stability clock
    advance(2100);
    const current = sync(high + 1); // another brief spike, not continuous Fire
    expect(current.currentZoneId).toBe(id === 'rider-a' ? 'active' : 'hot');
    expect(sync(low).currentZoneId).not.toBe('fire');
  });
});
