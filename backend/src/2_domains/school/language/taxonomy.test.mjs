import { describe, it, expect } from 'vitest';
import { taxonomyFor } from './taxonomy.mjs';

describe('taxonomyFor', () => {
  it('maps a study day to the language curriculum hierarchy', () => {
    expect(taxonomyFor({ corpus: { id: 'glossika-korean', label: 'Glossika Korean' }, day: 11, unitSize: 10 }))
      .toEqual({ subject: 'language', course: 'Glossika Korean', unit: 'Unit 2', lesson: 'Day 11' });
  });

  it('uses safe defaults for malformed authored values', () => {
    expect(taxonomyFor({ corpus: { id: 'korean' }, day: 0, unitSize: 0 }))
      .toEqual({ subject: 'language', course: 'korean', unit: 'Unit 1', lesson: 'Day 1' });
  });
});
