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
});
