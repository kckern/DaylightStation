import { describe, it, expect } from 'vitest';
import { requirementForLevel, askForMaterial, framingFor } from './gateAsk.js';
import { BUILT_IN_FLOOR } from './gateRepertoire.js';

describe('requirementForLevel', () => {
  it('a free level (grading null) gets a completeness-only rubric and mode free', () => {
    const level = { id: 'L1', tier: 1, grading: null, material: [{ kind: 'exercise', instanceId: 'x' }] };
    expect(requirementForLevel(level)).toEqual({
      mode: 'free',
      rubric: { criteria: { completeness: 1 } },
      passScore: null,
    });
  });

  it('a free level\'s rubric omits cleanliness so a stray key cannot fail it', () => {
    const level = { id: 'L1', tier: 2, grading: null, material: [{ kind: 'exercise', instanceId: 'x' }] };
    const requirement = requirementForLevel(level);
    expect(requirement.rubric.criteria).not.toHaveProperty('cleanliness');
    expect(requirement.rubric.criteria).toEqual({ completeness: 1 });
  });

  it('the built-in floor resolves to the same unfailable free requirement', () => {
    expect(requirementForLevel(BUILT_IN_FLOOR)).toEqual({
      mode: 'free',
      rubric: { criteria: { completeness: 1 } },
      passScore: null,
    });
  });

  it('a tier-3 level gets a cued rubric with grading.cleanliness', () => {
    const level = { id: 'L7', tier: 3, grading: { cleanliness: 0.8 }, material: [{ kind: 'exercise', instanceId: 'x' }] };
    expect(requirementForLevel(level)).toEqual({
      mode: 'cued',
      rubric: { criteria: { completeness: 1, cleanliness: 0.8 } },
      passScore: null,
    });
  });

  it('a level with grading present but no tier-3 still goes cued (grading presence drives it)', () => {
    const level = { id: 'L5', tier: 2, grading: { cleanliness: 0.7 }, material: [{ kind: 'exercise', instanceId: 'x' }] };
    expect(requirementForLevel(level)).toEqual({
      mode: 'cued',
      rubric: { criteria: { completeness: 1, cleanliness: 0.7 } },
      passScore: null,
    });
  });

  it('a tier-3 level with no grading block defaults cleanliness to 0.8', () => {
    const level = { id: 'L8', tier: 3, grading: null, material: [{ kind: 'exercise', instanceId: 'x' }] };
    expect(requirementForLevel(level)).toEqual({
      mode: 'cued',
      rubric: { criteria: { completeness: 1, cleanliness: 0.8 } },
      passScore: null,
    });
  });

  it('an explicit free recall level preserves its pitch-class policy without becoming cued', () => {
    const level = {
      id: 'alan-c-major',
      material: [{ kind: 'keys', notes: 3, arrangement: 'together' }],
      presentation: { prompt: 'recall', timing: 'free' },
      grading: { pitchClass: true, bassPitchClass: 0 },
    };
    expect(requirementForLevel(level)).toEqual({
      mode: 'free',
      rubric: { criteria: { completeness: 1 } },
      passScore: null,
      policy: { pitchClass: true, bassPitchClass: 0 },
    });
  });

  it('an explicit free clean ask can require an exact capstone score', () => {
    const level = {
      id: 'capstone', tier: 3,
      material: [{ kind: 'score', source: 'rachmaninoff.musicxml', measures: [1, 2] }],
      presentation: { prompt: 'read', timing: 'free' },
      grading: { judging: 'clean', cleanliness: 1 },
    };
    expect(requirementForLevel(level)).toEqual({
      mode: 'free',
      rubric: { criteria: { completeness: 1, cleanliness: 1 } },
      passScore: null,
    });
  });
});

