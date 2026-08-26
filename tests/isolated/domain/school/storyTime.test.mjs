import { describe, it, expect } from 'vitest';
import { validateStoryTimeEnrollment, MAX_STORY_TARGET } from '#domains/school/storyTime.mjs';

describe('validateStoryTimeEnrollment', () => {
  it('accepts a bare enrollment and applies the default target', () => {
    const r = validateStoryTimeEnrollment({ programId: 'story-time' });
    expect(r.errors).toEqual([]);
    expect(r.enrollment).toEqual({ programId: 'story-time', corpusId: null, target: 2, subject: 'english', title: null });
  });

  it('accepts an explicit target', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 3 }).enrollment.target).toBe(3);
  });

  it('refuses a zero or negative target', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 0 }).errors[0]).toMatch(/target/);
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: -1 }).errors[0]).toMatch(/target/);
  });

  it('refuses a non-integer target', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 1.5 }).errors[0]).toMatch(/target/);
  });

  it('refuses an absurd target rather than storing an unmeetable obligation', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: 100 }).errors[0]).toMatch(/target/);
  });

  // A ceiling with no boundary test can move by one without anything noticing.
  it('pins the ceiling exactly — 20 is a target, 21 is a mistake', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: MAX_STORY_TARGET }).errors).toEqual([]);
    expect(validateStoryTimeEnrollment({ programId: 'story-time', target: MAX_STORY_TARGET + 1 }).errors[0]).toMatch(/target/);
    expect(MAX_STORY_TARGET).toBe(20);
  });

  it('refuses an unknown subject', () => {
    expect(validateStoryTimeEnrollment({ programId: 'story-time', subject: 'nonsense' }).errors[0]).toMatch(/subject/);
  });
});
