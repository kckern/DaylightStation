import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgression } from './harmonicSignature.mjs';
import { minimalCycle } from './harmonicSignature.mjs';
import { signatureKey, areStackable } from './harmonicSignature.mjs';

describe('normalizeProgression', () => {
  it('collapses consecutive duplicate chords (rate-independent)', () => {
    assert.deepEqual(normalizeProgression(['II', 'II', 'VI', 'V']), ['II', 'VI', 'V']);
  });
  it('collapses a doubled realization to the same shape', () => {
    assert.deepEqual(normalizeProgression(['II', 'II', 'VI', 'VI', 'V', 'V']), ['II', 'VI', 'V']);
  });
  it('preserves a genuine repeat that is not adjacent', () => {
    assert.deepEqual(normalizeProgression(['I', 'V', 'I', 'IV']), ['I', 'V', 'I', 'IV']);
  });
  it('returns [] for empty/nullish input', () => {
    assert.deepEqual(normalizeProgression(null), []);
    assert.deepEqual(normalizeProgression([]), []);
  });
});

describe('minimalCycle', () => {
  it('reduces a whole-cycle repeat to one cycle', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'I', 'V']), ['I', 'V']);
    assert.deepEqual(minimalCycle(['ii', 'V', 'I', 'ii', 'V', 'I']), ['ii', 'V', 'I']);
  });
  it('leaves a non-repeating progression untouched', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'vi', 'IV']), ['I', 'V', 'vi', 'IV']);
  });
  it('does not reduce a partial/incomplete repeat', () => {
    assert.deepEqual(minimalCycle(['I', 'V', 'I']), ['I', 'V', 'I']);
  });
});

describe('signatureKey', () => {
  it('is equal for the same harmony realized at different rates/lengths', () => {
    const threeBar = signatureKey(['ii', 'VI', 'V']);
    const sixBar = signatureKey(['ii', 'ii', 'VI', 'VI', 'V', 'V']);
    const twoCycles = signatureKey(['ii', 'VI', 'V', 'ii', 'VI', 'V']);
    assert.equal(threeBar, sixBar);
    assert.equal(threeBar, twoCycles);
  });
  it('differs for different progressions', () => {
    assert.notEqual(signatureKey(['I', 'V', 'vi', 'IV']), signatureKey(['ii', 'V', 'I']));
  });
  it('is null for no harmonic content', () => {
    assert.equal(signatureKey(null), null);
    assert.equal(signatureKey([]), null);
  });
});

describe('areStackable', () => {
  it('true when signatures match', () => {
    assert.equal(areStackable(['I', 'V'], ['I', 'I', 'V', 'V']), true);
  });
  it('false when signatures differ', () => {
    assert.equal(areStackable(['I', 'V', 'vi', 'IV'], ['ii', 'V', 'I']), false);
  });
  it('true when the candidate has no harmony (melodic wildcard conforms)', () => {
    assert.equal(areStackable(['I', 'V', 'vi', 'IV'], null), true);
  });
});
