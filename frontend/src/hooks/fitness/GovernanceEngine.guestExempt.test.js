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
    eng._captureLatestInputs({ activeParticipants: ['felix', 'mom', 'g1'], guestIds: ['g1'] });
    const isSubject = eng._buildSubjectFilter();
    expect(isSubject('felix')).toBe(true);  // registered
    expect(isSubject('mom')).toBe(false);   // exempt (by name)
    expect(isSubject('g1')).toBe(false);    // guest (by id)
  });

  it('guestIds defaults to empty when omitted (backward compatible)', () => {
    const eng = new GovernanceEngine();
    eng._captureLatestInputs({ activeParticipants: ['a'] });
    expect(eng._latestInputs.guestIds).toEqual([]);
    expect(eng._buildSubjectFilter()('a')).toBe(true);
  });

  it('requiredCount denominator counts only subjects (drops guests + exempt)', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: ['mom'] };
    eng._captureLatestInputs({ activeParticipants: ['felix', 'milo', 'mom', 'g1'], guestIds: ['g1'] });
    // 'all' over [felix, milo, mom(exempt), g1(guest)] = 2 subjects.
    expect(eng._normalizeRequiredCount('all', 4, ['felix', 'milo', 'mom', 'g1'])).toBe(2);
    // numeric rule clamps to subject count.
    expect(eng._normalizeRequiredCount(3, 4, ['felix', 'milo', 'mom', 'g1'])).toBe(2);
  });

  it('steady-state: a guest in-zone does NOT satisfy and is never missing', () => {
    const eng = new GovernanceEngine();
    eng.config = { exemptions: [] };
    eng._latestInputs.zoneRankMap = { cold: 0, warm: 1, hot: 2 };
    eng._latestInputs.zoneInfoMap = { hot: { id: 'hot', name: 'Hot' } };
    eng._captureLatestInputs({
      activeParticipants: ['felix', 'g1'], guestIds: ['g1'],
      zoneRankMap: { cold: 0, warm: 1, hot: 2 },
      zoneInfoMap: { hot: { id: 'hot', name: 'Hot' } },
    });
    // require all in HOT; felix is cold (subject, fails), guest is hot.
    const userZoneMap = { felix: 'cold', g1: 'hot' };
    const res = eng._evaluateZoneRequirement('hot', 'all', ['felix', 'g1'], userZoneMap,
      eng._latestInputs.zoneRankMap, eng._latestInputs.zoneInfoMap, 2);
    expect(res.satisfied).toBe(false);                 // guest can't satisfy steady-state
    expect(res.missingUsers).toEqual(['felix']);       // only the subject is blamed
    expect(res.missingUsers).not.toContain('g1');      // guest never blamed
  });
});
