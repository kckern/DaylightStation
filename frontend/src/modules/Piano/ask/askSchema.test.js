import { describe, it, expect } from 'vitest';
import { AXES, PRESETS, expandAsk, validateAsk } from './askSchema.js';

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

  it('recall with a bank source is fine on that constraint (still gated by not-yet-implemented)', () => {
    const result = validateAsk({ ...BANK, prompt: 'recall' });
    expect(result.errors.some((e) => e.startsWith('recall:'))).toBe(false);
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

describe('validateAsk — not-yet-implemented gate', () => {
  it('prompt:recall yields a distinct not-yet-implemented error', () => {
    const result = validateAsk({ ...BANK, prompt: 'recall' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('not-yet-implemented: recall');
  });

  it('hints:after-stall yields a distinct not-yet-implemented error', () => {
    const result = validateAsk({ ...BANK, hints: 'after-stall' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('not-yet-implemented: hints');
  });

  it('hints:always yields the same not-yet-implemented error', () => {
    const result = validateAsk({ ...BANK, hints: 'always' });
    expect(result.errors).toContain('not-yet-implemented: hints');
  });

  it('hints:none does not trigger the gate', () => {
    const result = validateAsk({ ...BANK, hints: 'none' });
    expect(result.errors).not.toContain('not-yet-implemented: hints');
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

  it('explicit prompt:recall is flagged not-yet-implemented', () => {
    const result = expandAsk({ material: [], presentation: { prompt: 'recall' } });
    expect(result.errors).toContain('not-yet-implemented: recall');
  });

  it('explicit hints !== none is flagged not-yet-implemented', () => {
    const result = expandAsk({ material: [], presentation: { hints: 'after-stall' } });
    expect(result.errors).toContain('not-yet-implemented: hints');
  });
});