describe('askForMaterial', () => {
  it('keys, notes:1 -> Press the lit key.', () => {
    expect(askForMaterial({ kind: 'keys', notes: 1, arrangement: 'together' })).toBe('Press the lit key.');
  });

  it('keys, notes>1, arrangement:together -> Play these notes together.', () => {
    expect(askForMaterial({ kind: 'keys', notes: 3, arrangement: 'together' })).toBe('Play these notes together.');
  });

  it('a recall chord uses its authored name instead of describing answer lights', () => {
    expect(askForMaterial(
      { kind: 'keys', root: 'C', quality: 'major', arrangement: 'together' },
      null,
      { prompt: 'recall' },
    )).toBe('Play a C major chord.');
  });

  it('keys, notes>1, arrangement:sequence -> Play the lit keys in order.', () => {
    expect(askForMaterial({ kind: 'keys', notes: 3, arrangement: 'sequence' })).toBe('Play the lit keys in order.');
  });

  it('exercise with a major-mode instance and all-right hands -> "C major scale, right hand."', () => {
    const instance = {
      title: 'C Major Scale',
      axes: { root: 'C', mode: 'ionian' },
      events: [
        { notes: [{ midi: 60, hand: 'right' }] },
        { notes: [{ midi: 62, hand: 'right' }] },
      ],
    };
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' }, instance)).toBe('C major scale, right hand.');
  });

  it('exercise with a minor-mode instance and all-left hands -> "A minor scale, left hand."', () => {
    const instance = {
      title: 'A Minor Scale',
      axes: { root: 'A', mode: 'aeolian' },
      events: [{ notes: [{ midi: 57, hand: 'left' }, { midi: 60, hand: 'left' }] }],
    };
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' }, instance)).toBe('A minor scale, left hand.');
  });

  it('exercise with an unlabelled mode reads its own name capitalized', () => {
    const instance = {
      title: 'D Dorian',
      axes: { root: 'D', mode: 'dorian' },
      events: [{ notes: [{ midi: 62, hand: 'right' }] }],
    };
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' }, instance)).toBe('D Dorian scale, right hand.');
  });

  it('exercise with mixed hands omits the hand clause', () => {
    const instance = {
      title: 'C Major Scale',
      axes: { root: 'C', mode: 'ionian' },
      events: [
        { notes: [{ midi: 60, hand: 'right' }] },
        { notes: [{ midi: 48, hand: 'left' }] },
      ],
    };
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' }, instance)).toBe('C major scale.');
  });

  it('exercise with no axes falls back to the instance title', () => {
    const instance = { title: 'Custom Warmup', axes: {}, events: [] };
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' }, instance)).toBe('Custom Warmup');
  });

  it('exercise material with no instance given falls back to a generic ask', () => {
    expect(askForMaterial({ kind: 'exercise', instanceId: 'x' })).toBe('Play the exercise.');
  });

  it('score -> Play this passage as written.', () => {
    expect(askForMaterial({ kind: 'score', source: 's', measures: '1-4' })).toBe('Play this passage as written.');
  });
});

describe('framingFor', () => {
  it('gate context -> "Play this to start " + gameLabel', () => {
    expect(framingFor({ kind: 'gate', gameLabel: 'Piano Chess' })).toBe('Play this to start Piano Chess');
  });

  it('program context -> "Pass this to finish " + stepLabel', () => {
    expect(framingFor({ kind: 'program', stepLabel: 'Warm-up' })).toBe('Pass this to finish Warm-up');
  });

  it('lesson context -> "Pass this to finish " + lessonLabel', () => {
    // A video checkpoint makes the same promise a program step does, and says
    // it in the same words — but off a different fact, from a different host.
    // Kept as its own shape so a change to one line cannot silently rewrite
    // the other.
    expect(framingFor({ kind: 'lesson', lessonLabel: 'Lesson 3' })).toBe('Pass this to finish Lesson 3');
  });

  it('practice context -> null so practice keeps the exercise title as its headline', () => {
    expect(framingFor({ kind: 'practice' })).toBeNull();
  });

  it('null context -> null', () => {
    expect(framingFor(null)).toBeNull();
  });
});
