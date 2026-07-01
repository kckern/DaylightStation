import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgression } from './harmonicSignature.mjs';
import { minimalCycle } from './harmonicSignature.mjs';

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
