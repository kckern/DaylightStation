import { describe, it, expect } from 'vitest';
import { creditsAsEraser, leniencyCap } from '#domains/school/documents/ambiguityLeniency.mjs';

const mc4 = { type: 'multiple_choice', choiceCount: 4 };

describe('creditsAsEraser', () => {
  it('credits two marks when one is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['B', 'D'], correctLetter: 'D' })).toBe(true);
  });

  it('refuses two marks when neither is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['A', 'B'], correctLetter: 'D' })).toBe(false);
  });

  it('refuses three or more marks even when one is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['A', 'B', 'D'], correctLetter: 'D' })).toBe(false);
  });

  it('refuses when every choice is marked (true/false double-mark)', () => {
    const tf = { type: 'true_false', choiceCount: 2 };
    expect(creditsAsEraser({ item: tf, given: ['A', 'B'], correctLetter: 'A' })).toBe(false);
  });
});

describe('leniencyCap', () => {
  it('gives a short worksheet one free pass', () => {
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 6 })).toBe(1);
  });

  it('scales at one in five', () => {
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 10 })).toBe(2);
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 20 })).toBe(4);
  });

  it('is strict for a quiz', () => {
    expect(leniencyCap({ archetype: 'quiz', rowCount: 20 })).toBe(0);
  });
});
