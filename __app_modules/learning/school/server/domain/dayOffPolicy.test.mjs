import { describe, it, expect } from 'vitest';
import { DEFAULT_DAY_OFF_POLICY, readDayOffPolicy, keepsEntry } from './dayOffPolicy.mjs';

const scripture = { subject: 'scripture' };
const piano = { subject: 'arts', program: 'piano-course' };
const math = { subject: 'math' };
const debrief = { subject: 'writing', program: 'school-debrief' };
const holiday = { subject: 'civilization', dateBound: { onDays: ['2026-11-11'] } };

describe('day-off keep-lists', () => {
  it('stay-home keeps scripture, reading, flashcards and piano by default, not worksheets or the debrief', () => {
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', scripture)).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', piano)).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', { subject: 'english', program: 'story-time' })).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', { subject: 'english', program: 'book-log' })).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', { subject: 'language', program: 'flashcards' })).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', { subject: 'language', program: 'sentence-ladder' })).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', math)).toBe(false);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'stay-home', debrief)).toBe(false);
  });

  it('enrichment keeps what stay-home keeps', () => {
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'enrichment', piano)).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'enrichment', math)).toBe(false);
  });

  it('major-holiday keeps scripture and the date-bound special only', () => {
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'major-holiday', scripture)).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'major-holiday', holiday)).toBe(true);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'major-holiday', piano)).toBe(false);
  });

  it('away keeps nothing, not even a date-bound entry', () => {
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'away', scripture)).toBe(false);
    expect(keepsEntry(DEFAULT_DAY_OFF_POLICY, 'away', holiday)).toBe(false);
  });

  it('a configured tier replaces that tier whole; other tiers keep their defaults', () => {
    const { errors, policy } = readDayOffPolicy({ 'stay-home': { keep: [{ subject: 'scripture' }] } });
    expect(errors).toEqual([]);
    expect(keepsEntry(policy, 'stay-home', piano)).toBe(false);
    expect(keepsEntry(policy, 'stay-home', scripture)).toBe(true);
    expect(keepsEntry(policy, 'major-holiday', scripture)).toBe(true);
    expect(keepsEntry(policy, 'enrichment', piano)).toBe(true);
  });

  it('absent config is the defaults', () => {
    expect(readDayOffPolicy(undefined)).toEqual({ errors: [], policy: DEFAULT_DAY_OFF_POLICY });
  });

  it.each([
    ['an unknown tier key', { holiday: { keep: [] } }, /holiday/],
    ['a selector with neither key', { 'stay-home': { keep: [{}] } }, /subject or program/],
    ['a selector with both keys', { 'stay-home': { keep: [{ subject: 'math', program: 'x' }] } }, /subject or program/],
    ['an unknown subject', { 'stay-home': { keep: [{ subject: 'cooking' }] } }, /cooking/],
    ['a keep that is not a list', { 'stay-home': { keep: 'scripture' } }, /list/],
  ])('%s is an error and falls back to the defaults', (_label, raw, message) => {
    const { errors, policy } = readDayOffPolicy(raw);
    expect(errors.join()).toMatch(message);
    expect(policy).toBe(DEFAULT_DAY_OFF_POLICY);
  });
});
