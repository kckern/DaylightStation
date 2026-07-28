/**
 * The adult rule — the one predicate that decides whether a household member may
 * sign off a child's work, approve a print, or change what a child is assigned.
 *
 * It lived as a private method on PrintService, and the lifecycle router had no
 * copy of it at all — which is how a child came to be able to curl their own
 * sign-off. It is pure given a roster and a clock, so it belongs here, stated
 * once, with its FAIL-CLOSED cases pinned: an id that is not on the roster and a
 * profile with no birthyear are both children as far as authority goes.
 */
import { describe, it, expect } from 'vitest';
import { isAdult, ADULT_AGE } from '#domains/school/people.mjs';

const NOW = Date.UTC(2026, 6, 27); // 2026-07-27
const ROSTER = [
  { id: 'dad', name: 'Papa', birthyear: 1984 },
  { id: 'learner-two', name: 'learner-two', birthyear: 2016 },
  { id: 'aunty', name: 'Aunty', birthyear: null },
  { id: 'ghosty', name: 'No Birthyear Key' },
  // Exactly on the boundary: turns 18 during 2026.
  { id: 'eldest', name: 'Eldest', birthyear: 2008 },
];

const adult = (userId, roster = ROSTER) => isAdult({ roster, userId, now: NOW });

describe('isAdult', () => {
  it('is 18', () => {
    expect(ADULT_AGE).toBe(18);
  });

  it('says yes to a grown-up on the roster', () => {
    expect(adult('dad')).toBe(true);
  });

  it('says yes on the year they reach eighteen', () => {
    expect(adult('eldest')).toBe(true);
  });

  it('says no to a child', () => {
    expect(adult('learner-two')).toBe(false);
  });

  it('says no to an id that is not on the roster at all', () => {
    expect(adult('nobody')).toBe(false);
  });

  it('says no when the birthyear is unknown — a missing field must not buy authority', () => {
    expect(adult('aunty')).toBe(false);
    expect(adult('ghosty')).toBe(false);
  });

  it('says no to a missing, blank or non-string id', () => {
    expect(adult(null)).toBe(false);
    expect(adult('')).toBe(false);
    expect(adult(undefined)).toBe(false);
    expect(isAdult({ roster: ROSTER, userId: { id: 'dad' }, now: NOW })).toBe(false);
  });

  it('says no when there is no roster to check against', () => {
    expect(adult('dad', null)).toBe(false);
    expect(adult('dad', [])).toBe(false);
    expect(adult('dad', 'not a roster')).toBe(false);
  });

  it('reads the clock it is given, so authority does not depend on the wall clock', () => {
    // Same roster, a decade earlier: the child is younger, and so is the parent.
    expect(isAdult({ roster: ROSTER, userId: 'eldest', now: Date.UTC(2020, 0, 1) })).toBe(false);
    expect(isAdult({ roster: ROSTER, userId: 'dad', now: Date.UTC(2000, 0, 1) })).toBe(false);
  });

  it('accepts a Date or an ISO string as well as epoch millis', () => {
    expect(isAdult({ roster: ROSTER, userId: 'dad', now: new Date(NOW) })).toBe(true);
    expect(isAdult({ roster: ROSTER, userId: 'dad', now: '2026-07-27T00:00:00.000Z' })).toBe(true);
  });

  it('says no rather than throwing when a roster row is junk', () => {
    expect(isAdult({ roster: [null, 'x', { id: 'dad', birthyear: 'nineteen' }], userId: 'dad', now: NOW }))
      .toBe(false);
  });
});
