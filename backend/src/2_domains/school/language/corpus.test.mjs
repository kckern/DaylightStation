import { describe, it, expect } from 'vitest';
import { validateCorpus } from './corpus.mjs';

const corpus = (extra = {}) => ({
  id: 'sample-language',
  label: 'Sample Language',
  languages: { source: 'EN', target: 'KR' },
  sentences: [
    { seq: 1, text: { EN: 'one', KR: 'hana' } },
    { seq: 2, text: { EN: 'two', KR: 'dul' } },
  ],
  ...extra,
});

describe('corpus bands', () => {
  it('validates and normalizes named sequence bands', () => {
    const result = validateCorpus(corpus({
      bands: [{ id: 'fluency-1', label: 'Fluency 1', range: [1, 2] }],
    }));
    expect(result.ok).toBe(true);
    expect(result.corpus.bands).toEqual([
      { id: 'fluency-1', label: 'Fluency 1', range: [1, 2] },
    ]);
  });

  it('defaults to an empty band list', () => {
    expect(validateCorpus(corpus()).corpus.bands).toEqual([]);
  });

  it('rejects duplicate, malformed, and out-of-range bands', () => {
    for (const bands of [
      [{ id: 'same', range: [1, 1] }, { id: 'same', range: [2, 2] }],
      [{ id: 'Not_A_Band', range: [1, 1] }],
      [{ id: 'tail', range: [2, 3] }],
      [{ id: 'tail', range: [2, 1] }],
    ]) {
      expect(validateCorpus(corpus({ bands })).ok).toBe(false);
    }
  });

  it('rejects the question-bank term at the language corpus boundary', () => {
    const result = validateCorpus(corpus({ banks: [{ id: 'legacy', range: [1, 2] }] }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('banks is not supported for language corpora; use bands');
  });
});
