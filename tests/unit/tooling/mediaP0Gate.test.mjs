import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_STORIES,
  SUPPORTING_ACCEPTED_CRITERIA,
  validateReport,
} from '../../../scripts/media-stable-core-gate.mjs';
import { P0_EXTENSION_ENTRIES, validateP0Manifest } from '../../../scripts/media-p0-gate.mjs';

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

  it('pins every P0 extension criterion to its exact authoritative journey', () => {
    expect(P0_EXTENSION_ENTRIES).toEqual(expect.arrayContaining([
      expect.objectContaining({ story: 'PLACE.8a', criteria: ['PLACE.8a/AC1'] }),
      expect.objectContaining({ story: 'STEER.1a', criteria: ['STEER.1a/AC2', 'STEER.1a/AC3'] }),
      expect.objectContaining({ story: 'STEER.6a', criteria: ['STEER.6a/AC3'] }),
      expect.objectContaining({ story: 'RELY.4a', criteria: ['RELY.4a/AC1', 'RELY.4a/AC2'] }),
      expect.objectContaining({ story: 'PLAY.6a', criteria: ['PLAY.6a/AC3'] }),
      expect.objectContaining({ story: 'FIND.3a', criteria: ['FIND.3a/AC3'] }),
      expect.objectContaining({ story: 'FIND.4a', criteria: ['FIND.4a/AC2'] }),
      expect.objectContaining({ story: 'FIND.5a', criteria: ['FIND.5a/AC2'] }),
      expect.objectContaining({ story: 'FIND.5a', criteria: ['FIND.5a/AC3'] }),
      expect.objectContaining({ story: 'FIND.5a', criteria: ['FIND.5a/AC4'] }),
      expect.objectContaining({ story: 'FIND.6a', criteria: ['FIND.6a/AC1', 'FIND.6a/AC2', 'FIND.6a/AC3'] }),
      expect.objectContaining({ story: 'HOUSE.2a', criteria: ['HOUSE.2a/AC3'] }),
      expect.objectContaining({ story: 'HOUSE.3a', criteria: ['HOUSE.3a/AC1', 'HOUSE.3a/AC3'] }),
      expect.objectContaining({ story: 'HOUSE.4a', criteria: ['HOUSE.4a/AC2', 'HOUSE.4a/AC4'] }),
      expect.objectContaining({ story: 'AUTO.3a', criteria: ['AUTO.3a/AC1'] }),
      expect.objectContaining({ story: 'AUTO.3a', criteria: ['AUTO.3a/AC2'] }),
      // Task 7 (outcomes, retry, paused restore, Start fresh).
      expect.objectContaining({ story: 'RELY.3a', criteria: ['RELY.3a/AC1', 'RELY.3a/AC2', 'RELY.3a/AC3', 'RELY.3a/AC4'], file: 'media-app-outcomes.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.6a', criteria: ['RELY.6a/AC1'], file: 'media-app-outcomes.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.2a', criteria: ['RELY.2a/AC2'], file: 'media-app-outcomes.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.5a', criteria: ['RELY.5a/AC1', 'RELY.5a/AC2', 'RELY.5a/AC3'], file: 'media-app-local-failure.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.7a', criteria: ['RELY.7a/AC1', 'RELY.7a/AC5'], file: 'media-app-resume.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.7a', criteria: ['RELY.7a/AC2'], file: 'media-app-aim-journey.runtime.test.mjs', grep: 'a closed app restores' }),
      expect.objectContaining({ story: 'RELY.8a', criteria: ['RELY.8a/AC1', 'RELY.8a/AC2', 'RELY.8a/AC3'], file: 'media-app-reset-confirm.runtime.test.mjs' }),
      // Batch A (start page + item surfaces).
      expect.objectContaining({ story: 'FIND.7a', criteria: ['FIND.7a/AC1', 'FIND.7a/AC2'], file: 'media-app-household-home.runtime.test.mjs' }),
      expect.objectContaining({ story: 'FIND.9a', criteria: ['FIND.9a/AC1', 'FIND.9a/AC2', 'FIND.9a/AC3'], file: 'media-app-household-home.runtime.test.mjs' }),
      expect.objectContaining({ story: 'FIND.10a', criteria: ['FIND.10a/AC1', 'FIND.10a/AC2', 'FIND.10a/AC4', 'FIND.10a/AC6'], file: 'media-app-household-home.runtime.test.mjs' }),
      expect.objectContaining({ story: 'FIND.10a', criteria: ['FIND.10a/AC3'], grep: 'Now on another screen' }),
      expect.objectContaining({ story: 'FIND.11a', criteria: ['FIND.11a/AC1', 'FIND.11a/AC3'], grep: 'Played earlier' }),
      expect.objectContaining({ story: 'FIND.12a', criteria: ['FIND.12a/AC1', 'FIND.12a/AC2'] }),
      expect.objectContaining({ story: 'FIND.12b', criteria: ['FIND.12b/AC1', 'FIND.12b/AC2'] }),
      expect.objectContaining({ story: 'FIND.13a', criteria: ['FIND.13a/AC1', 'FIND.13a/AC3'] }),
      expect.objectContaining({ story: 'PLAY.4a', criteria: ['PLAY.4a/AC1', 'PLAY.4a/AC2', 'PLAY.4a/AC3'], grep: 'saved spots and Start over' }),
    ]));
    expect(P0_EXTENSION_ENTRIES).toHaveLength(32);
    expect(validateP0Manifest([...BASE, ...P0_EXTENSION_ENTRIES])).toEqual({ stories: 39, criteria: 90 });
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
