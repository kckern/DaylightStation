import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_STORIES,
  SUPPORTING_ACCEPTED_CRITERIA,
  validateReport,
} from '../../../scripts/media-stable-core-gate.mjs';
import { validateP0Manifest } from '../../../scripts/media-p0-gate.mjs';

const BASE = [...ACCEPTED_STORIES, ...SUPPORTING_ACCEPTED_CRITERIA];

describe('Media P0 gate manifest', () => {
  it('retains every deployed stable-core criterion', () => {
    expect(validateP0Manifest(BASE)).toEqual({ stories: 12, criteria: 32 });
    expect(() => validateP0Manifest([])).toThrow(/missing FIND\.1b\/AC1/);
  });

  it('allows criteria to be added while preserving the stable core', () => {
    expect(validateP0Manifest([
      ...BASE,
      { story: 'FIND.1a', criteria: ['FIND.1a/AC1'], file: 'media-app-search-entry.runtime.test.mjs', grep: 'FIND.1a' },
    ])).toEqual({ stories: 13, criteria: 33 });
  });

  it('rejects skipped, duplicated, weakened, or unjourneyed criteria', () => {
    expect(() => validateP0Manifest([...BASE, BASE[0]])).toThrow(/duplicate/);
    expect(() => validateP0Manifest(BASE.slice(1))).toThrow(/missing FIND\.1b\/AC1/);
    expect(() => validateP0Manifest([
      { ...BASE[0], file: 'different-journey.runtime.test.mjs' },
      ...BASE.slice(1),
    ])).toThrow(/invalid journey for FIND\.1b\/AC1/);
    expect(() => validateP0Manifest([
      ...BASE.slice(0, -1),
      { ...BASE.at(-1), criteria: ['PLACE.2a/AC99'] },
    ])).toThrow(/missing PLACE\.2a\/AC5/);
    expect(() => validateP0Manifest([
      ...BASE,
      { story: 'FIND.1a', criteria: ['FIND.1a/AC1'] },
    ])).toThrow(/journey/);
  });

  it('rejects skipped Playwright evidence', () => {
    expect(() => validateReport({ suites: [{ specs: [{ tests: [{ status: 'skipped' }] }] }] }))
      .toThrow(/skipped/);
  });
});
