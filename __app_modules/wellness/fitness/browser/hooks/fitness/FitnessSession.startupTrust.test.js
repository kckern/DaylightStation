import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { GovernanceEngine } from './GovernanceEngine.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';
import { GuestAssignmentService } from './GuestAssignmentService.js';
import { nextFireToasts, createFireZoneTracker } from '../../player/overlays/fireZoneTracker.js';
import { buildParticipantDisplayMap } from './participantDisplayMap.js';

const zones = [
  { id: 'cool', name: 'Cool', min: 60, rings: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 110, rings: 1, color: 'green' },
  { id: 'warm', name: 'Warm', min: 140, rings: 2, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 160, rings: 3, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 180, rings: 4, color: 'red' }
];
const hr = (deviceId, value) => ({ topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: value } });
function sessionFor(users) {
  const session = new FitnessSession();
  session.userManager.setAssignmentLedger(new DeviceAssignmentLedger());
  session.userManager.configure({ primary: users }, zones);
  session.ensureStarted({ force: true, reason: 'startup-trust-test' });
  session.zoneProfileStore.setBaseZoneConfig(zones);
  session.treasureBox.configure({ zones });
  return session;
}
const advance = ms => vi.setSystemTime(Date.now() + ms);

describe('FitnessSession real accepted Cool baseline', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1700000000000); });
  afterEach(() => vi.useRealTimers());

  // Breaks caught: syncing every present user's already-mutated data during
  // another rider's accepted packet; raw TreasureBox/roster fallback bypass.
  it('keeps Rider One null → 187 → loss untrusted despite another rider packets, then accepts actual Cool', () => {
    const session = sessionFor([
      { id: 'rider-one', name: 'Rider One', hr_device_id: 'f' },
      { id: 'rider-b', name: 'Rider B', hr_device_id: 'm' }
    ]);
    let tracker = createFireZoneTracker();
    const entries = [];
    const observe = () => {
      const result = nextFireToasts(tracker, session.zoneProfiles);
      tracker = result.tracker; entries.push(...result.entries);
    };
    for (let i = 0; i < 4; i++) session.ingestData(hr('m', 90));
    session.ingestData(hr('f', null)); observe();
    session.ingestData(hr('f', 187));
    session.ingestData(hr('m', 90)); observe(); // previously bypassed f's discard
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: false, currentZoneId: null, heartRate: 187 });
    expect(session.getActiveParticipantState().zoneMap['rider-one']).toBeUndefined();
    const engine = new GovernanceEngine(session);
    engine.configure({ governed_labels: ['cardio'], zoneConfig: zones, superusers: ['parent'],
      unattended_policy: { enabled: true, startup_zone: 'hot' },
      policies: { default: { base_requirement: [{ active: 'all' }], challenges: [] } } });
    engine.setMedia({ id: 'workout', type: 'episode', labels: ['cardio'] });
    const state = session.getActiveParticipantState();
    engine.evaluate({ activeParticipants: state.participants, userZoneMap: state.zoneMap, totalCount: state.totalCount });
    expect(engine.phase).toBe('pending');
    expect(engine.requirementSummary.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ zone: 'hot', satisfied: false })
    ]));
    // More high samples pass the packet-count discard, but still cannot earn.
    for (let i = 0; i < 6; i++) { advance(1000); session.ingestData(hr('f', 187)); observe(); }
    expect(session.treasureBox.perUser.get('rider-one')?.highestZone ?? null).toBeNull();
    expect(session.treasureBox.perUser.get('rider-one')?.totalRings ?? 0).toBe(0);
    session.ingestData(hr('f', null)); advance(6000);
    session.ingestData(hr('f', null)); session.ingestData(hr('m', 90)); observe();
    expect(session.getZoneProfile('rider-one').zoneTrusted).toBe(false);
    expect(entries).toEqual([]);
    for (let i = 0; i < 3; i++) { session.ingestData(hr('f', 90)); session.ingestData(hr('m', 90)); }
    expect(session.getZoneProfile('rider-one').zoneTrusted).toBe(false); // discarded Cool is not baseline
    session.ingestData(hr('f', 90)); observe();
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: true, currentZoneId: 'cool' });
    advance(6000); session.ingestData(hr('f', 181)); observe();
    expect(session.getZoneProfile('rider-one').currentZoneId).toBe('fire');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: 'rider-one', heartRate: 181, fireThreshold: 180 });
  });

  it('preserves a trusted same-wearer climb after one null packet', () => {
    const session = sessionFor([{ id: 'rider-one', name: 'Rider One', hr_device_id: 'f' }]);
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    advance(6000); session.ingestData(hr('f', 181));
    session.ingestData(hr('f', null)); advance(2000); session.ingestData(hr('f', 181));
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: true, currentZoneId: 'fire' });
    advance(6000); session.ingestData(hr('f', null));
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    for (let i = 0; i < 5; i++) session.ingestData(hr('f', 181));
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('requires the new wearer to establish Cool instead of inheriting the old Fire', () => {
    const session = sessionFor([{ id: 'rider-one', name: 'Rider One', hr_device_id: 'f' }, { id: 'rider-a', name: 'Rider A' }]);
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    advance(6000); session.ingestData(hr('f', 181));
    expect(session.getZoneProfile('rider-one').zoneTrusted).toBe(true);
    const svc = new GuestAssignmentService({ session, ledger: session.userManager.assignmentLedger });
    expect(svc.assignGuest('f', { name: 'Rider A', profileId: 'rider-a' }).ok).toBe(true);
    for (let i = 0; i < 5; i++) session.ingestData(hr('f', 187));
    expect(session.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    expect(session.getZoneProfile('rider-a')).toMatchObject({ zoneTrusted: true, currentZoneId: 'cool' });
  });

  it('clears the prior wearer interval before the successor establishes Cool', () => {
    const session = sessionFor([{ id: 'rider-one', name: 'Rider One', hr_device_id: 'f' }, { id: 'rider-a', name: 'Rider A' }]);
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    advance(6000); session.ingestData(hr('f', 181)); session.ingestData(hr('f', 181));
    expect(session.treasureBox.perUser.get('rider-one').highestZone.id).toBe('fire');
    const svc = new GuestAssignmentService({ session, ledger: session.userManager.assignmentLedger });
    expect(svc.assignGuest('f', { name: 'Rider A', profileId: 'rider-a' }).ok).toBe(true);
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    expect(session.getZoneProfile('rider-a').zoneTrusted).toBe(true);
    expect(session.treasureBox.perUser.get('rider-a').highestZone.id).toBe('cool');
  });

  it('requires a new accepted baseline after session reset with the same rider and HR', () => {
    const users = [{ id: 'rider-one', name: 'Rider One', hr_device_id: 'f' }];
    const session = sessionFor(users);
    for (let i = 0; i < 4; i++) session.ingestData(hr('f', 90));
    advance(6000); session.ingestData(hr('f', 181));
    expect(session.getZoneProfile('rider-one').zoneTrusted).toBe(true);
    session.reset();
    expect(session.getZoneProfile('rider-one')).toBeNull();
    session.userManager.configure({ primary: users }, zones);
    session.ensureStarted({ force: true, reason: 'startup-trust-next-session' });
    session.zoneProfileStore.setBaseZoneConfig(zones);
    session.treasureBox.configure({ zones });
    for (let i = 0; i < 5; i++) session.ingestData(hr('f', 181));
    expect(session.getZoneProfile('rider-one')).toMatchObject({ zoneTrusted: false, currentZoneId: null });
  });

  it('keeps explicit untrusted profiles blank through display fallback', () => {
    const map = buildParticipantDisplayMap(
      [{ id: 'rider-one', name: 'Rider One', zoneTrusted: false, currentZoneId: null, heartRate: 187 }],
      [{ id: 'rider-one', name: 'Rider One', zoneId: 'fire', zoneColor: 'red', heartRate: 187 }]
    );
    expect(map.get('rider-one')).toMatchObject({ zoneId: null, zoneColor: null, heartRate: 187 });
  });
});
