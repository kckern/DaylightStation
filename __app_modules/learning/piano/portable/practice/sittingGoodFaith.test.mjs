import { describe, it, expect } from 'vitest';
import {
  GOOD_FAITH_LEVELS, GOOD_FAITH_LEVEL_VALUES, goodFaithQuestion, goodFaithFromAnswer,
  sittingGoodFaithState, normaliseGoodFaithState, fallbackCredited, MEANINGFUL_NOTES, STATE_LIMITS,
} from './sittingGoodFaith.mjs';

// A child playing a C-major phrase every 20 s for 5 minutes.
const phrase = (t0) => [60, 62, 64, 65, 67].map((note, i) => ({ t: t0 + i * 400, note, velocity: 60 + i, durMs: 300 }));
const playing = (n = 15, start = 1_000_000) => Array.from({ length: n }, (_, k) => phrase(start + k * 20000)).flat();

describe('the good-faith question', () => {
  it('is a score question on a six-step ladder from nobody-there to locked-in', () => {
    const q = goodFaithQuestion(false);
    expect(q.type).toBe('score');
    expect(q.levels).toEqual(GOOD_FAITH_LEVELS);
    expect(GOOD_FAITH_LEVELS).toHaveLength(6);
    expect(GOOD_FAITH_LEVELS.length).toBeLessThanOrEqual(10); // decision gateway cap
    expect(GOOD_FAITH_LEVELS[0]).toMatch(/presence check-ins/);
    expect(GOOD_FAITH_LEVELS[5]).toMatch(/Locked in/);
    expect(GOOD_FAITH_LEVEL_VALUES).toEqual([0, 2, 4, 7, 9, 10]);
  });
  it('the preschool wording says any deliberate key pressing counts', () => {
    expect(goodFaithQuestion(true).instructions).toMatch(/small child/);
    expect(goodFaithQuestion(true).instructions).not.toBe(goodFaithQuestion(false).instructions);
  });
});

describe('goodFaithFromAnswer', () => {
  it('is the probability-weighted level value, one decimal', () => {
    expect(goodFaithFromAnswer({ score: 3, probabilities: [0, 0, 0, 1, 0, 0] })).toBe(7);
    expect(goodFaithFromAnswer({ score: 0, probabilities: [1, 0, 0, 0, 0, 0] })).toBe(0);
    expect(goodFaithFromAnswer({ score: 4.5, probabilities: [0, 0, 0, 0, 0.5, 0.5] })).toBe(9.5);
  });
  it('without probabilities, interpolates the level values at the fractional index', () => {
    expect(goodFaithFromAnswer({ score: 3.5 })).toBe(8);
    expect(goodFaithFromAnswer({ score: 5 })).toBe(10);
  });
  it('null for an unusable answer', () => {
    expect(goodFaithFromAnswer(null)).toBeNull();
    expect(goodFaithFromAnswer({ score: 'x' })).toBeNull();
  });
});

