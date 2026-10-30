import { describe, it, expect } from 'vitest';
import { buildGuestOptions, buildGuestCandidates, nextGenericGuestName, zonesMapToArray } from "./guestOptionsBuilder.js";

const friend = (id, name) => ({ id, name, profileId: id, category: 'Friend' });

describe('buildGuestOptions — characterization', () => {
  it('offers generic Guest plus tab-filtered candidates', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve')],
      deviceAssignments: [],
      selectedTab: 'friends'
    });
    expect(out.topOptions.map(o => o.id)).toContain('guest');
    expect(out.filteredOptions.map(o => o.id)).toEqual(['eve']);
  });

  it('shows Original when a guest displaces the base user', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [],
      activeAssignment: { occupantName: 'Eve', metadata: { name: 'Eve', candidateId: 'eve' } },
      baseName: 'Alice',
      baseUserId: 'alice',
      selectedTab: 'friends'
    });
    const original = out.topOptions.find(o => o.isOriginal);
    expect(original).toMatchObject({ id: 'alice', name: 'Alice', source: 'Give back' });
  });

  it('excludes candidates assigned to any device', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve'), friend('dave', 'Dave')],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'eve', profileId: 'eve' }, occupantId: 'eve' }],
      selectedTab: 'friends'
    });
    expect(out.filteredOptions.map(o => o.id)).toEqual(['dave']);
  });

  it('allowWhileAssigned candidates bypass the exclusion', () => {
    const out = buildGuestOptions({
      guestCandidates: [{ ...friend('alice', 'Alice'), allowWhileAssigned: true, category: 'Family' }],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'alice', profileId: 'alice' }, occupantId: 'alice' }],
      selectedTab: 'family'
    });
    expect(out.filteredOptions.map(o => o.id)).toEqual(['alice']);
  });

  it('excludes actively-broadcasting HR participants (Bug 06)', () => {
    const out = buildGuestOptions({
      guestCandidates: [friend('eve', 'Eve')],
      deviceAssignments: [],
      activeHeartRateParticipants: [{ isActive: true, id: 'eve', profileId: 'eve', name: 'Eve' }],
      selectedTab: 'friends'
    });
    expect(out.filteredOptions).toEqual([]);
  });

  it('hides generic Guest on the device where it is currently selected', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [{ deviceId: '111', metadata: { candidateId: 'guest', profileId: 'guest_111' }, occupantId: 'guest_111', occupantName: 'Guest' }],
      activeAssignment: { occupantName: 'Guest', metadata: { name: 'Guest', candidateId: 'guest', profileId: 'guest_111' } },
      selectedTab: 'friends'
    });
    expect(out.topOptions.some(o => o.id === 'guest')).toBe(false);
  });
});

describe('buildGuestOptions — multi-Guest (audit N2)', () => {
  it('still offers generic Guest on device B while device A has a generic Guest', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [{ deviceId: 'A', metadata: { candidateId: 'guest', profileId: 'guest_A' }, occupantId: 'guest_A', occupantName: 'Guest' }],
      activeAssignment: null,
      selectedTab: 'friends'
    });
    expect(out.topOptions.some(o => o.id === 'guest' && o.isGeneric)).toBe(true);
  });
});

describe('nextGenericGuestName (audit N3)', () => {
  const generic = (deviceId, name) => ({
    deviceId, occupantName: name,
    metadata: { candidateId: 'guest', profileId: `guest_${deviceId}`, name }
  });

  it('first guest is plain "Guest"', () => {
    expect(nextGenericGuestName([])).toBe('Guest');
  });
  it('second guest is "Guest 2"', () => {
    expect(nextGenericGuestName([generic('A', 'Guest')])).toBe('Guest 2');
  });
  it('numbers past the highest existing, avoiding collisions', () => {
    expect(nextGenericGuestName([generic('A', 'Guest'), generic('B', 'Guest 2')])).toBe('Guest 3');
    expect(nextGenericGuestName([generic('B', 'Guest 2')])).toBe('Guest 3');
  });
  it('ignores named-guest assignments', () => {
    expect(nextGenericGuestName([{ deviceId: 'A', occupantName: 'Eve', metadata: { candidateId: 'eve' } }])).toBe('Guest');
  });
  it('numbers across adult and kid generics (no collision)', () => {
    const kid = { deviceId: 'A', occupantName: 'Guest', metadata: { candidateId: 'guest-kid', profileId: 'guest_A', name: 'Guest' } };
    expect(nextGenericGuestName([kid])).toBe('Guest 2');
    const adult = { deviceId: 'B', occupantName: 'Guest 2', metadata: { candidateId: 'guest', profileId: 'guest_B', name: 'Guest 2' } };
    expect(nextGenericGuestName([kid, adult])).toBe('Guest 3');
  });
});

