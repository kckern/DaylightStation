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

  it('falls back to the cue.type (VidAngel suggested action) when no profile rule matches', () => {
    const vaEdl = { cues: [{ id: 'v', category: 'alcohol_or_drug_use/beer', type: 'mute', in: 5, out: 6 }] };
    const out = resolveEffectiveCues({ edl: vaEdl, profile: { categories: {} } });
    expect(out).toHaveLength(1);
    expect(out[0].effect).toBe('mute');
  });

  it('widens a zero-width approx mute to a safe min-width so it actually fires', () => {
    const vaEdl = { cues: [{ id: 'z', category: 'language/blasphemy/god', type: 'mute', in: 180, out: 180 }] };
    const prof = { categories: { language: { effect: 'mute' } }, treatments: { mute: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900 } } };
    const c = resolveEffectiveCues({ edl: vaEdl, profile: prof })[0];
    expect(c.in).toBeLessThan(c.out); // no longer zero-width
    expect(c.out - c.in).toBeGreaterThanOrEqual(0.9);
  });

  it('widens a zero-width full-blur (VidAngel nudity point tag) so it actually fires', () => {
    const edl2 = { cues: [{ id: 'n', category: 'sex_nudity_immodesty/immodesty_female', type: 'skip', in: 5280.6, out: 5280.6 }] };
    const prof = { categories: { sex_nudity_immodesty: { effect: 'full-blur' } } };
    const c = resolveEffectiveCues({ edl: edl2, profile: prof })[0];
    expect(c.effect).toBe('full-blur');
    expect(c.out - c.in).toBeGreaterThanOrEqual(2.5); // no longer zero-width
  });

  it('widens srt-line mutes generously (word position uncertain) so late words are covered', () => {
    // A caption-derived mute: the word could be anywhere in the ~2-3s line, so a
    // narrow window can miss a late word (the "damn hands" leak).
    const edl2 = { cues: [] };
    const override = { addCues: [{ id: 's', category: 'language/profanity/damn', effect: 'mute', in: 4438.09, out: 4438.14, precision: 'srt-line' }] };
    const prof = { categories: { language: { effect: 'mute' } }, treatments: { mute: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900, srtLineWidthMs: 1800 } } };
    const c = resolveEffectiveCues({ edl: edl2, profile: prof, override })[0];
    expect(c.out - c.in).toBeGreaterThanOrEqual(1.8);
  });

  it('applies only small pads to an ms-precise mute (no min-width blow-up)', () => {
    const vaEdl = { cues: [{ id: 'z', category: 'language/blasphemy/god', type: 'mute', precision: 'ms', in: 180.0, out: 180.35 }] };
    const prof = { categories: { language: { effect: 'mute' } }, treatments: { mute: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900 } } };
    const c = resolveEffectiveCues({ edl: vaEdl, profile: prof })[0];
    expect(c.out - c.in).toBeCloseTo(0.7, 2); // 0.35 word + 0.2 lead + 0.15 trail
  });

  it('honors precise cueOverride in/out as local ms times (no sync, only small pads)', () => {
    const edl2 = { cues: [{ id: 'a', category: 'language/blasphemy/god', type: 'mute', in: 180, out: 180 }] };
    const override = {
      sync: { offsetSec: 6.5, scale: 1 },
      cueOverrides: { a: { in: 200.12, out: 200.47, precision: 'ms' } }, // snapped word boundary (local)
    };
    const prof = { categories: { language: { effect: 'mute' } }, treatments: { mute: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900 } } };
    const c = resolveEffectiveCues({ edl: edl2, profile: prof, override })[0];
    expect(c.in).toBeCloseTo(199.92, 2); // 200.12 - 0.2 lead, NOT sync-shifted (would be ~186.5)
    expect(c.out - c.in).toBeCloseTo(0.7, 2); // ms path: small pads only, no min-width blow-up
  });

  it('keeps skip-card as one cue with holdSec + resolved text (hook drives pause/resume)', () => {
    const edl2 = { cues: [{ id: 'sc', category: 'sex_any/x', effect: 'skip-card', in: 100, out: 130, text: 'Scene skipped.' }] };
    const prof = { categories: {}, treatments: { 'skip-card': { holdSec: 2.5 } } };
    const out = resolveEffectiveCues({ edl: edl2, profile: prof });
    const sc = out.find((c) => c.effect === 'skip-card');
    expect(sc.in).toBe(100);
    expect(sc.out).toBe(130);
    expect(sc.holdSec).toBe(2.5);
    expect(sc.text).toBe('Scene skipped.');
    expect(out.filter((c) => c.effect === 'title-card')).toHaveLength(0); // no expansion
  });

  it('applies override.sync (offset+scale) to imported cues but not manual addCues', () => {
    const vaEdl = { cues: [{ id: 'a', category: 'violence/graphic', effect: 'skip', in: 100, out: 110 }] };
    const override = {
      sync: { offsetSec: 6.5, scale: 1 },
      addCues: [{ id: 'm', category: 'y', effect: 'mute', in: 50, out: 52 }],
    };
    // zero pads to isolate sync from widening
    const profile = { categories: {}, treatments: { skip: { padLeadMs: 0, padTrailMs: 0 }, mute: { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 } } };
    const out = resolveEffectiveCues({ edl: vaEdl, profile, override });
    const a = out.find((c) => c.id === 'a');
    const m = out.find((c) => c.id === 'm');
    expect(a.in).toBeCloseTo(106.5);
    expect(a.out).toBeCloseTo(116.5);
    expect(m.in).toBe(50); // manual cue authored in local time — not shifted
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
