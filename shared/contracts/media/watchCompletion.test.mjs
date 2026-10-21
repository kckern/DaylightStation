import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_RULE, isWatchComplete, compileWatchCompletion, createWatchCompletionRules,
} from './watchCompletion.mjs';

const FITNESS = {
  default: { min_percent: 90 },
  libraries: {
    'plex/14_fitness': {
      min_watch_sec: 30,
      tiers: [
        { max_duration_sec: 2700, min_percent: 50 },
        { min_percent: 95, max_remaining_sec: 300 },
      ],
    },
  },
};

describe('isWatchComplete', () => {
  it('default rule is movie mode: 90%, no time cap', () => {
    expect(DEFAULT_RULE).toMatchObject({ minPercent: 90, maxRemainingSec: null, minWatchSec: null });
    expect(isWatchComplete({ percent: 90, playhead: 6480, duration: 7200 })).toBe(true);
    expect(isWatchComplete({ percent: 94, playhead: 16429, duration: 17467 })).toBe(true);
    expect(isWatchComplete({ percent: 89, playhead: 160, duration: 180 })).toBe(false);
  });
  it('applies a remaining-time cap when the rule has one', () => {
    const rule = { minPercent: 95, maxRemainingSec: 300, minWatchSec: null };
    expect(isWatchComplete({ percent: 96, playhead: 16768, duration: 17467 }, rule)).toBe(false);
    expect(isWatchComplete({ percent: 99, playhead: 17300, duration: 17467 }, rule)).toBe(true);
  });
  it('skips the cap when duration is unknown', () => {
    const rule = { minPercent: 95, maxRemainingSec: 300, minWatchSec: null };
    expect(isWatchComplete({ percent: 96, playhead: 1000 }, rule)).toBe(true);
  });
  it('refuses a seek-only watch under min_watch_sec, ignores missing watchTime', () => {
    const rule = { minPercent: 50, maxRemainingSec: null, minWatchSec: 30 };
    expect(isWatchComplete({ percent: 90, playhead: 1620, duration: 1800, watchTime: 10 }, rule)).toBe(false);
    expect(isWatchComplete({ percent: 90, playhead: 1620, duration: 1800 }, rule)).toBe(true);
  });
});

describe('compileWatchCompletion', () => {
  it('no config at all: every namespace gets the default rule', () => {
    const { ruleFor, errors } = compileWatchCompletion(undefined);
    expect(errors).toEqual([]);
    expect(ruleFor('plex/6_movies', 7200)).toMatchObject({ minPercent: 90, maxRemainingSec: null, source: 'default' });
  });
  it('unlisted library uses default; listed library picks a tier by duration', () => {
    const { ruleFor } = compileWatchCompletion(FITNESS);
    expect(ruleFor('plex/6_movies', 7200)).toMatchObject({ minPercent: 90, source: 'default' });
    expect(ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 50, maxRemainingSec: null, minWatchSec: 30, source: 'plex/14_fitness', tier: 0 });
    expect(ruleFor('plex/14_fitness', 2700)).toMatchObject({ minPercent: 50, tier: 0 });
    expect(ruleFor('plex/14_fitness', 17467)).toMatchObject({ minPercent: 95, maxRemainingSec: 300, minWatchSec: 30, tier: 1 });
  });
  it('unknown duration picks the last (catch-all) tier', () => {
    const { ruleFor } = compileWatchCompletion(FITNESS);
    expect(ruleFor('plex/14_fitness', 0)).toMatchObject({ tier: 1 });
    expect(ruleFor('plex/14_fitness', undefined)).toMatchObject({ tier: 1 });
  });
  it('Sonic: fitness rule keeps 94% / 17 min left in progress', () => {
    const { ruleFor } = compileWatchCompletion(FITNESS);
    const rule = ruleFor('plex/14_fitness', 17467);
    expect(isWatchComplete({ percent: 94, playhead: 16429, duration: 17467, watchTime: 19111 }, rule)).toBe(false);
  });
  it('drops a bad library entry with an error and keeps the rest', () => {
    const { ruleFor, errors } = compileWatchCompletion({
      libraries: {
        'plex/14_fitness': FITNESS.libraries['plex/14_fitness'],
        'plex/8_tv-shows': { min_percent: 'lots' },
        'plex/7_stage': { tiers: [{ max_duration_sec: 100, min_percent: 50 }] }, // no catch-all
        'plex/5_music': { min_percent: 90, colour: 'red' },                     // unknown key
      },
    });
    expect(errors.map((e) => e.namespace).sort()).toEqual(['plex/5_music', 'plex/7_stage', 'plex/8_tv-shows']);
    expect(errors.every((e) => typeof e.reason === 'string' && e.reason)).toBe(true);
    expect(ruleFor('plex/8_tv-shows', 1800)).toMatchObject({ source: 'default' });
    expect(ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 50 });
  });
  it('a bad default falls back to the coded default with an error', () => {
    const { ruleFor, errors } = compileWatchCompletion({ default: { min_percent: 150 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].namespace).toBe('default');
    expect(ruleFor('x', 100)).toMatchObject({ minPercent: 90 });
  });
  it('min_percent defaults to 90 when omitted', () => {
    const { ruleFor } = compileWatchCompletion({ libraries: { a: { max_remaining_sec: 600 } } });
    expect(ruleFor('a', 7200)).toMatchObject({ minPercent: 90, maxRemainingSec: 600 });
  });
});

