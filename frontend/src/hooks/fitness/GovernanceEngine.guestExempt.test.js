/**
 * Guests + exempt users are "non-subjects": eligible for challenge credit but
 * never required and never blamed. This task only verifies the subject filter +
 * guestIds capture; the per-method numerator/missingUsers behavior is Tasks 2-4.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

describe('GovernanceEngine — subject filter (guests + exempt)', () => {
  it('captures guestIds from the evaluate payload into _latestInputs', () => {
    const eng = new GovernanceEngine();
    eng._captureLatestInputs({ activeParticipants: ['a', 'g1'], guestIds: ['g1'] });
    expect(eng._latestInputs.guestIds).toEqual(['g1']);
  });

  it('_buildSubjectFilter excludes both guests and exempt, keeps registered', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['Mom'] };
    eng._captureLatestInputs({ activeParticipants: ['user_2', 'mom', 'g1'], guestIds: ['g1'] });
    const isSubject = eng._buildSubjectFilter();
    expect(isSubject('user_2')).toBe(true);  // registered
    expect(isSubject('mom')).toBe(false);   // exempt (by name)
    expect(isSubject('g1')).toBe(false);    // guest (by id)
  });

  it('guestIds defaults to empty when omitted (backward compatible)', () => {
    const eng = new GovernanceEngine();
    eng._captureLatestInputs({ activeParticipants: ['a'] });
    expect(eng._latestInputs.guestIds).toEqual([]);
    expect(eng._buildSubjectFilter()('a')).toBe(true);
  });

  it('_classifyParticipants splits subjects / guests / exempt for diagnostics', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['user_2', 'mom', 'g1'], guestIds: ['g1'] });
    const cls = eng._classifyParticipants(['user_2', 'mom', 'g1']);
    expect(cls.subjects).toEqual(['user_2']);
    expect(cls.guests).toEqual(['g1']);
    expect(cls.exempt).toEqual(['mom']);
  });

  it('requiredCount denominator counts only subjects (drops guests + exempt)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['user_2', 'user_3', 'mom', 'g1'], guestIds: ['g1'] });
    // 'all' over [user_2, user_3, mom(exempt), g1(guest)] = 2 subjects.
    expect(eng._normalizeRequiredCount('all', 4, ['user_2', 'user_3', 'mom', 'g1'])).toBe(2);
    // numeric rule clamps to subject count.
    expect(eng._normalizeRequiredCount(3, 4, ['user_2', 'user_3', 'mom', 'g1'])).toBe(2);
  });

  it('steady-state: a guest in-zone does NOT satisfy and is never missing', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    eng._latestInputs.zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    eng._latestInputs.zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({
      activeParticipants: ['user_2', 'g1'], guestIds: ['g1'],
      zoneRankMap: { cold: 0, warm: 1, hot: 2 },
      zoneInfoMap: { hot: { id: 'hot', name: 'Hot' } },
    });
    // require all in HOT; user_2 is cold (subject, fails), guest is hot.
    const userZoneMap = { user_2: 'cold', g1: 'hot' };
    const res = eng._evaluateZoneRequirement('hot', 'all', ['user_2', 'g1'], userZoneMap,
      eng._latestInputs.zoneRankMap, eng._latestInputs.zoneInfoMap, 2);
    expect(res.satisfied).toBe(false);                 // guest can't satisfy steady-state
    expect(res.missingUsers).toEqual(['user_2']);       // only the subject is blamed
    expect(res.missingUsers).not.toContain('g1');      // guest never blamed
  });

  it('challenge: a guest in-zone counts toward achievement (group tally)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    const zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    const zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({
      activeParticipants: ['user_2', 'g1'], guestIds: ['g1'], zoneRankMap, zoneInfoMap,
    });
    eng._latestInputs.zoneRankMap = zoneRankMap;
    eng._latestInputs.zoneInfoMap = zoneInfoMap;
    // Helper mirrors the challenge numerator semantics via the public evaluator
    // added in Step 3 (evaluateChallengeZone) — see implementation.
    const res = eng.evaluateChallengeZone(
      { zone: 'hot', rule: 2 },
      ['user_2', 'g1'],
      { user_2: 'hot', g1: 'hot' },
      2
    );
    expect(res.satisfied).toBe(true);            // 1 subject + 1 guest meet "2 in hot"
    expect(res.actualCount).toBe(2);             // eligible numerator counts the guest
    expect(res.missingUsers).toEqual([]);        // nobody blamed
  });

  it('challenge: a slacking guest is never blamed', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    const zoneRankMap = { cold: 0, hot: 2 };
    eng._captureLatestInputs({ activeParticipants: ['user_2', 'g1'], guestIds: ['g1'], zoneRankMap });
    eng._latestInputs.zoneRankMap = zoneRankMap;
    const res = eng.evaluateChallengeZone({ zone: 'hot', rule: 1 }, ['user_2', 'g1'], { user_2: 'hot', g1: 'cold' }, 2);
    expect(res.satisfied).toBe(true);            // user_2 (subject) meets required 1
    expect(res.missingUsers).toEqual([]);        // guest cold but NOT blamed
  });
});

/**
 * Anti-freeload: the exemption (and guest non-subject status) is a privilege
 * that only exists while a REAL participant is carrying the session — i.e. at
 * least one active BASELINE subject (registered, non-exempt, non-guest) is
 * present. With no such subject, exemptions are SUSPENDED and every participant
 * is governed as a subject, so an exempt- or guest-only roster cannot satisfy a
 * requirement without actually meeting the zone. Closes the "borrow the exempt
 * kid's HR strap and turn it on alone" loophole.
 */
