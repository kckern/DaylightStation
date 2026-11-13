import { describe, expect, it } from 'vitest';
import { gateLearnerIds, listInvadersPeople, listSessionRiderIds } from './people.js';

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

describe('listSessionRiderIds', () => {
  it('is the roster plus the mat rider, without guests or bare devices', () => {
    const ctx = { participantRoster: [{ id: 'kid' }, { profileId: 'guest' }, { id: 'device:123' }, { name: 'Kid', id: 'kid' }] };
    expect(listSessionRiderIds(ctx, { riderId: 'test-rider' })).toEqual(['test-rider', 'kid']);
    expect(listSessionRiderIds({}, null)).toEqual([]);
  });

  it('puts the mat person first and bike riders last: Invaders is played standing', () => {
    const ctx = { participantRoster: [{ id: 'cyclist' }, { id: 'stander' }, { id: 'mat-kid' }] };
    expect(listSessionRiderIds(ctx, { riderId: 'mat-kid' }, ['cyclist'])).toEqual(['mat-kid', 'stander', 'cyclist']);
    expect(listSessionRiderIds(ctx, null, ['cyclist', 'guest'])).toEqual(['stander', 'mat-kid', 'cyclist']);
  });
});

describe('gateLearnerIds', () => {
  const learnerOf = (id) => ({ kid: true, 'test-rider': false })[id];
  it('gates a riding learner even when a grown-up is the shooter', () => {
    expect(gateLearnerIds({ shooterId: 'test-rider', riderIds: ['kid', 'test-rider'], learnerOf })).toEqual(['kid']);
  });
  it('gates the shooter unless known not to be a learner; a rider only when known to be one', () => {
    expect(gateLearnerIds({ shooterId: 'someone', riderIds: ['unknown-strap'], learnerOf })).toEqual(['someone']);
    expect(gateLearnerIds({ shooterId: 'test-rider', riderIds: ['test-rider'], learnerOf })).toEqual([]);
  });
});
