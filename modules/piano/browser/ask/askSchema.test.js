import { describe, it, expect } from 'vitest';
import { AXES, PRESETS, deriveStage, expandAsk, validateAsk } from './askSchema.js';

/** A tuple that satisfies every constraint — the roadmap's unremovable floor. */
const FLOOR = Object.freeze({
  texture: 'unison',
  hands: 'either',
  source: { kind: 'synthesized', count: 1 },
  prompt: 'follow',
  secondary: 'none',
  timing: 'free',
  judging: 'completion',
});

/** A bank-sourced tuple, for constraints that need note-carrying material. */
const BANK = Object.freeze({
  texture: 'line',
  hands: 'right',
  source: { kind: 'bank', family: 'scales', root: 'C', mode: 'major', octaves: 1 },
  prompt: 'follow',
  secondary: 'staff',
  timing: 'free',
  judging: 'completion',
});

describe('AXES', () => {
  it('lists the nine axes', () => {
    expect(Object.keys(AXES).sort()).toEqual(
      ['texture', 'hands', 'source', 'prompt', 'secondary', 'notationStyle', 'timing', 'judging', 'hints'].sort(),
    );
  });

  it('source is keyed by kind, each with its own params list', () => {
    expect(Object.keys(AXES.source).sort()).toEqual(['bank', 'score', 'synthesized']);
    expect(Array.isArray(AXES.source.bank.params)).toBe(true);
    expect(Array.isArray(AXES.source.synthesized.params)).toBe(true);
    expect(Array.isArray(AXES.source.score.params)).toBe(true);
  });
});

describe('validateAsk — every axis value round-trips', () => {
  const SIMPLE_AXES = ['texture', 'hands', 'prompt', 'secondary', 'notationStyle', 'timing', 'judging', 'hints'];

  for (const axis of SIMPLE_AXES) {
    for (const value of AXES[axis]) {
      it(`accepts ${axis}=${value} (paired with a permissive base tuple)`, () => {
        // Build a base tuple unlikely to trip unrelated constraints, then swap in
        // the value under test. recall/hints and notation-coupling constraints are
        // asserted on their own below — here we only check vocabulary acceptance.
        const base = { ...BANK };
        base[axis] = value;
        const result = validateAsk(base);
        // Grammar never rejects a listed value; only cross-axis constraints (or the
        // not-yet-implemented gate) may still say no — so assert no *vocabulary*
        // error appears, rather than a blanket ok:true.
        const vocabError = result.errors.find((e) => e.startsWith(`${axis}: unknown value`));
        expect(vocabError).toBeUndefined();
      });
    }
  }

  for (const [axis, values] of [
    ['texture', ['nonsense']],
    ['hands', ['nonsense']],
    ['prompt', ['nonsense']],
    ['secondary', ['nonsense']],
    ['notationStyle', ['nonsense']],
    ['timing', ['nonsense']],
    ['judging', ['nonsense']],
    ['hints', ['nonsense']],
  ]) {
    for (const value of values) {
      it(`rejects ${axis}=${value} with the axis named`, () => {
        const tuple = { ...FLOOR, [axis]: value };
        const result = validateAsk(tuple);
        expect(result.ok).toBe(false);
        expect(result.errors.some((e) => e.startsWith(`${axis}:`))).toBe(true);
      });
    }
  }

  it('rejects an unknown source kind, naming source', () => {
    const result = validateAsk({ ...FLOOR, source: { kind: 'nonsense' } });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('source:'))).toBe(true);
  });

  it('the floor tuple validates clean', () => {
    expect(validateAsk(FLOOR)).toEqual({ ok: true, errors: [] });
  });
});

