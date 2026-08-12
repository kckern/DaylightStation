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
});

describe('diagnostics', () => {
  it('are a bag of numbers, never prose', () => {
    assert.equal(validateAssessment(completed({ diagnostics: { stalls: 2, onset_spread_ms: 45 } })).valid, true);
    assert.equal(validateAssessment(completed({ diagnostics: { note: 'seemed nervous' } })).valid, false);
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
