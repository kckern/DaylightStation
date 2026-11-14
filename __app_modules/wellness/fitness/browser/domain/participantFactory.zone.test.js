import { describe, it, expect } from 'vitest';
import { fromRosterEntry } from "./ParticipantFactory.js";
import { buildZoneProgressIndex } from "./zoneProgressIndex.js";

const ROSTER_ENTRY = {
  id: 'user_1',
  profileId: 'user_1',
  name: 'test-parent',
  displayLabel: 'Dad',
  hrDeviceId: '10366',
  heartRate: 115,
  zoneId: 'cool',       // committed (hysteresis-smoothed)
  rawZoneId: 'active',  // live
  rawZoneColor: '#51cf66',
  isActive: true,
};

describe('fromRosterEntry zone fields', () => {
  it('carries rawZoneId through to the entity', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).rawZoneId).toBe('active');
  });

  it('normalizes rawZoneId to lowercase', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: 'ACTIVE' }).rawZoneId).toBe('active');
  });

  it('falls back to the committed zone when rawZoneId is absent', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: null }).rawZoneId).toBe('cool');
  });

  it('REGRESSION: resolves zoneProgress by profileId even when displayLabel is a group label', () => {
    const index = buildZoneProgressIndex(
      new Map([['user_1', { name: 'test-parent', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }]])
    );
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBe(0.66);
  });

  it('leaves zoneProgress null when no index is supplied', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).zoneProgress).toBeNull();
  });

  it('leaves zoneProgress null on an index miss rather than coercing to 0', () => {
    const index = buildZoneProgressIndex(new Map([['other', { name: 'Other', progress: 0.5 }]]));
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBeNull();
  });

  it('preserves a real zoneProgress of 0 rather than nulling it', () => {
    const index = buildZoneProgressIndex(
      new Map([['user_1', { name: 'test-parent', progress: 0, profileId: 'user_1' }]])
    );
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBe(0);
  });
});

describe('fromRosterEntry displayZoneId', () => {
  it('carries the display record zone, and the sort ranks by it over the committed zone', async () => {
    const { sortByZoneRank } = await import('./ParticipantFactory.js');
    const index = (id, zoneId, progress) => [id, { name: id, profileId: id, progress, display: { zoneId } }];
    const zpi = buildZoneProgressIndex(new Map([index('a', 'warm', 0.9), index('b', 'hot', 0.1)]));
    // b's committed zone is still warm (the exit margin), a's is hot (pending
    // a downgrade): the cards show b in Hot and a in Warm, so b sorts first.
    const a = fromRosterEntry({ ...ROSTER_ENTRY, id: 'a', profileId: 'a', name: 'a', zoneId: 'hot' }, { zoneProgressIndex: zpi });
    const b = fromRosterEntry({ ...ROSTER_ENTRY, id: 'b', profileId: 'b', name: 'b', zoneId: 'warm' }, { zoneProgressIndex: zpi });
    expect(a.displayZoneId).toBe('warm');
    expect(b.displayZoneId).toBe('hot');
    expect(sortByZoneRank([a, b]).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('is null without a display record', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).displayZoneId).toBeNull();
  });
});

describe('fromRosterEntry rawZoneId fallback chain', () => {
  // Middle rung: the vitals entry's display record (display.zoneId), which
  // FitnessContext's userVitalsMap builds from LIVE HR (lib/displayZone.js),
  // NOT hysteresis-smoothed. Its zoneId is the earned zone and is not a rung.
  const indexWith = ({ zoneId, ...over }) => buildZoneProgressIndex(
    new Map([['user_1', { name: 'test-parent', profileId: 'user_1', progress: 0.4, display: { zoneId }, ...over }]])
  );

  it('engages the vitals zone when rawZoneId is null', () => {
    const p = fromRosterEntry(
      { ...ROSTER_ENTRY, rawZoneId: null },
      { zoneProgressIndex: indexWith({ zoneId: 'warm' }) }
    );
    expect(p.rawZoneId).toBe('warm'); // not the committed 'cool'
  });

  it('prefers the roster rawZoneId over the vitals zone', () => {
    const p = fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: indexWith({ zoneId: 'warm' }) });
    expect(p.rawZoneId).toBe('active');
  });

  it('falls through a garbage rawZoneId to the vitals zone rather than writing it', () => {
    const p = fromRosterEntry(
      { ...ROSTER_ENTRY, rawZoneId: 'bogus-zone' },
      { zoneProgressIndex: indexWith({ zoneId: 'warm' }) }
    );
    expect(p.rawZoneId).toBe('warm');
  });

  it('falls through a garbage vitals zone to the committed zone', () => {
    const p = fromRosterEntry(
      { ...ROSTER_ENTRY, rawZoneId: null },
      { zoneProgressIndex: indexWith({ zoneId: 'nonsense' }) }
    );
    expect(p.rawZoneId).toBe('cool');
  });

  it('normalizes a mixed-case vitals zone', () => {
    const p = fromRosterEntry(
      { ...ROSTER_ENTRY, rawZoneId: null },
      { zoneProgressIndex: indexWith({ zoneId: 'WARM' }) }
    );
    expect(p.rawZoneId).toBe('warm');
  });

  it('GUEST: resolves the vitals zone by profileId even when the TreasureBox lookup missed', () => {
    // A guest misses _buildZoneLookup (entityId-keyed vs profileId-keyed), so the
    // roster emits BOTH zoneId and rawZoneId null. userVitalsMap is keyed by
    // user.id, so the middle rung still resolves them.
    const guest = { ...ROSTER_ENTRY, rawZoneId: null, zoneId: null, isGuest: true };
    const p = fromRosterEntry(guest, { zoneProgressIndex: indexWith({ zoneId: 'hot' }) });
    expect(p.rawZoneId).toBe('hot');
  });

  it('yields null when all three rungs are empty, without crashing', () => {
    const p = fromRosterEntry(
      { ...ROSTER_ENTRY, rawZoneId: null, zoneId: null },
      { zoneProgressIndex: indexWith({ zoneId: null }) }
    );
    expect(p.rawZoneId).toBeNull();
  });

  it('yields null when all three rungs are empty and no index is supplied', () => {
    const p = fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: null, zoneId: null });
    expect(p.rawZoneId).toBeNull();
  });
});