describe('Guest (kid) option (audit N4)', () => {
  it('adds a kid generic option when guestProfiles.kid is configured', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [],
      selectedTab: 'friends',
      guestProfiles: { kid: { zones: { active: 95, warm: 130, hot: 155, fire: 175 } } }
    });
    const kid = out.topOptions.find(o => o.id === 'guest-kid');
    expect(kid).toMatchObject({ isGeneric: true, ageClass: 'kid', source: 'Kid' });
    expect(out.topOptions.some(o => o.id === 'guest')).toBe(true);
  });

  it('omits the kid option without config', () => {
    const out = buildGuestOptions({ guestCandidates: [], deviceAssignments: [], selectedTab: 'friends' });
    expect(out.topOptions.some(o => o.id === 'guest-kid')).toBe(false);
  });

  it('kid option stays available across devices like the adult generic (W2)', () => {
    const out = buildGuestOptions({
      guestCandidates: [],
      deviceAssignments: [{ deviceId: 'A', metadata: { candidateId: 'guest-kid', profileId: 'guest_A' }, occupantId: 'guest_A', occupantName: 'Guest' }],
      selectedTab: 'friends',
      guestProfiles: { kid: { zones: { active: 95 } } }
    });
    expect(out.topOptions.some(o => o.id === 'guest-kid')).toBe(true);
  });
});

describe('zonesMapToArray', () => {
  it('converts a users.yml-style zone map to the ledger array shape', () => {
    expect(zonesMapToArray({ active: 95, warm: 130 })).toEqual([
      { id: 'active', min: 95 },
      { id: 'warm', min: 130 }
    ]);
  });
  it('returns null for empty/invalid input', () => {
    expect(zonesMapToArray(null)).toBeNull();
    expect(zonesMapToArray({})).toBeNull();
    expect(zonesMapToArray({ active: 'high' })).toBeNull();
  });
});


// Owner ruling 2026-10-29: a household member must be assignable to any guest
// or unowned strap from the Family picker (a rider whose strap died rode a
// spare strap as a generic Guest and lost the session's credit).
describe('buildGuestCandidates — every primary is offered under Family', () => {
  const usersConfig = {
    primary: [{ id: 'rider_m', name: 'Rider M' }, { id: 'rider_f', name: 'Rider F' }, { id: 'rider_a', name: 'Rider A' }],
    family: [{ id: 'aunt', name: 'Aunt' }],
    friends: [{ id: 'pal', name: 'Pal' }],
  };

  it('tags every primary as a Family candidate, no displacement needed', () => {
    const cands = buildGuestCandidates({ usersConfig, deviceAssignments: [], replacedPrimaryPool: [] });
    const family = cands.filter((c) => c.category === 'Family').map((c) => c.id);
    expect(family).toEqual(expect.arrayContaining(['aunt', 'rider_m', 'rider_f', 'rider_a']));
    expect(cands.find((c) => c.id === 'rider_m')).toMatchObject({ isPrimary: true, source: 'Family', allowWhileAssigned: false });
    expect(cands.filter((c) => c.category === 'Friend').map((c) => c.id)).toEqual(['pal']);
  });

  it('keeps a displaced primary multi-assignable (returnee) and does not duplicate them', () => {
    const cands = buildGuestCandidates({
      usersConfig,
      deviceAssignments: [{ deviceId: '1', occupantName: 'Rider F' }],
      replacedPrimaryPool: [],
    });
    const f = cands.filter((c) => c.id === 'rider_f');
    expect(f).toHaveLength(1);
    expect(f[0].allowWhileAssigned).toBe(true);
  });

  it('offers a primary whose own strap is NOT live onto an unowned strap, and hides live ones', () => {
    const guestCandidates = buildGuestCandidates({ usersConfig });
    const out = buildGuestOptions({
      guestCandidates,
      deviceAssignments: [{ deviceId: '10266', occupantId: 'guest_10266', occupantName: 'Guest', metadata: { candidateId: 'guest', profileId: 'guest_10266' } }],
      activeAssignment: { deviceId: '10266', occupantId: 'guest_10266', occupantName: 'Guest', metadata: { candidateId: 'guest', profileId: 'guest_10266' } },
      // rider_f and rider_a are riding on their own live straps; rider_m's died.
      activeHeartRateParticipants: [
        { id: 'rider_f', name: 'Rider F', isActive: true },
        { id: 'rider_a', name: 'Rider A', isActive: true },
        { id: 'rider_m', name: 'Rider M', isActive: false },
      ],
      baseName: null,
      selectedTab: 'family',
    });
    const ids = out.filteredOptions.map((o) => o.id);
    expect(ids).toContain('rider_m');
    expect(ids).toContain('aunt');
    expect(ids).not.toContain('rider_f');
    expect(ids).not.toContain('rider_a');
    expect(out.filteredOptions.find((o) => o.id === 'rider_m')).toMatchObject({ isPrimary: true, profileId: 'rider_m' });
  });

  it('a primary already riding a borrowed strap is not offered on a second one', () => {
    const guestCandidates = buildGuestCandidates({ usersConfig });
    const out = buildGuestOptions({
      guestCandidates,
      deviceAssignments: [{ deviceId: '10266', occupantId: 'rider_m', occupantName: 'Rider M', metadata: { candidateId: 'rider_m', profileId: 'rider_m' } }],
      activeAssignment: null,
      selectedTab: 'family',
    });
    expect(out.filteredOptions.map((o) => o.id)).not.toContain('rider_m');
  });

  it('warns (never throws) on a primary with no id', () => {
    const warns = [];
    const cands = buildGuestCandidates({ usersConfig: { primary: [{ name: 'No Id' }] }, logger: { warn: (e) => warns.push(e) } });
    expect(cands).toEqual([]);
    expect(warns).toContain('fitness_sidebar.guest_candidate_missing_id');
  });
});