describe('sittingGoodFaithState', () => {
  const start = 1_000_000;
  it('keeps practice-like notes as compact rows relative to the sitting start, plus plain facts', () => {
    const s = sittingGoodFaithState({
      events: playing(3, start + 5000), startMs: start, lessonSec: 600, watchedSec: 560,
      checkIns: [{ atMs: 200000, scales: 0, answered: true }], preschool: false,
    });
    expect(s.notes[0]).toEqual({ pitch: 60, onsetMs: 5000, durMs: 300, velocity: 60 });
    expect(s.notes).toHaveLength(15);
    expect(s.lesson).toMatchObject({ lengthMin: 10, watchedMin: 9.3, preschool: false, notesPlayed: 15, notesShown: 15, notesSetAsideAsNoise: 0 });
    expect(s.presence).toEqual({ checkIns: 1, answered: 1, log: [{ atMin: 3.3, asked: 'note', answered: true }] });
    expect(s.perMinute).toHaveLength(10);
    expect(Object.keys(s).sort()).toEqual(['lesson', 'notes', 'perMinute', 'presence']);
  });
  it('sets mashing aside before the model sees it', () => {
    const fists = Array.from({ length: 30 }, (_, k) => [0, 1, 2, 3, 4, 5, 6, 7].map((d) => ({ t: start + k * 300 + d, note: 48 + d, velocity: 100 }))).flat();
    const s = sittingGoodFaithState({ events: fists, startMs: start, lessonSec: 300, watchedSec: 300 });
    expect(s.notes).toHaveLength(0);
    expect(s.lesson.notesSetAsideAsNoise).toBe(240);
  });
  it('preschool keeps every human key press', () => {
    const fists = Array.from({ length: 3 }, (_, k) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ t: start + k * 3000 + d, note: 48 + d, velocity: 90 }))).flat();
    expect(sittingGoodFaithState({ events: fists, startMs: start, lessonSec: 120, watchedSec: 120, preschool: true }).notes).toHaveLength(21);
  });
  it('a long sitting is down-sampled to evenly spaced runs of raw notes', () => {
    const s = sittingGoodFaithState({ events: playing(200, start), startMs: start, lessonSec: 4000, watchedSec: 4000 });
    expect(s.lesson.notesPlayed).toBe(1000);
    expect(s.notes).toHaveLength(STATE_LIMITS.maxNotes);
    expect(s.notes[0].onsetMs).toBe(0);
    expect(s.notes.at(-1).onsetMs).toBeGreaterThan(3_900_000);
    expect(s.perMinute.reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('an empty sitting is nobody playing', () => {
    const s = sittingGoodFaithState({ events: [], startMs: start, lessonSec: 300, watchedSec: 290, checkIns: [{ atMs: 90000, answered: true }, { atMs: 180000, scales: 1, answered: true }] });
    expect(s.notes).toEqual([]);
    expect(s.presence.log.map((c) => c.asked)).toEqual(['note', 'scale']);
    expect(s.lesson.notesPlayed).toBe(0);
  });
});

describe('normaliseGoodFaithState', () => {
  const good = () => sittingGoodFaithState({ events: playing(2, 0), startMs: 0, lessonSec: 300, watchedSec: 280, checkIns: [{ atMs: 1000, answered: true }] });
  it('round-trips a state the kiosk built', () => {
    expect(normaliseGoodFaithState(good())).toEqual(good());
  });
  it('drops unknown fields and coerces numbers', () => {
    const s = { ...good(), image: 'data:png', extra: 1 };
    s.notes = [{ ...s.notes[0], userName: 'x', pitch: '60' }];
    const n = normaliseGoodFaithState(s);
    expect(Object.keys(n).sort()).toEqual(['lesson', 'notes', 'perMinute', 'presence']);
    expect(n.notes[0]).toEqual({ pitch: 60, onsetMs: 0, durMs: 300, velocity: 60 });
  });
  it('caps sizes and rejects nonsense', () => {
    const s = good();
    s.notes = Array.from({ length: 900 }, () => s.notes[0]);
    s.perMinute = Array.from({ length: 900 }, () => 1);
    const n = normaliseGoodFaithState(s);
    expect(n.notes).toHaveLength(STATE_LIMITS.maxNotes);
    expect(n.perMinute).toHaveLength(STATE_LIMITS.maxMinutes);
    expect(normaliseGoodFaithState(null)).toBeNull();
    expect(normaliseGoodFaithState({ notes: 'x' })).toBeNull();
    expect(normaliseGoodFaithState({ ...good(), notes: [{ pitch: 300, onsetMs: 0, velocity: 1 }] }).notes).toEqual([]);
  });
});

describe('fallbackCredited — the lenient deterministic rule', () => {
  it('credits meaningful playing or an answered presence check-in; nothing else', () => {
    expect(MEANINGFUL_NOTES).toBe(6);
    expect(fallbackCredited({ practiceNotes: 6, checkInsAnswered: 0 })).toBe(true);
    expect(fallbackCredited({ practiceNotes: 0, checkInsAnswered: 1 })).toBe(true);
    expect(fallbackCredited({ practiceNotes: 5, checkInsAnswered: 0 })).toBe(false);
    expect(fallbackCredited({})).toBe(false);
  });
});
