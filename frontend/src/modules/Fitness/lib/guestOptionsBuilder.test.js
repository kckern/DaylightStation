import { describe, it, expect } from 'vitest';
import { buildGuestOptions, nextGenericGuestName } from './guestOptionsBuilder.js';

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
});
