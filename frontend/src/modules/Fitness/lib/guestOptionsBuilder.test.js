import { describe, it, expect } from 'vitest';
import { buildGuestOptions } from './guestOptionsBuilder.js';

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
    expect(original).toMatchObject({ id: 'alice', name: 'Alice', source: 'Original' });
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
