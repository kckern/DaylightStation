/**
 * 2026-11-10: the player sidebar showed "NO ZONE" for a rider at 132 bpm until
 * the zone store trusted him. The roster's raw zone is what the card falls back
 * to, so it must be the store's own read of the current heart rate on the
 * committed ladder (displayZoneId) — the same thresholds the committed zone
 * will settle to — not only the TreasureBox baseline (which has no entry for a
 * rider the box has not started tracking).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock("../../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../../../../../../frontend/src/lib/clientId.js", () => ({ getClientId: () => 'test-client' }));

const { ParticipantRoster } = await import('./ParticipantRoster.js');
const { DeviceManager } = await import('./DeviceManager.js');
const { UserManager } = await import('./UserManager.js');
const { ZoneProfileStore } = await import('./ZoneProfileStore.js');

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 150, color: 'orange' },
];

function build() {
  const zoneProfileStore = new ZoneProfileStore();
  zoneProfileStore.setBaseZoneConfig(ZONES);
  const roster = new ParticipantRoster();
  roster.configure({ deviceManager: new DeviceManager(), userManager: new UserManager(), zoneProfileStore });
  return { roster, zoneProfileStore };
}

describe('ParticipantRoster raw zone from the zone store', () => {
  it('reads the raw zone off the store before the rider is trusted; the committed zone stays null', () => {
    const { roster, zoneProfileStore } = build();
    // First reading is Warm: no Cool baseline yet, so the store does not trust it.
    zoneProfileStore.syncFromUsers([{ id: 'rider-a', name: 'Rider A', zoneConfig: ZONES, currentData: { heartRate: 132 } }]);
    expect(zoneProfileStore.getZoneState('rider-a')).toMatchObject({ zoneTrusted: false, zoneId: null, displayZoneId: 'warm' });

    const entry = roster._buildZoneLookup().get('rider-a');
    expect(entry).toMatchObject({ zoneId: null, color: null, rawZoneId: 'warm', rawZoneColor: 'yellow' });
  });

  it('keeps the committed zone once trusted, with the raw zone tracking the live reading', () => {
    const { roster, zoneProfileStore } = build();
    const read = (heartRate) => zoneProfileStore.syncFromUsers([{ id: 'rider-a', name: 'Rider A', zoneConfig: ZONES, currentData: { heartRate } }]);
    read(90); // a real Cool: trusted from here
    read(132); // one sample is not a climb: committed stays Cool, raw reads Warm
    const entry = roster._buildZoneLookup().get('rider-a');
    expect(entry).toMatchObject({ zoneId: 'cool', rawZoneId: 'warm' });
  });

  it('has no raw zone without a reading', () => {
    const { roster, zoneProfileStore } = build();
    zoneProfileStore.syncFromUsers([{ id: 'rider-a', name: 'Rider A', zoneConfig: ZONES, currentData: { heartRate: null } }]);
    const entry = roster._buildZoneLookup().get('rider-a');
    expect(entry.zoneId).toBeNull();
    expect(entry.rawZoneId ?? null).toBeNull();
  });
});
