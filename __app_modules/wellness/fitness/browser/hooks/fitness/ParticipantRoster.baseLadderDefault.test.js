/**
 * Session fs_20261106173151: a household member rode a spare, unassigned strap
 * (roster `device:10266`, "#10266", HR 125). He had no zone at all —
 * `fitness.zone_progress.lookup_miss` every few seconds — so he could not help
 * the group's zone challenges. Owner ruling 2026-11-06: a live reading with no
 * zone profile of its own gets the household base ladder. Such a rider is a
 * non-subject: he can HELP satisfy a group challenge, he is never required and
 * never blamed (never a lock).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../../../../../frontend/src/lib/clientId.js", () => ({ getClientId: () => 'test-client' }));

const { ParticipantRoster } = await import('./ParticipantRoster.js');
const { DeviceManager } = await import('./DeviceManager.js');
const { UserManager } = await import('./UserManager.js');
const { ZoneProfileStore } = await import('./ZoneProfileStore.js');
const { GovernanceEngine } = await import('./GovernanceEngine.js');
const ParticipantFactory = await import('../../domain/ParticipantFactory.js');
const { buildZoneProgressIndex } = await import('../../domain/zoneProgressIndex.js');

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 150, color: 'orange' },
];
const RANKS = { cool: 0, active: 1, warm: 2, hot: 3 };

function build() {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const zoneProfileStore = new ZoneProfileStore();
  zoneProfileStore.setBaseZoneConfig(ZONES);
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager, zoneProfileStore });
  const strap = (id, heartRate) => deviceManager.registerDevice({ id, type: 'heart_rate', heartRate, lastSeen: Date.now() });
  return { roster, strap };
}

function engineFor(state) {
  const eng = new GovernanceEngine();
  eng.config = { exemptions: [], challenge_hold_seconds: 0 };
  eng._captureLatestInputs({ activeParticipants: state.participants, guestIds: state.guestIds, zoneRankMap: RANKS });
  return eng;
}

describe('base-ladder default for a live strap with no zone profile', () => {
  it('an unassigned strap with HR gets base-ladder zone + progress (no lookup miss)', () => {
    const { roster, strap } = build();
    strap('10266', 125);
    const entry = roster.getRoster().find((e) => e.id === 'device:10266');
    expect(entry).toMatchObject({ isGuest: true, heartRate: 125, zoneId: 'warm' });

    const [participant] = ParticipantFactory.fromRoster([entry], {
      zoneConfig: ZONES,
      zoneProgressIndex: buildZoneProgressIndex(new Map()) // no vitals entry for a device
    });
    expect(participant.zoneId).toBe('warm');
    expect(participant.zoneProgress).not.toBeNull();
    expect(participant.zoneProgress).toBeCloseTo((125 - 120) / (150 - 120), 5);

    const state = roster.getActiveParticipantState();
    expect(state.zoneMap['device:10266']).toBe('warm');
    expect(state.guestIds).toContain('device:10266');
  });

  it('no reading → no invented zone', () => {
    const { roster, strap } = build();
    strap('10266', null);
    const entry = roster.getRoster().find((e) => e.id === 'device:10266');
    expect(entry?.zoneId ?? null).toBeNull();
  });

  it('helps satisfy an "N riders in warm" challenge', () => {
    const state = {
      participants: ['rider_m', 'rider_f', 'device:10266'],
      guestIds: ['device:10266'],
    };
    const eng = engineFor(state);
    const zoneMap = { rider_m: 'warm', rider_f: 'cool', 'device:10266': 'warm' };
    const res = eng.evaluateChallengeZone({ zone: 'warm', rule: 2 }, state.participants, zoneMap, 3);
    expect(res.requiredCount).toBe(2);
    expect(res.metUsers).toEqual(expect.arrayContaining(['rider_m', 'device:10266']));
    expect(res.satisfied).toBe(true);
    expect(res.missingUsers).toEqual(['rider_f']);
  });

  it('is never a missing/failing subject — challenge or steady state', () => {
    const state = {
      participants: ['rider_m', 'device:10266'],
      guestIds: ['device:10266'],
    };
    const eng = engineFor(state);
    const zoneMap = { rider_m: 'warm', 'device:10266': 'cool' };

    const challenge = eng.evaluateChallengeZone({ zone: 'warm', rule: 'all' }, state.participants, zoneMap, 2);
    expect(challenge.requiredCount).toBe(1);
    expect(challenge.satisfied).toBe(true);
    expect(challenge.missingUsers).not.toContain('device:10266');

    const steady = eng._evaluateZoneRequirement('warm', 'all', state.participants, zoneMap, RANKS, {}, 2);
    expect(steady.satisfied).toBe(true);
    expect(steady.missingUsers).not.toContain('device:10266');
  });

  it('end to end: roster state from a live unassigned strap feeds the challenge', () => {
    const { roster, strap } = build();
    strap('10266', 130); // warm on the base ladder
    const state = roster.getActiveParticipantState();
    const eng = engineFor(state);
    const res = eng.evaluateChallengeZone({ zone: 'warm', rule: 1 }, state.participants, state.zoneMap, state.totalCount);
    expect(res.metUsers).toContain('device:10266');
    expect(res.satisfied).toBe(true);
    expect(res.missingUsers).toEqual([]);
  });
});
