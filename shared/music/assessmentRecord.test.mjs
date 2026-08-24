import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CRITERIA, reproject, validateAssessment } from './assessmentRecord.mjs';

const completed = (over = {}) => ({ status: 'completed', score: 0.8, ...over });

describe('the old scalar contract still holds', () => {
  it('accepts a plain completed attempt, as every existing writer sends', () => {
    assert.equal(validateAssessment(completed()).valid, true);
  });

  it('still requires a score on a completed attempt and forbids one otherwise', () => {
    assert.equal(validateAssessment({ status: 'completed' }).valid, false);
    assert.equal(validateAssessment({ status: 'aborted' }).valid, true);
    assert.equal(validateAssessment({ status: 'aborted', score: 0.5 }).valid, false);
    assert.equal(validateAssessment({ status: 'nonsense', score: 0.5 }).valid, false);
  });
});

describe('the criterion vector', () => {
  const vector = { completeness: 1, cleanliness: 0.6, placement: 0.85 };

  it('is stored alongside the score, with the rubric that produced it', () => {
    const result = validateAssessment(completed({ criteria: vector, rubric: { id: 'metronome', version: 'v1' } }));
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('is refused without a rubric, because it could never be re-projected', () => {
    const result = validateAssessment(completed({ criteria: vector }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /rubric\.id is required/);
  });

  it('accepts a subset — a free-mode run has no placement, and that absence is information', () => {
    const result = validateAssessment(completed({
      criteria: { completeness: 1, cleanliness: 0.5 },
      rubric: { id: 'free' },
    }));
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('refuses an unknown criterion rather than storing a typo forever', () => {
    const result = validateAssessment(completed({ criteria: { compleetness: 1 }, rubric: { id: 'free' } }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /unknown criterion: compleetness/);
  });

  it('refuses values outside 0-1', () => {
    for (const bad of [1.5, -0.1, 'high', null]) {
      const result = validateAssessment(completed({ criteria: { completeness: bad }, rubric: { id: 'free' } }));
      assert.equal(result.valid, false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  it('refuses a vector on a run that never completed', () => {
    const result = validateAssessment({
      status: 'aborted', criteria: { completeness: 0.4 }, rubric: { id: 'free' },
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /unless the attempt completed/);
  });

  it('knows the vocabulary it will accept', () => {
    assert.deepEqual([...CRITERIA], ['completeness', 'cleanliness', 'placement']);
  });
});

describe('gates', () => {
  it('carry why, not just whether', () => {
    const result = validateAssessment(completed({
      gates: { pace: { passed: false, actual: 92, target: 100 } },
    }));
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('must at least say whether they passed', () => {
    assert.equal(validateAssessment(completed({ gates: { pace: { actual: 92 } } })).valid, false);
    assert.equal(validateAssessment(completed({ gates: { pace: true } })).valid, false);
  });

  it('requires numeric evidence and keeps gates off interrupted attempts', () => {
    assert.equal(validateAssessment(completed({ gates: { pace: { passed: false } } })).valid, false);
    assert.equal(validateAssessment(completed({ gates: { pace: { passed: true, actual: '100', target: 100 } } })).valid, false);
    assert.equal(validateAssessment({ status: 'timeout', gates: { pace: { passed: false, actual: 92, target: 100 } } }).valid, false);
  });
});

describe('diagnostics', () => {
  it('are a bag of numbers, never prose', () => {
    assert.equal(validateAssessment(completed({ diagnostics: { stalls: 2, onset_spread_ms: 45 } })).valid, true);
    assert.equal(validateAssessment(completed({ diagnostics: { note: 'seemed nervous' } })).valid, false);
  });

  it('requires note counts to be non-negative integers and internally consistent', () => {
    const inconsistent = validateAssessment(completed({ diagnostics: {
      expected_notes: 4, matched_notes: 3, missed_notes: 0, wrong_notes: -1,
    } }));
    assert.equal(inconsistent.valid, false);
    assert.match(inconsistent.errors.join(' '), /non-negative integer|must equal matched_notes plus missed_notes/);
  });
});

describe('portable advancement evidence', () => {
  it('accepts an explicit purpose and a verdict tied to the stored score', () => {
    const result = validateAssessment(completed({
      purpose: 'challenge', verdict: { score: 0.8, passed: true },
    }));
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('rejects invented purposes and verdicts that disagree with the score', () => {
    assert.equal(validateAssessment(completed({ purpose: 'homework' })).valid, false);
    assert.equal(validateAssessment(completed({ verdict: { score: 0.7, passed: true } })).valid, false);
    assert.equal(validateAssessment({ status: 'aborted', verdict: { score: 0, passed: false } }).valid, false);
  });
});

describe('part and span evidence', () => {
  it('accepts explainable nested completed evidence', () => {
    const result = validateAssessment(completed({
      score: 0.9,
      criteria: { completeness: 1, cleanliness: 0.8 },
      parts: { rh: { criteria: { completeness: 1, cleanliness: 0.9 }, diagnostics: { expected_notes: 2, wrong_notes: 0 } } },
      spans: { 'measure:1': { criteria: { completeness: 1, cleanliness: 0.8 }, parts: { rh: { criteria: { completeness: 1 } } }, diagnostics: { expected_notes: 2 } } },
      rubric: { id: 'learn-v2', version: '2', weights: { completeness: 1, cleanliness: 1 }, part_weights: { rh: 1 } },
      verdict: { score: 0.9, passed: false, failed_criteria: ['cleanliness'], failed_gates: [] },
    }));
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('rejects scalar, aggregate, and per-part evidence that disagree', () => {
    const result = validateAssessment(completed({
      score: 0.95,
      criteria: { completeness: 0.75, cleanliness: 1 },
      diagnostics: { expected_notes: 4, matched_notes: 4, missed_notes: 0, wrong_notes: 0 },
      parts: {
        rh: { criteria: { completeness: 1, cleanliness: 1 }, diagnostics: { expected_notes: 3, matched_notes: 3, missed_notes: 0, wrong_notes: 0 } },
        lh: { criteria: { completeness: 0, cleanliness: 1 }, diagnostics: { expected_notes: 2, matched_notes: 0, missed_notes: 2, wrong_notes: 0 } },
      },
      rubric: { id: 'inconsistent', weights: { completeness: 1, cleanliness: 1 }, part_weights: { rh: 0.5, lh: 0.5 } },
      verdict: { score: 0.95, passed: false, failed_criteria: [], failed_gates: [] },
    }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /score must equal|part-weighted|sum of part diagnostics/);
  });

  it('rejects malformed nested evidence and unnormalized part weights', () => {
    const result = validateAssessment(completed({
      parts: { rh: { criteria: { completeness: 4 } } },
      rubric: { id: 'bad', part_weights: { rh: 1, lh: 1 } },
      verdict: { score: 0.8, passed: false, failed_criteria: 'cleanliness' },
    }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /part_weights|failed_criteria|completeness/);
  });

  it('rejects unknown failure names when their vocabularies are available', () => {
    const result = validateAssessment(completed({
      criteria: { completeness: 1 },
      gates: { pace: { passed: false, actual: 92, target: 100 } },
      rubric: { id: 'failure-vocabulary' },
      verdict: { score: 0.8, passed: false, failed_criteria: ['cleanlines'], failed_gates: ['speed'] },
    }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /unknown failed criterion|unknown failed gate/);
  });

  it('requires failure arrays to point at stored evidence and agree with passed', () => {
    const missing = validateAssessment(completed({
      verdict: { score: 0.8, passed: false, failed_criteria: ['cleanliness'], failed_gates: ['pace'] },
    }));
    assert.equal(missing.valid, false);
    assert.match(missing.errors.join(' '), /requires recorded criterion evidence|unknown failed gate/);

    const contradictory = validateAssessment(completed({
      criteria: { cleanliness: 0.8 }, rubric: { id: 'contradictory' },
      verdict: { score: 0.8, passed: true, failed_criteria: ['cleanliness'], failed_gates: [] },
    }));
    assert.equal(contradictory.valid, false);
    assert.match(contradictory.errors.join(' '), /passed verdict/);
  });

  it('rejects a rubric whose effective criterion weight is zero', () => {
    const result = validateAssessment(completed({
      criteria: { completeness: 1, cleanliness: 1 },
      rubric: { id: 'zero', weights: { completeness: 0, cleanliness: 0 } },
    }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /positive weight/);
  });
});

describe('re-projection — the reason the vector is kept', () => {
  const vector = { completeness: 1, cleanliness: 0.5, placement: 0.5 };

  it('re-scores a stored run under different weights', () => {
    // The run was judged 0.55*1 + 0.30*0.5 + 0.15*0.5 = 0.775 at the time.
    assert.equal(reproject(vector, { completeness: 0.55, cleanliness: 0.30, placement: 0.15 }).toFixed(3), '0.775');
    // A later rubric that only cares about notes reads the same run as 1.0.
    assert.equal(reproject(vector, { completeness: 1 }), 1);
  });

  it('renormalises over the criteria a record actually carries', () => {
    // A free-mode run has no placement; asking a timed rubric about it must not
    // invent a zero for the criterion that was never measured.
    const free = { completeness: 1, cleanliness: 0.5 };
    const score = reproject(free, { completeness: 0.55, cleanliness: 0.30, placement: 0.15 });
    assert.equal(score.toFixed(3), '0.824', 'weights renormalise over what is present');
    assert.ok(score > reproject({ ...free, placement: 0 }, { completeness: 0.55, cleanliness: 0.30, placement: 0.15 }));
  });

  it('returns null rather than a misleading zero when nothing lines up', () => {
    assert.equal(reproject({ completeness: 1 }, { placement: 1 }), null);
    assert.equal(reproject(null, { completeness: 1 }), null);
    assert.equal(reproject({ completeness: 1 }, null), null);
  });
});
