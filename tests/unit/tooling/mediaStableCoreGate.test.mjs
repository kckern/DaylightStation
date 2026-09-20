import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_STORIES,
  SUPPORTING_ACCEPTED_CRITERIA,
  validateManifest,
  validateReport,
} from '../../../scripts/media-stable-core-gate.mjs';

describe('media stable-core gate manifest', () => {
  it('accepts 11 fully accepted stories plus the four accepted partial-story criteria', () => {
    expect(validateManifest(ACCEPTED_STORIES, SUPPORTING_ACCEPTED_CRITERIA)).toEqual({
      fullyAcceptedStories: 11,
      acceptedCriteria: 32,
      supportingPartialStories: 1,
    });
  });

  it('rejects a missing accepted story', () => {
    expect(() => validateManifest(ACCEPTED_STORIES.slice(1), SUPPORTING_ACCEPTED_CRITERIA)).toThrow(/missing FIND\.1b/);
  });

  it('rejects a duplicate accepted story', () => {
    expect(() => validateManifest([...ACCEPTED_STORIES, ACCEPTED_STORIES[0]], SUPPORTING_ACCEPTED_CRITERIA)).toThrow(/duplicate FIND\.1b/);
  });

  it('rejects an unknown story or changed criterion count', () => {
    expect(() => validateManifest([
      ...ACCEPTED_STORIES.slice(0, -1),
      { ...ACCEPTED_STORIES.at(-1), story: 'RELY.99z' },
    ], SUPPORTING_ACCEPTED_CRITERIA)).toThrow(/unknown RELY\.99z/);
    expect(() => validateManifest([
      { ...ACCEPTED_STORIES[0], criteria: ['FIND.1b/AC99'] },
      ...ACCEPTED_STORIES.slice(1),
    ], SUPPORTING_ACCEPTED_CRITERIA)).toThrow(/criteria/);
  });

  it('rejects an omitted or duplicated supporting accepted criterion', () => {
    expect(() => validateManifest(ACCEPTED_STORIES, SUPPORTING_ACCEPTED_CRITERIA.slice(1))).toThrow(/missing PLACE\.2a\/AC1/);
    expect(() => validateManifest(ACCEPTED_STORIES, [
      ...SUPPORTING_ACCEPTED_CRITERIA,
      SUPPORTING_ACCEPTED_CRITERIA[0],
    ])).toThrow(/duplicate PLACE\.2a\/AC1/);
  });
});

describe('media stable-core gate report', () => {
  it('accepts selected passing Playwright results', () => {
    expect(validateReport({
      suites: [{ specs: [{ tests: [{ results: [{ status: 'passed' }] }] }] }],
    })).toEqual({ tests: 1 });
  });

  it('rejects skipped selected tests', () => {
    expect(() => validateReport({
      suites: [{ specs: [{ tests: [{ status: 'skipped' }] }] }],
    })).toThrow(/skipped/);
  });

  it('rejects zero, interrupted, and failed selected tests', () => {
    expect(() => validateReport({ suites: [] })).toThrow(/zero tests/);
    expect(() => validateReport({
      suites: [{ specs: [{ tests: [{ results: [{ status: 'interrupted' }] }] }] }],
    })).toThrow(/interrupted/);
    expect(() => validateReport({
      suites: [{ specs: [{ tests: [{ results: [{ status: 'failed' }] }] }] }],
    })).toThrow(/failed/);
  });
});
