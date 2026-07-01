import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgression } from './harmonicSignature.mjs';

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