describe('createWatchCompletionRules', () => {
  it('re-reads config each call, recompiles only on change, warns once per bad entry', () => {
    let raw = FITNESS;
    const logger = { warn: vi.fn() };
    const rules = createWatchCompletionRules({ readConfig: () => raw, logger });
    expect(rules.ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 50 });
    rules.ruleFor('plex/14_fitness', 1800);
    expect(logger.warn).not.toHaveBeenCalled();
    raw = { libraries: { 'plex/14_fitness': { min_percent: 'x' } } };
    expect(rules.ruleFor('plex/14_fitness', 1800)).toMatchObject({ source: 'default' });
    rules.ruleFor('plex/14_fitness', 1800);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('media.watch_completion.rule_invalid', expect.objectContaining({ namespace: 'plex/14_fitness' }));
  });
  it('a throwing reader degrades to the default rule', () => {
    const rules = createWatchCompletionRules({ readConfig: () => { throw new Error('boom'); } });
    expect(rules.ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 90, source: 'default' });
  });
});

describe('compileWatchCompletion validation', () => {
  const reasonFor = (raw, namespace) => compileWatchCompletion(raw).errors.find((e) => e.namespace === namespace)?.reason;

  it('rejects min_percent of 0 or below (would finish anything started)', () => {
    expect(reasonFor({ libraries: { a: { min_percent: 0 } } }, 'a')).toMatch(/min_percent/);
    expect(reasonFor({ libraries: { a: { min_percent: -5 } } }, 'a')).toMatch(/min_percent/);
    expect(reasonFor({ libraries: { a: { min_percent: 100 } } }, 'a')).toBeUndefined();
  });
  it('accepts only real numbers: numeric strings, arrays and booleans are errors', () => {
    expect(reasonFor({ libraries: { a: { min_percent: '95' } } }, 'a')).toMatch(/min_percent/);
    expect(reasonFor({ libraries: { a: { max_remaining_sec: [300] } } }, 'a')).toMatch(/max_remaining_sec/);
    expect(reasonFor({ libraries: { a: { min_watch_sec: true } } }, 'a')).toMatch(/min_watch_sec/);
    expect(reasonFor({ libraries: { a: { max_remaining_sec: Infinity } } }, 'a')).toMatch(/max_remaining_sec/);
  });
  it('tiers must strictly ascend by max_duration_sec', () => {
    const tiers = (...ts) => ({ libraries: { a: { tiers: ts } } });
    expect(reasonFor(tiers({ max_duration_sec: 3600, min_percent: 50 }, { max_duration_sec: 1800, min_percent: 60 }, { min_percent: 95 }), 'a'))
      .toBe('tiers must ascend by max_duration_sec');
    expect(reasonFor(tiers({ max_duration_sec: 1800, min_percent: 50 }, { max_duration_sec: 1800, min_percent: 60 }, { min_percent: 95 }), 'a'))
      .toBe('tiers must ascend by max_duration_sec');
    expect(reasonFor(tiers({ max_duration_sec: 1800, min_percent: 50 }, { max_duration_sec: 3600, min_percent: 60 }, { min_percent: 95 }), 'a'))
      .toBeUndefined();
  });
  it('a libraries block that is not a mapping is an error, default rule applies', () => {
    for (const libraries of ['plex/14_fitness', [{ min_percent: 50 }]]) {
      const { ruleFor, errors } = compileWatchCompletion({ libraries });
      expect(errors).toEqual([{ namespace: 'libraries', reason: 'must be a mapping' }]);
      expect(ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 90, source: 'default' });
    }
  });
  it('a default that is not a mapping is an error, coded default applies', () => {
    for (const def of ['90%', [90]]) {
      const { ruleFor, errors } = compileWatchCompletion({ default: def });
      expect(errors.map((e) => e.namespace)).toEqual(['default']);
      expect(ruleFor('x', 100)).toMatchObject({ minPercent: 90 });
    }
  });
});

describe('createWatchCompletionRules read failures', () => {
  it('warns read_failed once when the reader starts throwing, again only after it recovers and fails anew', () => {
    let fail = true;
    const logger = { warn: vi.fn() };
    const rules = createWatchCompletionRules({
      readConfig: () => { if (fail) throw new Error('config gone'); return FITNESS; },
      logger,
    });
    rules.ruleFor('plex/14_fitness', 1800);
    rules.ruleFor('plex/14_fitness', 1800);
    rules.ruleFor('plex/14_fitness', 1800);
    const readFailed = () => logger.warn.mock.calls.filter(([event]) => event === 'media.watch_completion.read_failed');
    expect(readFailed()).toEqual([['media.watch_completion.read_failed', { error: 'config gone' }]]);
    fail = false;
    expect(rules.ruleFor('plex/14_fitness', 1800)).toMatchObject({ minPercent: 50 });
    fail = true;
    rules.ruleFor('plex/14_fitness', 1800);
    expect(readFailed()).toHaveLength(2);
  });
});