describe('GovernanceEngine — exemption suspension when no real subject present', () => {
  it('_buildSubjectFilter treats an exempt-only roster as all-subjects', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['mom'], guestIds: [] });
    const isSubject = eng._buildSubjectFilter(['mom']);
    expect(isSubject('mom')).toBe(true); // suspended → exempt user is governed
  });

  it('_buildSubjectFilter treats a guest-only roster as all-subjects', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    eng._captureLatestInputs({ activeParticipants: ['g1'], guestIds: ['g1'] });
    const isSubject = eng._buildSubjectFilter(['g1']);
    expect(isSubject('g1')).toBe(true); // suspended → guest is governed
  });

  it('keeps exemptions ACTIVE when a real subject is present (regression)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['user_2', 'mom', 'g1'], guestIds: ['g1'] });
    const isSubject = eng._buildSubjectFilter(['user_2', 'mom', 'g1']);
    expect(isSubject('user_2')).toBe(true);
    expect(isSubject('mom')).toBe(false);  // still exempt — a real subject is present
    expect(isSubject('g1')).toBe(false);   // still guest
  });

  it('requiredCount no longer collapses to 0 for an exempt/guest-only roster', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['mom', 'g1'], guestIds: ['g1'] });
    // Suspended → both count as subjects → 'all' over 2 = 2 (was 0 → vacuously satisfied).
    expect(eng._normalizeRequiredCount('all', 2, ['mom', 'g1'])).toBe(2);
  });

  it('steady-state: exempt-only roster must meet the zone (loophole closed)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    const zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    const zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({ activeParticipants: ['mom'], guestIds: [], zoneRankMap, zoneInfoMap });
    // Exempt 'mom' alone, cold → cannot vacuously satisfy, and is now blamed.
    const cold = eng._evaluateZoneRequirement('hot', 'all', ['mom'], { mom: 'cold' }, zoneRankMap, zoneInfoMap, 1);
    expect(cold.satisfied).toBe(false);
    expect(cold.missingUsers).toEqual(['mom']);
    // Exempt 'mom' alone, in zone → she is actually working out → satisfies.
    const hot = eng._evaluateZoneRequirement('hot', 'all', ['mom'], { mom: 'hot' }, zoneRankMap, zoneInfoMap, 1);
    expect(hot.satisfied).toBe(true);
  });

  it('_classifyParticipants reports suspended exempt/guests as subjects', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['mom', 'g1'], guestIds: ['g1'] });
    const cls = eng._classifyParticipants(['mom', 'g1']);
    expect([...cls.subjects].sort()).toEqual(['g1', 'mom']);
    expect(cls.guests).toEqual([]);
    expect(cls.exempt).toEqual([]);
  });
});
