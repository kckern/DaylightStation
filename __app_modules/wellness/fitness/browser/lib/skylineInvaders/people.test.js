import { describe, expect, it } from 'vitest';
import { listInvadersPeople } from './people.js';

describe('listInvadersPeople', () => {
  it('lists the people in the session first, then the rest of the household, once each', () => {
    const ctx = {
      participantRoster: [{ id: 'kid', name: 'Kid Full Name', displayLabel: 'Kid' }, { id: 'device:99', name: 'Unknown strap' }],
      users: [{ id: 'test-rider', name: 'Test Rider' }, { id: 'kid', name: 'Kid Full Name' }, 'kid'],
      usersConfig: { family: [{ id: 'other', group_label: 'Other' }] },
    };
    expect(listInvadersPeople(ctx)).toEqual([{ id: 'kid', name: 'Kid' }, { id: 'test-rider', name: 'Test Rider' }, { id: 'other', name: 'Other' }]);
  });
  it('falls back to the id for a bare entry and survives a missing context', () => {
    expect(listInvadersPeople({ users: ['kid'] })).toEqual([{ id: 'kid', name: 'kid' }]);
    expect(listInvadersPeople(null)).toEqual([]);
  });
  it('leaves the guest out: a guest has no heart-rate zone, progress or rings', () => {
    expect(listInvadersPeople({ users: [{ id: 'guest', name: 'Guest' }, { id: 'kid', name: 'Kid' }] })).toEqual([{ id: 'kid', name: 'Kid' }]);
  });
});
