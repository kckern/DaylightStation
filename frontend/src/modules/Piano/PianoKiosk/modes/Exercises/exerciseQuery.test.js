import { describe, expect, it } from 'vitest';
import { buildSearchPath, describeInstance, groupByLevel, levelBandLabel, matchesExerciseSearch, noteName } from './exerciseQuery.js';
import { DEFAULT_FILTERS, LEVEL_BANDS, bandFor } from './filters.js';

describe('search query', () => {
  it('asks for everything by default, without pretend filters', () => {
    const path = buildSearchPath(DEFAULT_FILTERS);
    expect(path).toContain('mode=free');
    // A full-range band narrows nothing and should not appear as a filter.
    expect(path).not.toContain('level_min');
    expect(path).not.toContain('level_max');
  });

  it('sends only the bounds that narrow', () => {
    expect(buildSearchPath({ levelMin: 3, levelMax: 10 })).toContain('level_min=3');
    expect(buildSearchPath({ levelMin: 3, levelMax: 10 })).not.toContain('level_max');
    expect(buildSearchPath({ levelMin: 1, levelMax: 4 })).toContain('level_max=4');
  });

  it('carries the discrete filters', () => {
    const path = buildSearchPath({ collection: 'triads', form: 'chord', hands: 'both', tags: ['pop', 'harmony'] });
    expect(path).toContain('collection=triads');
    expect(path).toContain('form=chord');
    expect(path).toContain('hands=both');
    expect(path).toContain('tags=pop%2Charmony');
  });

  it('pages', () => {
    expect(buildSearchPath({}, { limit: 20, offset: 40 })).toContain('limit=20');
    expect(buildSearchPath({}, { limit: 20, offset: 40 })).toContain('offset=40');
    expect(buildSearchPath({}, { limit: 20 })).not.toContain('offset');
  });
});

describe('exercise card search', () => {
  const seed = { title: 'Hanon Exercise No. 1', subtitle: 'Five-finger position', focus: 'Finger independence', form: 'figure', category: 'drills/hanon', tags: ['technique'] };

  it('matches multiple terms across visible exercise fields', () => {
    expect(matchesExerciseSearch(seed, 'hanon independence')).toBe(true);
    expect(matchesExerciseSearch(seed, 'five finger')).toBe(true);
  });

  it('ignores case and treats a blank query as everything', () => {
    expect(matchesExerciseSearch(seed, 'TECHNIQUE')).toBe(true);
    expect(matchesExerciseSearch(seed, '  ')).toBe(true);
  });

  it('rejects a seed when any search term is absent', () => {
    expect(matchesExerciseSearch(seed, 'hanon blues')).toBe(false);
  });
});

describe('level bands', () => {
  it('names every band it offers', () => {
    for (const band of LEVEL_BANDS) {
      expect(band.label).toBeTruthy();
      expect(band.min).toBeLessThanOrEqual(band.max);
    }
  });

  it('covers the whole scale with no gaps between bands', () => {
    const named = LEVEL_BANDS.filter((b) => b.id !== 'any').sort((a, b) => a.min - b.min);
    expect(named[0].min).toBe(1);
    expect(named.at(-1).max).toBe(10);
    for (let i = 1; i < named.length; i += 1) {
      expect(named[i].min).toBe(named[i - 1].max + 1);
    }
  });

  it('round-trips a band from its bounds', () => {
    expect(bandFor(1, 2).id).toBe('starting');
    expect(bandFor(2, 7)).toBe(null);
  });

  it('describes a band in words', () => {
    expect(levelBandLabel(1, 10)).toBe('Any level');
    expect(levelBandLabel(3, 3)).toBe('Level 3');
    expect(levelBandLabel(3, 4)).toBe('Level 3–4');
  });
});

describe('grouping and description', () => {
  const instance = (id, level, axes = {}) => ({ id, axes, level: { free: level }, title: 'Triads' });

  it('groups by level, ascending, ignoring items with no level for the mode', () => {
    const groups = groupByLevel([
      instance('a', 3), instance('b', 1), instance('c', 3), { id: 'd', level: { cued: 2 }, axes: {} },
    ], 'free');
    expect(groups.map((g) => g.level)).toEqual([1, 3]);
    expect(groups[1].items).toHaveLength(2);
  });

  it('describes an instance by its axes, not its shared title', () => {
    expect(describeInstance(instance('x', 3, { root: 'D', quality: 'minor', inversion: '1st' })))
      .toBe('D · minor · 1st inv');
    // Root position and ascending are the defaults and add nothing.
    expect(describeInstance(instance('x', 3, { root: 'C', quality: 'major', inversion: 'root', direction: 'up' })))
      .toBe('C · major');
    expect(describeInstance(instance('x', 3, {}))).toBe('Triads', 'falls back to the title');
  });

  it('names a pitch for single-note instances', () => {
    expect(describeInstance(instance('x', 1, { pitch: 60 }))).toBe('C4');
    expect(noteName(61)).toBe('C♯4');
    expect(noteName(NaN)).toBe('');
  });
});
