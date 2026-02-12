import { describe, it, expect } from '@jest/globals';
import { CANONICAL_FIELDS } from '#adapters/persistence/yaml/mediaProgressSchema.mjs';

describe('mediaProgressSchema — bookmark support', () => {
  it('includes bookmark in canonical fields', () => {
    expect(CANONICAL_FIELDS).toContain('bookmark');
  });
});
