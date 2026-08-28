import { describe, it, expect } from 'vitest';
import {
  initialRung, degradeRung, climbRung, isFloor, requirementForRung,
} from './gameGateLadder.js';

describe('gameGateLadder', () => {
  it('initialRung starts at the hardest value on every axis', () => {
    expect(initialRung()).toEqual({
      timing: 'cued', hands: 2, span: 2, difficulty: 'exotic', direction: 'both',
    });
  });

  // Degradation order per the design: direction -> difficulty -> span ->
  // hands -> timing (timing LAST — it changes what failure *means*, so it
  // is the last thing given up). Each row pins the single axis expected to
  // move at that step and the full resulting rung, so a wrong order fails
  // here rather than only failing a step-count assertion.
  const walk = [
    {
      step: 1, axis: 'direction',
      expected: { timing: 'cued', hands: 2, span: 2, difficulty: 'exotic', direction: 'ascending' },
    },
    {
      step: 2, axis: 'difficulty',
      expected: { timing: 'cued', hands: 2, span: 2, difficulty: 'major', direction: 'ascending' },
    },
    {
      step: 3, axis: 'span',
      expected: { timing: 'cued', hands: 2, span: 1, difficulty: 'major', direction: 'ascending' },
    },
    {
      step: 4, axis: 'hands',
      expected: { timing: 'cued', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' },
    },
    {
      step: 5, axis: 'timing',
      expected: { timing: 'free', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' },
    },
  ];

  it.each(walk)('degrade step $step eases $axis and nothing else', ({ step, expected }) => {
    let rung = initialRung();
    for (let i = 0; i < step; i += 1) rung = degradeRung(rung);
    expect(rung).toEqual(expected);
  });

  it('the full walk reaches the floor in exactly 5 steps, in the stated order', () => {
    let rung = initialRung();
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      rung = degradeRung(rung);
      seen.push({ ...rung });
    }
    expect(seen).toEqual(walk.map((w) => w.expected));
    expect(isFloor(rung)).toBe(true);
  });

  it('degradeRung(floor) is identity — returns the same rung unchanged', () => {
    let floor = initialRung();
    for (let i = 0; i < 5; i += 1) floor = degradeRung(floor);
    expect(isFloor(floor)).toBe(true);

    const degradedAgain = degradeRung(floor);
    expect(degradedAgain).toBe(floor);
    expect(degradedAgain).toEqual(floor);
  });

  it('climbRung(initialRung()) is identity — returns the same rung unchanged', () => {
    const top = initialRung();
    const climbedAgain = climbRung(top);
    expect(climbedAgain).toBe(top);
    expect(climbedAgain).toEqual(top);
  });

  it('climbRung restores the last axis eased, undoing degradeRung one step at a time', () => {
    let rung = initialRung();
    const degradedSteps = [];
    for (let i = 0; i < 5; i += 1) {
      rung = degradeRung(rung);
      degradedSteps.push(rung);
    }
    // Climbing from the floor should retrace the degradation path exactly,
    // in reverse: timing first, then hands, span, difficulty, direction.
    let climbed = rung;
    for (let i = 5 - 1; i >= 0; i -= 1) {
      climbed = climbRung(climbed);
      const expectedRung = i === 0 ? initialRung() : degradedSteps[i - 1];
      expect(climbed).toEqual(expectedRung);
    }
  });

  it('isFloor is true only when every axis is already at its easiest value', () => {
    expect(isFloor(initialRung())).toBe(false);
    expect(isFloor({ timing: 'free', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' })).toBe(true);
    // one axis not yet eased -> not the floor
    expect(isFloor({ timing: 'cued', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' })).toBe(false);
  });

  describe('requirementForRung', () => {
    it('the floor requirement omits cleanliness so a stray key cannot fail it', () => {
      let floor = initialRung();
      for (let i = 0; i < 5; i += 1) floor = degradeRung(floor);
      const requirement = requirementForRung(floor, { passScore: 0.8 });
      expect(requirement).toEqual({
        mode: 'free',
        hands: 1,
        span: 1,
        rubric: { criteria: { completeness: 1 } },
        passScore: null,
      });
      expect(requirement.rubric.criteria.cleanliness).toBeUndefined();
    });

    it('maps timing:"cued" to mode:"cued" for a non-floor rung', () => {
      const rung = initialRung(); // timing: 'cued'
      const requirement = requirementForRung(rung, { passScore: 0.8 });
      expect(requirement).toEqual({
        mode: 'cued', hands: 2, span: 2, difficulty: 'exotic', direction: 'both', passScore: 0.8,
      });
    });

    it('maps any non-"cued" timing to mode:"free" for a non-floor rung', () => {
      const rung = { timing: 'free', hands: 2, span: 1, difficulty: 'major', direction: 'both' };
      const requirement = requirementForRung(rung, { passScore: 0.6 });
      expect(requirement.mode).toBe('free');
    });

    it('a non-floor requirement never carries a rubric key', () => {
      const rung = initialRung();
      const requirement = requirementForRung(rung, { passScore: 0.8 });
      expect(requirement).not.toHaveProperty('rubric');
    });

    it('passes passScore through unchanged for a non-floor rung', () => {
      const rung = initialRung();
      expect(requirementForRung(rung, { passScore: 0.95 }).passScore).toBe(0.95);
    });
  });
});
