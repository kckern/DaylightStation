import { describe, expect, it } from 'vitest';
import { activities, RUBIKS_CUBE_COURSE, publicActivity } from './courseCatalog.mjs';

describe('Rubik’s Cube course catalog', () => {
  it('keeps the complete beginner sequence ordered and contains every requested activity type', () => {
    const all = activities();
    expect(RUBIKS_CUBE_COURSE.units.map((unit) => unit.id)).toEqual([
      'know-the-cube', 'white-cross', 'white-corners', 'middle-layer', 'yellow-face', 'last-layer', 'complete-the-cube',
    ]);
    expect(new Set(all.map((item) => item.kind))).toEqual(new Set(['demo', 'lesson', 'challenge', 'quiz']));
    expect(all).toHaveLength(33);
  });

  it('keeps answer keys and authored solutions out of the learner projection', () => {
    for (const lesson of activities()) {
      const safe = publicActivity(lesson);
      expect(safe.solution).toBeUndefined();
      for (const question of safe.questions ?? []) expect(question.answer).toBeUndefined();
      for (const question of lesson.questions ?? []) expect(question.options).toHaveLength(4);
    }
  });
});