describe('validateAsk — constraints', () => {
  it('placed without cued is rejected', () => {
    const result = validateAsk({ ...BANK, judging: 'placed', timing: 'free' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('placed:'))).toBe(true);
  });

  it('placed with cued is fine (boundary)', () => {
    const result = validateAsk({ ...BANK, judging: 'placed', timing: 'cued' });
    expect(result.ok).toBe(true);
  });

  it('cued without placed is fine (boundary)', () => {
    const result = validateAsk({ ...BANK, timing: 'cued', judging: 'completion' });
    expect(result.ok).toBe(true);
  });

  it('cued with a synthesized source is rejected — no note values to cue against', () => {
    const result = validateAsk({ ...FLOOR, timing: 'cued' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('cued:'))).toBe(true);
  });

  it('cued with NO source at all is rejected — the positive check, not just the synthesized blocklist', () => {
    const { source, ...withoutSource } = BANK;
    const result = validateAsk({ ...withoutSource, timing: 'cued' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('cued:'))).toBe(true);
  });

  it('cued with a bank source is fine (boundary)', () => {
    const result = validateAsk({ ...BANK, timing: 'cued' });
    expect(result.ok).toBe(true);
  });

  it('cued with a score source is fine on the cued constraint (boundary)', () => {
    const result = validateAsk({
      ...BANK,
      source: { kind: 'score', sourceId: 'x', measureStart: 1, measureEnd: 4 },
      notationStyle: 'score',
      timing: 'cued',
    });
    expect(result.errors.some((e) => e.startsWith('cued:'))).toBe(false);
  });

  it('a score source without style score is rejected', () => {
    const result = validateAsk({
      ...BANK,
      source: { kind: 'score', sourceId: 'x', measureStart: 1, measureEnd: 4 },
      notationStyle: 'engraved',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('source:'))).toBe(true);
  });

  it('a score source with style score is fine (boundary)', () => {
    const result = validateAsk({
      ...BANK,
      source: { kind: 'score', sourceId: 'x', measureStart: 1, measureEnd: 4 },
      notationStyle: 'score',
    });
    expect(result.ok).toBe(true);
  });

  it('recall with a score source is rejected', () => {
    const result = validateAsk({
      ...BANK,
      prompt: 'recall',
      source: { kind: 'score', sourceId: 'x', measureStart: 1, measureEnd: 4 },
      notationStyle: 'score',
    });
    expect(result.errors.some((e) => e.startsWith('recall:'))).toBe(true);
  });

  it('recall with a bank source is a valid SP2 ask', () => {
    const result = validateAsk({ ...BANK, prompt: 'recall' });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('sequence style with both hands is rejected', () => {
    const result = validateAsk({ ...BANK, notationStyle: 'sequence', hands: 'both' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('sequence:'))).toBe(true);
  });

  it('sequence style with a single hand is fine (boundary)', () => {
    const result = validateAsk({ ...BANK, notationStyle: 'sequence', hands: 'right' });
    expect(result.ok).toBe(true);
  });

  it('sequence style with more than 2 octaves is rejected', () => {
    const result = validateAsk({
      ...BANK,
      notationStyle: 'sequence',
      hands: 'right',
      source: { ...BANK.source, octaves: 3 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('sequence:'))).toBe(true);
  });

  it('sequence style with exactly 2 octaves is fine (boundary)', () => {
    const result = validateAsk({
      ...BANK,
      notationStyle: 'sequence',
      hands: 'right',
      source: { ...BANK.source, octaves: 2 },
    });
    expect(result.ok).toBe(true);
  });

  it('polyphony without engraved/score style is rejected', () => {
    const result = validateAsk({ ...BANK, texture: 'polyphony', notationStyle: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('polyphony:'))).toBe(true);
  });

  it('polyphony with engraved style is fine (boundary)', () => {
    const result = validateAsk({ ...BANK, texture: 'polyphony', notationStyle: 'engraved' });
    expect(result.ok).toBe(true);
  });

  it('polyphony with score style is fine (boundary)', () => {
    const result = validateAsk({
      ...BANK,
      texture: 'polyphony',
      source: { kind: 'score', sourceId: 'x', measureStart: 1, measureEnd: 4 },
      notationStyle: 'score',
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateAsk — implemented SP2 presentation values', () => {
  it('prompt:recall is accepted', () => {
    const result = validateAsk({ ...BANK, prompt: 'recall' });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('hints:after-stall is accepted', () => {
    const result = validateAsk({ ...BANK, hints: 'after-stall' });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('hints:always is accepted', () => {
    const result = validateAsk({ ...BANK, hints: 'always' });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('hints:none is accepted', () => {
    const result = validateAsk({ ...BANK, hints: 'none' });
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe('validateAsk — complete mode', () => {
  const REQUIRED = ['texture', 'hands', 'source', 'prompt', 'timing', 'judging'];

  it('partial mode (no options) keeps today\'s behaviour: {} is ok', () => {
    expect(validateAsk({})).toEqual({ ok: true, errors: [] });
  });

  it('complete mode rejects {}, naming every missing judging-relevant axis', () => {
    const result = validateAsk({}, { complete: true });
    expect(result.ok).toBe(false);
    for (const axis of REQUIRED) {
      expect(result.errors).toContain(`missing-axis: ${axis}`);
    }
  });

  it('complete mode rejects null — never ok:true', () => {
    const result = validateAsk(null, { complete: true });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('complete mode rejects an expandAsk(...).presentation output as incomplete', () => {
    const expanded = expandAsk({
      id: 'L1',
      tier: 2,
      material: [{ kind: 'exercise', collection: 'scales', mode: 'major', roots: ['C'], octaves: 1 }],
    });
    const result = validateAsk(expanded.presentation, { complete: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('missing-axis: texture');
    expect(result.errors).toContain('missing-axis: hands');
    expect(result.errors).toContain('missing-axis: source');
    expect(result.errors).toContain('missing-axis: judging');
  });

  it('complete mode accepts the floor tuple — every required axis is present', () => {
    expect(validateAsk(FLOOR, { complete: true })).toEqual({ ok: true, errors: [] });
  });

  it('complete mode does not require secondary, notationStyle, or hints', () => {
    const { secondary, ...withoutSecondary } = FLOOR;
    const result = validateAsk(withoutSecondary, { complete: true });
    expect(result.errors.some((e) => e.startsWith('missing-axis:'))).toBe(false);
  });

  it('complete mode still runs the constraint table on top of the completeness check', () => {
    const result = validateAsk({ ...BANK, judging: 'placed', timing: 'free' }, { complete: true });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('placed:'))).toBe(true);
  });
});

describe('PRESETS — pinned to today\'s tier behaviour', () => {
  it('tier-0', () => {
    expect(PRESETS['tier-0']).toEqual({ prompt: 'follow', secondary: 'none', timing: 'free', judging: 'completion' });
  });

  it('tier-1', () => {
    expect(PRESETS['tier-1']).toEqual({ prompt: 'follow', secondary: 'staff', timing: 'free', judging: 'completion' });
  });

  it('tier-2', () => {
    expect(PRESETS['tier-2']).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'sequence',
      timing: 'free',
      judging: 'completion',
    });
  });

  it('tier-3', () => {
    expect(PRESETS['tier-3']).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'engraved',
      timing: 'cued',
      judging: 'placed',
    });
  });
});

describe('expandAsk — legacy {tier, material, grading} shape', () => {
  it('tier 0 expands to the pinned tuple', () => {
    const result = expandAsk({ id: 'L0', tier: 0, material: [{ kind: 'keys', notes: 1, arrangement: 'together' }] });
    expect(result).toEqual({
      material: [{ kind: 'keys', notes: 1, arrangement: 'together' }],
      presentation: { prompt: 'follow', secondary: 'none', timing: 'free' },
      grading: { judging: 'completion' },
      errors: [],
    });
  });

  it('tier 1 expands to the pinned tuple', () => {
    const result = expandAsk({ id: 'L1', tier: 1, material: [{ kind: 'keys', notes: 1, arrangement: 'together' }] });
    expect(result.presentation).toEqual({ prompt: 'follow', secondary: 'staff', timing: 'free' });
    expect(result.grading).toEqual({ judging: 'completion' });
    expect(result.errors).toEqual([]);
  });

  it('tier 2 expands to the pinned tuple', () => {
    const result = expandAsk({
      id: 'L2',
      tier: 2,
      material: [{ kind: 'exercise', collection: 'scales', mode: 'major', roots: ['C'], octaves: 1 }],
    });
    expect(result.presentation).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'sequence',
      timing: 'free',
    });
    expect(result.grading).toEqual({ judging: 'completion' });
    expect(result.errors).toEqual([]);
  });

  it('tier 3 expands to the pinned tuple, and passes grading.cleanliness through untouched', () => {
    const result = expandAsk({
      id: 'L3',
      tier: 3,
      material: [{ kind: 'exercise', collection: 'scales', mode: 'major', roots: ['C'], octaves: 1 }],
      grading: { cleanliness: 0.8 },
    });
    expect(result.presentation).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'engraved',
      timing: 'cued',
    });
    expect(result.grading).toEqual({ judging: 'placed', cleanliness: 0.8 });
    expect(result.errors).toEqual([]);
  });

  it('a live legacy level (L1/tier 2, exercise material) expands without errors', () => {
    const level = { id: 'L1', tier: 2, material: [{ kind: 'exercise', collection: 'scales', mode: 'major', roots: ['C'], octaves: 1 }] };
    expect(expandAsk(level).errors).toEqual([]);
  });

  it('a keys-material legacy level expands without errors', () => {
    const level = { id: 'K1', tier: 0, material: [{ kind: 'keys', notes: 1, arrangement: 'together' }] };
    expect(expandAsk(level).errors).toEqual([]);
  });

  it('an unknown tier is reported, not thrown', () => {
    const result = expandAsk({ id: 'LX', tier: 99, material: [] });
    expect(result.errors.some((e) => e.startsWith('tier:'))).toBe(true);
  });
});

describe('expandAsk — explicit {material, presentation, grading} shape', () => {
  it('overrides preset values key-by-key', () => {
    const result = expandAsk({
      material: [{ kind: 'exercise', collection: 'scales' }],
      presentation: { prompt: 'read', timing: 'cued' },
      grading: { judging: 'placed' },
    });
    expect(result.presentation).toEqual({ prompt: 'read', secondary: 'none', timing: 'cued' });
    expect(result.grading).toEqual({ judging: 'placed' });
    expect(result.errors).toEqual([]);
  });

  it('an explicit tier plus a partial presentation override merges both', () => {
    const result = expandAsk({
      tier: 2,
      material: [{ kind: 'exercise', collection: 'scales' }],
      presentation: { timing: 'cued' },
    });
    expect(result.presentation).toEqual({
      prompt: 'read',
      secondary: 'keyboard-strip',
      notationStyle: 'sequence',
      timing: 'cued',
    });
  });

  it('an unknown explicit presentation axis is reported, not thrown', () => {
    const result = expandAsk({ material: [], presentation: { bogus: 'x' } });
    expect(result.errors.some((e) => e.startsWith('presentation:'))).toBe(true);
  });

  it('an out-of-vocabulary explicit value is reported, axis named', () => {
    const result = expandAsk({ material: [], presentation: { prompt: 'nonsense' } });
    expect(result.errors.some((e) => e.startsWith('prompt:'))).toBe(true);
  });

  it('explicit prompt:recall is accepted', () => {
    const result = expandAsk({ material: [], presentation: { prompt: 'recall' } });
    expect(result.errors).toEqual([]);
  });

  it('explicit hints !== none is accepted', () => {
    const result = expandAsk({ material: [], presentation: { hints: 'after-stall' } });
    expect(result.errors).toEqual([]);
  });

  it('validates pitch-class grading policy without confusing it with an axis', () => {
    expect(expandAsk({ material: [], grading: { pitchClass: true, bassPitchClass: 0 } }).errors).toEqual([]);
  });

  it.each([
    [{ pitchClass: 'yes' }, 'grading.pitchClass: must be boolean'],
    [{ pitchClass: true, bassPitchClass: 12 }, 'grading.bassPitchClass: must be an integer from 0 to 11'],
    [{ bassPitchClass: 0 }, 'grading.bassPitchClass: requires pitchClass'],
  ])('rejects malformed pitch-class grading %#', (grading, error) => {
    expect(expandAsk({ material: [], grading }).errors).toContain(error);
  });
});

describe('deriveStage — tuple-space stage resolution (task 2, replaces stageForTier)', () => {
  // A single-hand, narrow-span instance: the one-staff sequence renderer's own
  // limits (`sequenceStaffCanDraw`) accept it.
  const CAN_DRAW = Object.freeze({
    events: Object.freeze([
      { notes: [{ midi: 60, hand: 'right' }] },
      { notes: [{ midi: 64, hand: 'right' }] },
      { notes: [{ midi: 67, hand: 'right' }] },
    ]),
  });

  // `drills/hanon/001`, trimmed: `staff: grand`, both hands on every event, a
  // span from midi 36 to 91 — the material `sequenceStaffCanDraw` was written
  // to refuse, on all three counts at once. Same shape `runPresentation.test.js`
  // pins against `stageForTier`.
  const CANNOT_DRAW = Object.freeze({
    staff: 'grand',
    events: Object.freeze([
      { notes: [{ midi: 36, hand: 'left' }, { midi: 48, hand: 'right' }] },
      { notes: [{ midi: 79, hand: 'left' }, { midi: 91, hand: 'right' }] },
    ]),
  });

  const instanceFor = (ordering, canDraw) => ({ ...(canDraw ? CAN_DRAW : CANNOT_DRAW), ordering });

  const PRESET_NAMES = ['tier-0', 'tier-1', 'tier-2', 'tier-3'];

  /** The routing table this function must reproduce, independent of its own code. */
  function expectedStage(preset, ordering, canDraw) {
    if (ordering === 'any') return 'keys'; // overrides every preset, every tier
    if (preset === 'tier-0' || preset === 'tier-1') return 'keys'; // prompt: follow
    if (preset === 'tier-2') return canDraw ? 'sequence' : 'notation'; // read + sequence
    return 'notation'; // tier-3: read + engraved/cued
  }

  it('recall is its own no-lights primary stage, even for unordered chord material', () => {
    expect(deriveStage({ prompt: 'recall', notationStyle: 'engraved' }, { ordering: 'any' })).toBe('recall');
  });

  it('a one-note read ask uses the compact staff card', () => {
    expect(deriveStage({ prompt: 'read', notationStyle: 'sequence' }, {
      ordering: 'strict', events: [{ notes: [{ midi: 60, hand: 'right' }] }],
    })).toBe('single-note');
  });

  // Every {preset} x {ordering any/strict} x {canDraw yes/no} cell: 4 x 2 x 2 = 16.
  for (const preset of PRESET_NAMES) {
    for (const ordering of ['strict', 'any']) {
      for (const canDraw of [true, false]) {
        it(`${preset}, ordering:${ordering}, canDraw:${canDraw} -> ${expectedStage(preset, ordering, canDraw)}`, () => {
          const instance = instanceFor(ordering, canDraw);
          expect(deriveStage(PRESETS[preset], instance)).toBe(expectedStage(preset, ordering, canDraw));
        });
      }
    }
  }

  // Equivalents of runPresentation.test.js's `stageForTier` cases, re-expressed
  // over the tuple the same preset expands to — the proof this and
  // `stageForTier(tier, instance)` agree on every tier the tiers still name.
  it('tier-0 and tier-1 presets both mount keys, matching stageForTier(0|1, ...)', () => {
    const strict = { ordering: 'strict' };
    expect(deriveStage(PRESETS['tier-0'], strict)).toBe('keys');
    expect(deriveStage(PRESETS['tier-1'], strict)).toBe('keys');
  });

  it('tier-2 preset mounts sequence when the staff can draw it, matching stageForTier(2, ...)', () => {
    expect(deriveStage(PRESETS['tier-2'], instanceFor('strict', true))).toBe('sequence');
  });

  it('tier-2 preset falls back to notation on the real Hanon shape, matching stageForTier(2, HANON)', () => {
    expect(deriveStage(PRESETS['tier-2'], instanceFor('strict', false))).toBe('notation');
  });

  it('tier-3 preset always mounts notation, matching stageForTier(3, ...)', () => {
    expect(deriveStage(PRESETS['tier-3'], instanceFor('strict', true))).toBe('notation');
    expect(deriveStage(PRESETS['tier-3'], instanceFor('strict', false))).toBe('notation');
  });

  it('ordering:any sends every preset to keys, matching stageForTier(N, {ordering:"any"})', () => {
    for (const preset of PRESET_NAMES) {
      expect(deriveStage(PRESETS[preset], { ordering: 'any' })).toBe('keys');
    }
  });

  // The one stage stageForTier never had to answer: a score-sourced tuple.
  // ExerciseRun short-circuits to it today (`stage = score ? 'score' : ...`)
  // before stageForTier is ever called; deriveStage folds that into the same
  // function, as the highest-precedence check.
  it('a score-styled tuple mounts the score stage, ahead of ordering and prompt', () => {
    expect(deriveStage({ notationStyle: 'score' }, null)).toBe('score');
    expect(deriveStage({ notationStyle: 'score', prompt: 'read' }, { ordering: 'strict' })).toBe('score');
    expect(deriveStage({ notationStyle: 'score' }, { ordering: 'any' })).toBe('score');
  });

  it('a nullish tuple or instance never throws, and answers the read-prompted default', () => {
    expect(deriveStage(null, null)).toBe('notation');
    expect(deriveStage(undefined, undefined)).toBe('notation');
    expect(deriveStage({}, {})).toBe('notation');
  });
});
