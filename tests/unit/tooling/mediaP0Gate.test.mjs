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
      // Batch B (handle and controls, P1).
      expect.objectContaining({ story: 'PLAY.10a', criteria: ['PLAY.10a/AC1'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.10a', criteria: ['PLAY.10a/AC2'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.13a', criteria: ['STEER.13a/AC1', 'STEER.13a/AC2'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.13a', criteria: ['STEER.13a/AC3'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.13b', criteria: ['STEER.13b/AC1'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.13b', criteria: ['STEER.13b/AC2'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.4b', criteria: ['RELY.4b/AC1', 'RELY.4b/AC2', 'RELY.4b/AC3'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.1b', criteria: ['STEER.1b/AC5'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.1b', criteria: ['STEER.1b/AC7'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLACE.9a', criteria: ['PLACE.9a/AC1', 'PLACE.9a/AC2', 'PLACE.9a/AC3'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLACE.4a', criteria: ['PLACE.4a/AC1', 'PLACE.4a/AC2', 'PLACE.4a/AC3', 'PLACE.4a/AC4', 'PLACE.4a/AC5', 'PLACE.4a/AC7'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.10a', criteria: ['STEER.10a/AC1', 'STEER.10a/AC3'], file: 'media-app-handle-controls.runtime.test.mjs' }),
      // Batch D, player features (P2).
      expect.objectContaining({ story: 'STEER.12a', criteria: ['STEER.12a/AC1', 'STEER.12a/AC2', 'STEER.12a/AC3'], file: 'media-app-player-features.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.8a', criteria: ['PLAY.8a/AC1', 'PLAY.8a/AC2', 'PLAY.8a/AC3'], file: 'media-app-player-features.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.8b', criteria: ['PLAY.8b/AC1', 'PLAY.8b/AC2'], file: 'media-app-player-features.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.9a', criteria: ['PLAY.9a/AC1', 'PLAY.9a/AC2', 'PLAY.9a/AC3'], file: 'media-app-player-features.runtime.test.mjs' }),
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
      // Media P1/P2 batch C (house view, naming, admin, routines).
      expect.objectContaining({ story: 'HOUSE.2a', criteria: ['HOUSE.2a/AC5', 'HOUSE.2a/AC6'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'HOUSE.5a', criteria: ['HOUSE.5a/AC1'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.10a', criteria: ['PLAY.10a/AC3', 'PLAY.10a/AC4'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.11a', criteria: ['STEER.11a/AC1', 'STEER.11a/AC2'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.14a', criteria: ['RELY.14a/AC1', 'RELY.14a/AC2'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'HOUSE.4a', criteria: ['HOUSE.4a/AC3'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'HOUSE.6a', criteria: ['HOUSE.6a/AC1', 'HOUSE.6a/AC2', 'HOUSE.6a/AC3'], file: 'media-app-house-view.runtime.test.mjs' }),
      expect.objectContaining({ story: 'AUTO.4a', criteria: ['AUTO.4a/AC1', 'AUTO.4a/AC2'], file: 'media-app-house-view.runtime.test.mjs' }),
      // Task 8 (accessibility and size parity).
      expect.objectContaining({ story: 'RELY.11a', criteria: ['RELY.11a/AC1'], file: 'media-app-p0-accessibility.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.11a', criteria: ['RELY.11a/AC2', 'RELY.11a/AC3'], file: 'media-app-p0-accessibility.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.12a', criteria: ['RELY.12a/AC1', 'RELY.12a/AC2'], file: 'media-app-p0-accessibility.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.13a', criteria: ['RELY.13a/AC2'], file: 'media-app-p0-accessibility.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.14a', criteria: ['RELY.14a/AC3'], file: 'media-app-p0-accessibility.runtime.test.mjs' }),
      // Phase 2a (proof gaps): P0 product features.
      expect.objectContaining({ story: 'STEER.4a', criteria: ['STEER.4a/AC3'], file: 'media-app-p0-features-live.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLACE.6a', criteria: ['PLACE.6a/AC2'], file: 'media-app-p0-features-send.runtime.test.mjs' }),
      expect.objectContaining({ story: 'HOUSE.2a', criteria: ['HOUSE.2a/AC2', 'HOUSE.2a/AC4'], file: 'media-app-p0-features-send.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLACE.7a', criteria: ['PLACE.7a/AC1', 'PLACE.7a/AC2'], file: 'media-app-p0-features-send.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLACE.7a', criteria: ['PLACE.7a/AC4'], file: 'media-app-p0-features-send.runtime.test.mjs' }),
      expect.objectContaining({ story: 'FIND.8b', criteria: ['FIND.8b/AC2'], file: 'media-app-p0-features-find.runtime.test.mjs' }),
      expect.objectContaining({ story: 'FIND.8b', criteria: ['FIND.8b/AC3'], file: 'media-app-p0-features-find.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.1a', criteria: ['PLAY.1a/AC5'], file: 'media-app-p0-features-find.runtime.test.mjs' }),
      expect.objectContaining({ story: 'PLAY.5a', criteria: ['PLAY.5a/AC3'], file: 'media-app-p0-features-find.runtime.test.mjs' }),
      expect.objectContaining({ story: 'STEER.1a', criteria: ['STEER.1a/AC4'], file: 'media-app-p0-features-steer.runtime.test.mjs' }),
      expect.objectContaining({ story: 'RELY.5a', criteria: ['RELY.5a/AC4'], file: 'media-app-p0-features-steer.runtime.test.mjs' }),
      // Phase 3 (batch D): nine P1/P2 criteria in one journey file.
      ...['HOUSE.4a/AC1', 'HOUSE.5a/AC2', 'HOUSE.6a/AC4', 'PLACE.4a/AC6', 'RELY.4a/AC3', 'STEER.10a/AC2', 'STEER.11a/AC3', 'STEER.13b/AC3', 'AUTO.4a/AC3']
        .map((criterion) => expect.objectContaining({ story: criterion.split('/')[0], criteria: [criterion], file: 'media-app-gaps-d-proof.runtime.test.mjs' })),
    ]));
    expect(P0_EXTENSION_ENTRIES).toHaveLength(138);
    expect(validateP0Manifest([...BASE, ...P0_EXTENSION_ENTRIES])).toEqual({ stories: 81, criteria: 267 });
  });

  it('Phase 2b journeys: a known gap (a test.fail that pins a product defect) is never part of a manifest grep', () => {
    const phase2b = P0_EXTENSION_ENTRIES.filter(({ file }) => /-proof\.runtime\.test\.mjs$|media-app-routines/.test(file));
    expect(phase2b.length).toBeGreaterThan(30);
    for (const { grep, file } of phase2b) {
      expect(new RegExp(grep).test('[X.1a/AC1] anything (known gap)'), `${file} grep must not select a known-gap test`).toBe(false);
    }
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
