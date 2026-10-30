/**
 * Review of the 2026-10-29 guest-picker fix: a household member picked from
 * Family onto a guest strap must be HIMSELF end to end — not a guest. He is a
 * governance subject (held to challenges like normal), his roster entry says
 * isGuest:false, and his saved row has no is_guest flag (so he earns his badge).
 * A generic Guest on the same path stays a guest.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../../../../../frontend/src/lib/clientId.js", () => ({ getClientId: () => 'test-client' }));

const { ParticipantRoster } = await import('./ParticipantRoster.js');
const { DeviceManager } = await import('./DeviceManager.js');
const { UserManager } = await import('./UserManager.js');
const { DeviceAssignmentLedger } = await import('./DeviceAssignmentLedger.js');
const { GuestAssignmentService } = await import('./GuestAssignmentService.js');
const { GovernanceEngine } = await import('./GovernanceEngine.js');
const { PersistenceManager } = await import('./PersistenceManager.js');

const ZONES = [{ id: 'cool', min: 0 }, { id: 'active', min: 100 }, { id: 'warm', min: 130 }];

function build() {
  const deviceManager = new DeviceManager();
  const userManager = new UserManager();
  const ledger = new DeviceAssignmentLedger();
  userManager.setAssignmentLedger(ledger);
  userManager.configure({ primary: [{ id: 'rider_m', name: 'Rider M', hr: 'dM' }, { id: 'rider_f', name: 'Rider F', hr: 'dF' }] }, ZONES);
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager, userManager });
  // Session shim: GuestAssignmentService needs userManager; stints are optional.
  const service = new GuestAssignmentService({ session: { userManager }, ledger });
  const broadcast = (deviceId, heartRate) => {
    deviceManager.registerDevice({ id: deviceId, type: 'heart_rate', heartRate, lastSeen: Date.now() });
    userManager.resolveUserForDevice(deviceId)?.updateFromDevice({ type: 'heart_rate', deviceId, heartRate });
  };
  return { roster, userManager, service, broadcast };
}

// The payload FitnessSidebarMenu.handleAssignGuest sends for each option kind.
const memberPick = { name: 'Rider M', profileId: 'rider_m', candidateId: 'rider_m', source: 'Family', occupantType: 'member' };
const guestPick = { name: 'Guest', profileId: 'guest_10266', candidateId: 'guest', source: 'Guest', occupantType: 'guest' };

async function savedParticipants(rosterEntries) {
  const pm = new PersistenceManager({ persistApi: vi.fn() });
  let payload = null;
  pm._persistApi = vi.fn().mockImplementation(async (url, body) => {
    if (url === 'api/v1/fitness/save_session') payload = body?.sessionData;
    return { ok: true };
  });
  const t0 = 1_790_213_728_000;
  const N = 80;
  const series = {};
  const entities = [];
  rosterEntries.forEach((e, i) => {
    series[`user:${e.id}:heart_rate`] = Array(N).fill(140);
    series[`user:${e.id}:zone_id`] = Array(N).fill('warm');
    series[`user:${e.id}:rings_total`] = Array.from({ length: N }, (_, k) => k);
    entities.push({ entityId: `e${i}`, profileId: e.id, name: e.name, deviceId: e.hrDeviceId, startTime: t0, endTime: null, status: 'active', startTick: 0 });
  });
  pm.persistSession({
    sessionId: 'fs_20261029193815', startTime: t0, endTime: t0 + N * 5000, finalized: true,
    roster: rosterEntries, deviceAssignments: [], entities,
    timeline: { timebase: { startTime: t0, intervalMs: 5000, tickCount: N }, series, events: [] },
  }, { force: true });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return payload?.participants;
}

describe('a household member on a borrowed strap is himself, not a guest', () => {
  it('member pick: roster isGuest false, governance subject, saved without is_guest', async () => {
    const { roster, service, broadcast } = build();
    broadcast('dF', 140);
    expect(service.assignGuest('10266', memberPick).ok).toBe(true);
    broadcast('10266', 140);

    const entry = roster.getRoster().find((e) => e.id === 'rider_m');
    expect(entry).toMatchObject({ id: 'rider_m', hrDeviceId: '10266', isGuest: false });

    const state = roster.getActiveParticipantState();
    expect(state.participants).toContain('rider_m');
    expect(state.guestIds).not.toContain('rider_m');

    const eng = new GovernanceEngine();
    eng.config = { exemptions: [], challenge_hold_seconds: 0 };
    eng._captureLatestInputs({ activeParticipants: state.participants, guestIds: state.guestIds, zoneRankMap: { cool: 0, active: 1, warm: 2 } });
    expect(eng._buildSubjectFilter(state.participants)('rider_m')).toBe(true);
    // Held to the challenge like any subject: cold → he is missing.
    const res = eng.evaluateChallengeZone({ zone: 'warm', rule: 'all' }, state.participants, { rider_f: 'warm', rider_m: 'cool' }, 2);
    expect(res.requiredCount).toBe(2);
    expect(res.missingUsers).toContain('rider_m');

    const saved = await savedParticipants([entry]);
    expect(saved.rider_m).toBeTruthy();
    expect(saved.rider_m).not.toHaveProperty('is_guest');
  });

  it('generic Guest pick on the same path stays a guest', async () => {
    const { roster, service, broadcast } = build();
    expect(service.assignGuest('10266', guestPick).ok).toBe(true);
    broadcast('10266', 140);
    const entry = roster.getRoster().find((e) => e.id === 'guest_10266');
    expect(entry).toMatchObject({ isGuest: true });
    expect(roster.getActiveParticipantState().guestIds).toContain('guest_10266');
    const saved = await savedParticipants([entry]);
    expect(saved.guest_10266).toMatchObject({ is_guest: true });
  });
});
