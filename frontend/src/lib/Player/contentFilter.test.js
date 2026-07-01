import { describe, it, expect } from 'vitest';
import { resolveEffect, resolveEffectiveCues, cuesActiveAt } from './contentFilter.js';

describe('resolveEffect', () => {
  it('matches the longest category prefix and returns the effect + params', () => {
    const profile = {
      categories: {
        language: { effect: 'mute' },
        'language/profanity': { effect: 'bleep', sound: 'car-horn' },
      },
    };
    const r = resolveEffect('language/profanity/fuck', profile);
    expect(r.effect).toBe('bleep');
    expect(r.sound).toBe('car-horn');
  });

  it('supports the legacy {action} shorthand as an effect', () => {
    const profile = { categories: { violence: { action: 'skip' } } };
    expect(resolveEffect('violence/graphic', profile).effect).toBe('skip');
  });

  it('returns null when no rule matches or the effect is off', () => {
    expect(resolveEffect('language/x', { categories: { violence: { effect: 'skip' } } })).toBeNull();
    expect(resolveEffect('language', { categories: { language: { effect: 'off' } } })).toBeNull();
  });
});

describe('resolveEffectiveCues', () => {
  const edl = {
    cues: [
      { id: 'a', category: 'language/profanity/fuck', in: 10, out: 10.4, label: 'f-word' },
      { id: 'b', category: 'violence/graphic', in: 100, out: 130, label: 'fight' },
      { id: 'c', category: 'commercial/advertBreak', in: 0, out: 5, label: 'ad' },
    ],
  };
  const profile = {
    categories: {
      'language/profanity': { effect: 'bleep', sound: 'car-horn' },
      'violence/graphic': { effect: 'skip' },
    },
  };

  it('assigns each cue an effect and drops unmatched cues', () => {
    const out = resolveEffectiveCues({ edl, profile });
    expect(out.map((c) => c.id)).toEqual(['a', 'b']); // sorted by in (10 before 100)
    expect(out.find((c) => c.id === 'a').effect).toBe('bleep');
    expect(out.find((c) => c.id === 'a').sound).toBe('car-horn');
    expect(out.find((c) => c.id === 'b').effect).toBe('skip');
  });

  it('merges override.addCues with an explicit effect + params', () => {
    const override = { addCues: [{ id: 'z', category: 'nudity/toplessness', in: 50, out: 56, effect: 'censor-bar', rect: { x: 0.4, y: 0.5, w: 0.2, h: 0.2 } }] };
    const z = resolveEffectiveCues({ edl, profile, override }).find((c) => c.id === 'z');
    expect(z.effect).toBe('censor-bar');
    expect(z.rect.w).toBe(0.2);
  });

  it('lets override.cueOverrides change the effect/sound or disable a cue', () => {
    const override = { cueOverrides: { a: { effect: 'bleep', sound: 'sheep-baa' }, b: { disabled: true } } };
    const out = resolveEffectiveCues({ edl, profile, override });
    expect(out.find((c) => c.id === 'a').sound).toBe('sheep-baa');
    expect(out.find((c) => c.id === 'b')).toBeUndefined();
  });

  it('attaches plot-card text from override.cards', () => {
    const override = { cards: [{ after: 'b', text: 'Skipped a fight scene.' }] };
    const b = resolveEffectiveCues({ edl, profile, override }).find((c) => c.id === 'b');
    expect(b.card).toBe('Skipped a fight scene.');
  });
});

describe('cuesActiveAt', () => {
  const cues = [
    { id: 'm', effect: 'mute', in: 10, out: 12 },
    { id: 's', effect: 'skip', in: 100, out: 130 },
    { id: 'bl', effect: 'blur', in: 100, out: 105 },
  ];

  it('returns all cues active at a time (out exclusive)', () => {
    expect(cuesActiveAt(cues, 104).map((c) => c.id).sort()).toEqual(['bl', 's']);
    expect(cuesActiveAt(cues, 11).map((c) => c.id)).toEqual(['m']);
    expect(cuesActiveAt(cues, 12).map((c) => c.id)).toEqual([]);
  });
});
