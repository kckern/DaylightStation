import { describe, it, expect } from 'vitest';
import {
  unreachablePrograms, entryActionIsReachable, declaredEntryActions,
} from '#domains/school/reachability.mjs';

const storyTime = { programId: 'story-time', entryAction: 'reading-session' };
const pianoCourse = { programId: 'piano-course', entryAction: null };

describe('unreachablePrograms', () => {
  it('reports a program whose entry action nothing declares', () => {
    // The 2026-08-26 signature exactly: story-time assigned, no source in the
    // house declaring `reading-session`.
    expect(unreachablePrograms({
      programs: [storyTime], declaredActions: new Set(['print-agenda']),
    })).toEqual([{ programId: 'story-time', entryAction: 'reading-session' }]);
  });

  it('reports nothing when some source declares the action', () => {
    expect(unreachablePrograms({
      programs: [storyTime], declaredActions: new Set(['print-agenda', 'reading-session']),
    })).toEqual([]);
  });

  it('ignores a program that is not started by a tap at all', () => {
    // No entryAction is not a missing entryAction — a Portal course is opened
    // from the panel and has no reader to configure.
    expect(unreachablePrograms({
      programs: [pianoCourse], declaredActions: new Set([]),
    })).toEqual([]);
  });

  it('treats an empty declared set as a confident "nothing is declared"', () => {
    expect(unreachablePrograms({ programs: [storyTime], declaredActions: new Set() }))
      .toHaveLength(1);
  });

  it('FAILS TOWARD REPORTING when the config could not be read', () => {
    // null is "I could not tell", which is not "a reader is configured". The
    // same rule the deploy gate fails closed on.
    expect(unreachablePrograms({ programs: [storyTime], declaredActions: null }))
      .toHaveLength(1);
  });

  it('accepts an array as readily as a Set', () => {
    expect(unreachablePrograms({ programs: [storyTime], declaredActions: ['reading-session'] }))
      .toEqual([]);
  });

  it('treats a blank entry action as no entry action, not as a declared one', () => {
    // An empty string in YAML reads as "declared but unset"; it must never
    // satisfy the check by matching another blank.
    expect(unreachablePrograms({
      programs: [{ programId: 'x', entryAction: '   ' }], declaredActions: new Set(),
    })).toEqual([]);
  });

  it('handles no programs and malformed input without throwing', () => {
    expect(unreachablePrograms()).toEqual([]);
    expect(unreachablePrograms({ programs: null, declaredActions: new Set() })).toEqual([]);
  });
});

describe('entryActionIsReachable', () => {
  it('is the single-program form of the same question', () => {
    expect(entryActionIsReachable({ entryAction: 'reading-session', declaredActions: ['reading-session'] })).toBe(true);
    expect(entryActionIsReachable({ entryAction: 'reading-session', declaredActions: [] })).toBe(false);
    expect(entryActionIsReachable({ entryAction: null, declaredActions: [] })).toBe(true);
  });
});

describe('declaredEntryActions', () => {
  it('collects every declared action across sources', () => {
    expect(declaredEntryActions({
      livingroom: { learner_action: 'reading-session' },
      schoolroom: { learner_action: 'print-agenda' },
      hallway: {},
    })).toEqual(new Set(['reading-session', 'print-agenda']));
  });

  it('returns null — not an empty set — when there is nothing readable', () => {
    // An empty set would read as a confident "nothing is declared" and let the
    // unreadable case masquerade as a legitimate answer.
    expect(declaredEntryActions(null)).toBeNull();
    expect(declaredEntryActions(undefined)).toBeNull();
  });

  it('returns an empty set for a config that is readable but declares none', () => {
    expect(declaredEntryActions({ hallway: {} })).toEqual(new Set());
  });

  it('ignores blank declarations', () => {
    expect(declaredEntryActions({ a: { learner_action: '' }, b: { learner_action: '  ' } }))
      .toEqual(new Set());
  });
});
