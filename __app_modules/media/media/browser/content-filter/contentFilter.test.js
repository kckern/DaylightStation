import { describe, it, expect } from 'vitest';
import { resolveEffect, resolveEffectiveCues, cuesActiveAt } from "./contentFilter.js";

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

describe('resolveEffectiveCues with refined data', () => {
  const edl = { cues: [
    { id: 'v', category: 'sex/immodesty', in: 100, out: 106, type: 'skip' },
    { id: 's', category: 'sex/sign', in: 200, out: 206, type: 'skip' },
  ] };
  const refine = { v: 1, part: '40417' };

  it('uses frame-precise times without approximate widening', () => {
    const override = { cueOverrides: { v: { in: 107.375, out: 109.042, precision: 'frame', refine } } };
    const [c] = resolveEffectiveCues({ edl, profile: { categories: { 'sex/immodesty': { effect: 'full-blur' } } }, override, part: '40417' });
    expect(c.in).toBeCloseTo(107.375 - 0.15, 3);
    expect(c.out).toBeCloseTo(109.042 + 0.25, 3);
  });

  it('ignores refined times on a different part', () => {
    const override = { sync: { offsetSec: 7 }, cueOverrides: { v: { in: 107.375, out: 109.042, precision: 'frame', refine, nudgeMs: 0 } } };
    const [c] = resolveEffectiveCues({ edl, profile: { categories: { 'sex/immodesty': { effect: 'skip' } } }, override, part: '999' });
    expect(c.in).toBeCloseTo(107 - 0.4, 3);
  });

  it('splits multi-segment cues so a skip keeps the cutaway between them', () => {
    const override = { cueOverrides: { v: { in: 107, out: 115, precision: 'frame', refine, segments: [{ in: 107, out: 109 }, { in: 112, out: 115 }] } } };
    const cues = resolveEffectiveCues({ edl, profile: { categories: { 'sex/immodesty': { effect: 'skip' } } }, override });
    expect(cues.map((c) => c.id)).toEqual(['v#0', 'v#1']);
    expect(cues[1].in).toBeCloseTo(112 - 0.4, 3);
  });

  it('turns a region track into per-keyframe overlay rects', () => {
    const override = { cueOverrides: { s: { in: 210, out: 213, precision: 'frame', refine, regions: [
      { in: 210, grid: 6, cells: [0, 1, 6, 7], box: { x: 0, y: 0, w: 0.333, h: 0.333 } },
      { in: 211.5, grid: 6, cells: [4, 5] },
      { in: 213, cells: [] },
    ] } } };
    const cues = resolveEffectiveCues({ edl, profile: { categories: { 'sex/sign': { effect: 'blur' } } }, override });
    expect(cues.map((c) => c.id)).toEqual(['s@0', 's@1']);
    expect(cues[0].rect).toEqual({ x: 0, y: 0, w: 0.333, h: 0.333 });
    expect(cues[1].rect).toEqual({ x: 4 / 6, y: 0, w: 2 / 6, h: 1 / 6 });
  });

  it('ignores the region track for a skip', () => {
    const override = { cueOverrides: { s: { in: 210, out: 213, precision: 'frame', refine, regions: [{ in: 210, grid: 6, cells: [0] }, { in: 213, cells: [] }] } } };
    const cues = resolveEffectiveCues({ edl, profile: { categories: { 'sex/sign': { effect: 'skip' } } }, override });
    expect(cues).toHaveLength(1);
    expect(cues[0].rect).toBeUndefined();
  });
});

describe('resolveEffectiveCues with a refined EDL (VidAngel clock)', () => {
  const zero = { padLeadMs: 0, padTrailMs: 0 };
  const profile = {
    categories: { 'language/x': { effect: 'mute' }, 'sex/x': { effect: 'skip' }, 'violence/x': { effect: 'skip' } },
    treatments: { mute: zero, skip: zero },
  };
  const edl = {
    timebase: { clock: 'vidangel', runtimeSec: 5000 },
    cues: [
      { id: 'w', type: 'mute', category: 'language/x', in: 100.123, out: 100.456, precision: 'ms' },
      { id: 'f', type: 'skip', category: 'sex/x', in: 200.02, out: 201.0, precision: 'frame' },
      { id: 'c', type: 'skip', category: 'violence/x', in: 4050, out: 4052, precision: 'second-approx' },
    ],
  };
  const single = { scale: 1, offsetSec: 8, part: '40417', frames: { fps: '24/1', startTime: 0 } };

  it('maps refined cues through the sync with no approximate widening', () => {
    const w = resolveEffectiveCues({ edl, profile, override: { sync: single }, part: '40417' }).find((c) => c.id === 'w');
    expect(w.in).toBeCloseTo(108.123, 6);
    expect(w.out).toBeCloseTo(108.456, 6);
    expect(w.precision).toBe('ms');
  });
  it('snaps frame cues to the playing copy\'s frame grid', () => {
    const f = resolveEffectiveCues({ edl, profile, override: { sync: single }, part: '40417' }).find((c) => c.id === 'f');
    expect(f.in).toBeCloseTo(208, 6); // 208.02 -> start of frame 4992 (208.0)
    expect(f.out).toBeCloseTo(209, 6); // 209.0 is already a boundary
  });
  it('drops cues in a scene this copy lacks, and maps the rest by segment', () => {
    const sync = {
      part: '40417',
      segments: [
        { fromVa: 0, toVa: 4000, scale: 1, offsetSec: 8 },
        { fromVa: 4100, toVa: 5000, scale: 1, offsetSec: -92 },
      ],
    };
    const out = resolveEffectiveCues({ edl, profile, override: { sync }, part: '40417' });
    expect(out.map((c) => c.id)).toEqual(['w', 'f']);
    expect(out.notInCut).toBe(1);
  });
  it('treats refined cues as approximate on a part the sync was not fitted for', () => {
    const w = resolveEffectiveCues({ edl, profile, override: { sync: single }, part: '999' }).find((c) => c.id === 'w');
    expect(w.precision).not.toBe('ms');
    expect(w.out - w.in).toBeGreaterThanOrEqual(0.9); // widened to the approximate minimum
  });
  it('ignores file-time refined entries left in the override, but keeps person-set keys', () => {
    const override = {
      sync: single,
      cueOverrides: {
        w: { in: 999, out: 1000, precision: 'ms', refine: { v: 1, part: '40417' } },
        f: { disabled: true },
      },
    };
    const out = resolveEffectiveCues({ edl, profile, override, part: '40417' });
    expect(out.find((c) => c.id === 'w').in).toBeCloseTo(108.123, 6);
    expect(out.find((c) => c.id === 'f')).toBeUndefined();
  });
});
