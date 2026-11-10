import { describe, it, expect } from 'vitest';
import { hidePiece, resolveEffect, resolveEffectiveCues as resolveWithLongHides, cuesActiveAt, pictureOverlaps } from "./contentFilter.js";
import { filterSummary } from './filterSummary.js';

// Most suites here exercise effect resolution and stacking over long cues. The long-hide
// conversion (a whole-frame blur past maxSec becomes a carded blackout) has its own suite in
// longHide.test.js, so these run with it off unless a profile sets its own maxSec.
const resolveEffectiveCues = (args = {}) => {
  const profile = args.profile;
  if (!profile || profile.treatments?.['full-blur']?.maxSec !== undefined) return resolveWithLongHides(args);
  const treatments = { ...profile.treatments, 'full-blur': { ...profile.treatments?.['full-blur'], maxSec: 0 } };
  return resolveWithLongHides({ ...args, profile: { ...profile, treatments } });
};

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
    const cues = resolveEffectiveCues({ edl, profile: { categories: { 'sex/sign': { effect: 'blur', regional: true } } }, override });
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

describe('resolveEffectiveCues with scenes', () => {
  const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
  const profile = {
    categories: { language: { effect: 'mute' }, 'violence_blood_gore/graphic': { effect: 'full-blur' }, credits: { effect: 'skip' } },
    treatments: { mute: zero, 'full-blur': zero, skip: zero, 'skip-card': { holdSec: 4.5 } },
    scenes: {
      violence_blood_gore: { blackout: { picture: 2 }, skip: { situation: 3 } },
    },
  };
  const sync = { scale: 1, offsetSec: 10, part: 'p' };
  const scene = (level, extra = {}) => ({
    id: 'sc-va1', in: 100, out: 160, edges: 'cut', cues: ['va1', 'va2'], groups: ['violence_blood_gore'],
    level: { violence_blood_gore: { situation: level[0], picture: level[1] } }, ...extra,
  });
  const edl = (s, calibration = { situation: 'trusted', picture: 'trusted' }) => ({
    timebase: { clock: 'vidangel' },
    sceneCalibration: calibration,
    cues: [
      { id: 'va1', type: 'skip', category: 'violence_blood_gore/graphic', in: 110, out: 112, precision: 'frame' },
      { id: 'va2', type: 'skip', category: 'violence_blood_gore/graphic', in: 140, out: 141, precision: 'frame' },
      { id: 'w1', type: 'mute', category: 'language/x', in: 158, out: 166, precision: 'safe-window' },
      { id: 'cr', type: 'skip', category: 'credits/closing', in: 150, out: 152, precision: 'frame' },
    ],
    scenes: [s],
  });
  const run = (e, override = {}) => resolveEffectiveCues({ edl: e, profile, override: { sync, ...override }, part: 'p' });

  it('blacks out a scene whose picture level meets the threshold and drops its member blurs', () => {
    const out = run(edl(scene([2, 2])));
    const black = out.filter((c) => c.effect === 'blackout');
    expect(black).toHaveLength(1);
    expect(black[0]).toMatchObject({ in: 110, out: 170, scene: 'sc-va1', text: 'Scene hidden.' });
    expect(out.some((c) => c.effect === 'full-blur')).toBe(false);
  });

  it('keeps word mutes whole, and never drops credits', () => {
    const out = run(edl(scene([2, 2])));
    const w = out.find((c) => c.id === 'w1');
    expect(w.in).toBe(168); expect(w.out).toBe(176);
    expect(out.some((c) => c.id === 'cr')).toBe(true);
  });

  it('skips a scene whose situation level meets the skip threshold, with a skip card', () => {
    const [sk] = run(edl(scene([3, 0]))).filter((c) => c.scene);
    expect(sk).toMatchObject({ effect: 'skip-card', in: 110, out: 170, holdSec: 4.5, text: 'Scene skipped.' });
  });

  it('shows only an approved card text, from the override', () => {
    const s = scene([2, 2], { card: { text: 'draft text' } });
    expect(run(edl(s)).find((c) => c.scene).text).toBe('Scene hidden.');
    const out = run(edl(s), { sceneOverrides: { 'sc-va1': { card: { text: 'He gets away.', approvedBy: 'parent', at: '2026-11-06' } } } });
    expect(out.find((c) => c.scene).text).toBe('He gets away.');
  });

  it('leaves member cues alone when the scene earns no effect', () => {
    const out = run(edl(scene([1, 1])));
    expect(out.some((c) => c.scene)).toBe(false);
    expect(out.filter((c) => c.effect === 'full-blur')).toHaveLength(2);
  });

  it('a disabled scene lets its members play by their own rules', () => {
    const out = run(edl(scene([2, 2])), { sceneOverrides: { 'sc-va1': { disabled: true } } });
    expect(out.some((c) => c.scene)).toBe(false);
    expect(out.filter((c) => c.effect === 'full-blur')).toHaveLength(2);
  });

  it('an override effect wins over the profile', () => {
    const out = run(edl(scene([1, 1])), { sceneOverrides: { 'sc-va1': { effect: 'skip' } } });
    expect(out.find((c) => c.scene).effect).toBe('skip-card');
  });

  it('ignores an untrusted axis and reports the fallback', () => {
    const out = run(edl(scene([2, 2]), { situation: 'trusted', picture: 'untrusted' }));
    expect(out.some((c) => c.scene)).toBe(false);
    expect(out.sceneSummary).toMatchObject({ scenes: 1, untrusted: ['picture'], byEffect: {} });
  });

  it('does not drop a stronger cue inside a blackout scene', () => {
    const e = edl(scene([2, 2]));
    e.cues.push({ id: 'x', type: 'skip', category: 'sex_any/sexual_assault', in: 120, out: 125, precision: 'frame' });
    const p = { ...profile, categories: { ...profile.categories, sex_any: { effect: 'skip' } } };
    const out = resolveEffectiveCues({ edl: e, profile: p, override: { sync }, part: 'p' });
    expect(out.some((c) => c.id === 'x' && c.effect === 'skip')).toBe(true);
  });

  it('splits a blackout across a cut this copy lacks', () => {
    const seg = { segments: [{ fromVa: 0, toVa: 130, scale: 1, offsetSec: 10 }, { fromVa: 135, toVa: 9999, scale: 1, offsetSec: 5 }], part: 'p' };
    const out = resolveEffectiveCues({ edl: edl(scene([2, 2])), profile, override: { sync: seg }, part: 'p' });
    const pieces = out.filter((c) => c.effect === 'blackout');
    expect(pieces).toHaveLength(2);
    expect(pieces.filter((c) => c.firstPiece)).toHaveLength(1);
  });
});

describe('scene bridging', () => {
  const profile = { categories: {}, scenes: { violence_blood_gore: { blackout: { picture: 2 } } }, treatments: { 'skip-card': { holdSec: 4.5 } } };
  const sc = (id, a, b, pic = 2, groups = ['violence_blood_gore']) => ({ id, in: a, out: b, cues: [], groups, level: Object.fromEntries(groups.map((g) => [g, { situation: 2, picture: pic }])) });
  const edl = (scenes) => ({ timebase: { clock: 'vidangel' }, sceneCalibration: { situation: 'trusted', picture: 'trusted' }, cues: [], scenes });
  const run = (scenes, override = {}) => resolveEffectiveCues({ edl: edl(scenes), profile, override: { sync: { scale: 1, offsetSec: 0 }, ...override }, part: null }).filter((c) => c.scene);

  it('joins same-group scenes with the same effect across a gap of 30 s or less', () => {
    const out = run([sc('sc-a', 100, 150), sc('sc-b', 172, 200)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ scene: 'sc-a', in: 100, out: 200 });
  });
  it('keeps them apart across a longer gap, a different effect, or no shared group', () => {
    expect(run([sc('sc-a', 100, 150), sc('sc-b', 181, 200)])).toHaveLength(2);
    expect(run([sc('sc-a', 100, 150), sc('sc-b', 160, 200, 1)])).toHaveLength(1);
    const p2 = { ...profile, scenes: { ...profile.scenes, sex_any: { blackout: { picture: 1 } } } };
    const out = resolveEffectiveCues({ edl: edl([sc('sc-a', 100, 150), sc('sc-b', 160, 200, 1, ['sex_any'])]), profile: p2, override: { sync: { scale: 1, offsetSec: 0 } }, part: null }).filter((c) => c.scene);
    expect(out).toHaveLength(2);
  });
  it('a bridged scene shows one approved card, from whichever scene has one', () => {
    const out = run([sc('sc-a', 100, 150), sc('sc-b', 160, 200)], { sceneOverrides: { 'sc-b': { card: { text: 'They get away.' } } } });
    expect(out[0].text).toBe('They get away.');
  });
});

describe('overlapping scenes and an Off ruling', () => {
  it('a scene a grown-up turned off keeps its cues even inside an overlapping scene', () => {
    const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
    const profile = { categories: { 'violence_blood_gore/graphic': { effect: 'full-blur' } }, treatments: { 'full-blur': zero },
      scenes: { violence_blood_gore: { blackout: { picture: 2 } } } };
    const lv = { violence_blood_gore: { situation: 2, picture: 2 } };
    const edl = {
      timebase: { clock: 'vidangel' }, sceneCalibration: { situation: 'trusted', picture: 'trusted' },
      cues: [{ id: 'va5', type: 'skip', category: 'violence_blood_gore/graphic', in: 130, out: 132, precision: 'frame' }],
      scenes: [
        { id: 'sc-va1', in: 100, out: 150, cues: ['va1'], groups: ['violence_blood_gore'], level: lv },
        { id: 'sc-va5', in: 125, out: 140, cues: ['va5'], groups: ['violence_blood_gore'], level: lv },
      ],
    };
    const out = resolveEffectiveCues({ edl, profile, override: { sync: { scale: 1, offsetSec: 0 }, sceneOverrides: { 'sc-va5': { effect: 'off' } } }, part: null });
    expect(out.some((c) => c.id === 'va5' && c.effect === 'full-blur')).toBe(true);
  });
});

describe('channel-matched effects (R1, R2)', () => {
  const regions = Array.from({ length: 26 }, (_, i) => ({ in: 100 + i, cells: [1, 2], grid: 8 }));
  const billboard = {
    id: 'va3388989', type: 'skip', category: 'language/language_sexual/other_sexual', label: 'A billboard shows a crude word',
    in: 100, out: 125, precision: 'frame', segments: [{ in: 100, out: 110 }, { in: 115, out: 125 }], regions,
  };
  const refined = (cues) => ({ timebase: { clock: 'vidangel' }, cues });
  const profile = { categories: { language: { effect: 'bleep', regional: true } } };

  it('a shown cue with a track under profile bleep becomes regional blur, no audio effect', () => {
    const out = resolveEffectiveCues({ edl: refined([billboard]), profile, override: { sync: { offsetSec: 0, scale: 1 } } });
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    expect(out.some((c) => ['bleep', 'mute'].includes(c.effect))).toBe(false);
  });
  it('a coarse-edge cue with a track (refined EDL) gets regional blur over its synced coarse window', () => {
    const coarse = { id: 'va9', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A theater is visible', in: 100, out: 125, precision: 'second-approx',
      regions: [{ in: 100, grid: 6, cells: [4], box: { x: 0.5, y: 0.2, w: 0.2, h: 0.2 } }, { in: 125, cells: [] }], refine: { v: 1, edges: 'coarse' } };
    const out = resolveEffectiveCues({ edl: refined([coarse]), profile: { categories: { sex_any: { effect: 'blur', regional: true } } }, override: { sync: { offsetSec: 8, scale: 1 } } });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    // coarse edges: the window takes the full-blur pads (150 ms lead), so the track is held to 107.85
    expect(Math.min(...out.map((c) => c.in))).toBeCloseTo(107.85, 3);
    expect(Math.max(...out.map((c) => c.out))).toBeCloseTo(133.25, 3);
  });
  it('untracked shown cue becomes full-blur', () => {
    const { regions: _r, ...bare } = billboard;
    const out = resolveEffectiveCues({ edl: refined([bare]), profile });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.effect === 'full-blur')).toBe(true);
  });
  it('a said cue with profile blur becomes mute', () => {
    const edl = { cues: [{ id: 'w', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 10, out: 10.4 }] };
    const out = resolveEffectiveCues({ edl, profile: { categories: { language: { effect: 'blur' } } } });
    expect(out.map((c) => c.effect)).toEqual(['mute']);
  });
  it('override bleep on a shown cue becomes blur', () => {
    const edl = { cues: [{ id: 'v', type: 'skip', category: 'sex/nudity', label: 'Nudity shown', in: 50, out: 60 }] };
    const out = resolveEffectiveCues({ edl, profile: { categories: { sex: { effect: 'skip' } } }, override: { cueOverrides: { v: { effect: 'bleep' } } } });
    expect(out[0].effect).toBe('full-blur');
  });
  it('a word inside a long visual cue keeps its mute', () => {
    const edl = { cues: [
      { id: 'long', type: 'skip', category: 'violence/graphic', label: 'A long fight', in: 100, out: 160 },
      { id: 'word', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 120, out: 120.4 },
    ] };
    const out = resolveEffectiveCues({ edl, profile: { categories: { violence: { effect: 'blur' }, language: { effect: 'mute' } } } });
    expect(out.find((c) => c.id === 'word').effect).toBe('mute');
    expect(out.find((c) => c.id === 'long').effect).toBe('full-blur');
  });
  it('an untracked shown cue with profile blur becomes full-blur', () => {
    const edl = { cues: [{ id: 'u', type: 'skip', category: 'sex/nudity', label: 'Nudity shown', in: 50, out: 60 }] };
    const out = resolveEffectiveCues({ edl, profile: { categories: { sex: { effect: 'blur' } } } });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.effect === 'full-blur')).toBe(true);
  });
  it('a heard cue with profile bleep becomes mute', () => {
    const edl = { cues: [{ id: 'h', type: 'mute', category: 'violence/graphic', label: 'Gunfire can be heard', in: 30, out: 33 }] };
    const out = resolveEffectiveCues({ edl, profile: { categories: { violence: { effect: 'bleep' } } } });
    expect(out.map((c) => c.effect)).toEqual(['mute']);
  });
});

describe('same-subject cues resolve to one effect (R6)', () => {
  const track = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ in: a + i, grid: 6, cells: [8, 9], box: { x: 0.3, y: 0.2, w: 0.3, h: 0.2 } })).concat([{ in: b + 1, cells: [] }]);
  const tag = (id, a, b, over = {}) => ({ id, type: 'skip', category: 'language/language_sexual/other_sexual', label: `tag ${id}`, in: a, out: b, precision: 'frame', subject: 'subject-billboard', ...over });
  const refined = (cues) => ({ timebase: { clock: 'vidangel' }, cues });
  const profile = { categories: { language: { effect: 'bleep', regional: true }, sex_any: { effect: 'blur', regional: true } } };
  const sync = { offsetSec: 0, scale: 1 };
  // BTTF billboard: four tags on one shot, one carries the 6x6 track, categories mixed.
  const bttf = () => [
    tag('va3388987', 100, 112),
    tag('va3388988', 101, 110, { category: 'sex_any/sexually_suggestive' }),
    tag('va3388989', 100, 125, { regions: track(100, 125) }),
    tag('va3388990', 104, 120),
  ];
  it('four tags, one subject, one tracked: exactly one regional blur over the union, no audio effect', () => {
    const out = resolveEffectiveCues({ edl: refined(bttf()), profile, override: { sync } });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    expect(out.some((c) => ['bleep', 'mute', 'duck'].includes(c.effect))).toBe(false);
    expect(new Set(out.map((c) => String(c.id).split('@')[0])).size).toBe(1);
    expect(String(out[0].id)).toMatch(/^subject-billboard/);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);          // no duplicate pieces
    // untracked members keep their full-blur pads (150 ms lead) in the union
    expect(Math.min(...out.map((c) => c.in))).toBeCloseTo(99.85, 3);
    expect(Math.max(...out.map((c) => c.out))).toBeGreaterThanOrEqual(125);
    // no time is covered twice
    const sorted = [...out].sort((a, b) => a.in - b.in);
    sorted.slice(1).forEach((c, i) => expect(c.in).toBeGreaterThanOrEqual(sorted[i].out - 0.5));
  });
  it('without a subject the same tags still never stack: the whole-frame blur wins, the rest is trimmed', () => {
    const cues = bttf().map(({ subject: _s, ...c }) => c);
    const out = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync } });
    expect(pictureOverlaps(out)).toEqual([]);
    for (let t = 100; t < 125; t += 0.05) expect(out.filter((c) => t >= c.in && t < c.out && c.effect !== 'bleep').length).toBeLessThanOrEqual(1);
    const stacked = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync }, stackGuard: false });
    expect(pictureOverlaps(stacked).length).toBeGreaterThan(0);
  });
  it('an untracked group is one full-blur over the union', () => {
    const cues = bttf().map(({ regions: _r, ...c }) => c);
    const out = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'full-blur', id: 'subject-billboard' });
    expect(out[0].in).toBeLessThanOrEqual(100); expect(out[0].out).toBeGreaterThanOrEqual(125);
  });
  it('the track the group uses is the best-tracked member\'s (most keyframes)', () => {
    const boxed = (a, b, box) => track(a, b).map((k) => (k.cells.length ? { ...k, box } : k));
    const A = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }; const B = { x: 0.6, y: 0.5, w: 0.2, h: 0.2 };
    const cues = [tag('a', 100, 110, { regions: boxed(100, 101, A) }), tag('b', 100, 125, { regions: boxed(100, 125, B) })];
    const out = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync } });
    expect(out.length).toBeGreaterThan(10);
    expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    expect(out.every((c) => c.rect.x === B.x && c.rect.y === B.y)).toBe(true);
    for (let t = 100; t < 125; t += 0.1) expect(out.some((c) => t >= c.in && t < c.out)).toBe(true);
  });
  it('a said word inside the union still mutes independently', () => {
    const cues = [...bttf(), { id: 'w', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 110, out: 110.4, precision: 'ms', subject: 'subject-billboard' }];
    const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { language: { effect: 'mute', regional: true }, sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
    expect(out.find((c) => c.id === 'w')).toMatchObject({ effect: 'mute' });
    expect(out.filter((c) => c.effect === 'blur').length).toBeGreaterThan(0);
  });
  it('a track shorter than the union is held over the rest of it', () => {
    const cues = [tag('a', 100, 120, { regions: track(105, 110) }), tag('b', 100, 125)];
    const out = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync } });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    expect(Math.min(...out.map((c) => c.in))).toBeLessThanOrEqual(100.2);
    expect(Math.max(...out.map((c) => c.out))).toBeGreaterThanOrEqual(125);
  });
});

describe('word-sized tones and lines (R3, R4)', () => {
  const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
  const profile = {
    categories: { language: { effect: 'bleep' } },
    treatments: { bleep: zero, mute: zero, 'skip-card': { holdSec: 4.5 } },
  };
  const run = (cues, p = profile) => resolveEffectiveCues({ edl: { cues }, profile: p });
  const word = (o) => ({ type: 'mute', category: 'language/profanity', label: 'damn', ...o });

  it('safe-window word: one tone <= 1.5 s centred on the tag, mute for the rest', () => {
    const out = run([word({ id: 'w', in: 100, out: 106.84, tagIn: 103.4, tagOut: 103.6, precision: 'safe-window' })]);
    const tones = out.filter((c) => c.effect === 'bleep');
    expect(tones).toHaveLength(1);
    expect(tones[0].out - tones[0].in).toBeCloseTo(1.5, 6);
    expect((tones[0].in + tones[0].out) / 2).toBeCloseTo(103.5, 6);
    const mutes = out.filter((c) => c.effect === 'mute');
    expect(mutes).toHaveLength(2);
    expect(mutes[0].in).toBe(100); expect(mutes[0].out).toBeCloseTo(tones[0].in, 6);
    expect(mutes[1].in).toBeCloseTo(tones[0].out, 6); expect(mutes[1].out).toBeCloseTo(106.84, 6);
  });

  it('ms-pinned word: bleep on its span, capped at 1.5 s', () => {
    const out = run([word({ id: 'p', in: 50, out: 50.4, precision: 'ms' }), word({ id: 'long', in: 80, out: 83, precision: 'ms' })]);
    const p = out.find((c) => c.id === 'p');
    expect([p.effect, p.in, p.out]).toEqual(['bleep', 50, 50.4]);
    const long = out.find((c) => c.id === 'long');
    expect(long.out - long.in).toBeCloseTo(1.5, 6);
    expect(out.filter((c) => c.toneRemainder)).toHaveLength(2);
  });

  it('two tones 0.2 s apart merge into one, counted as two words', () => {
    const out = run([word({ id: 'a', in: 10, out: 10.4, precision: 'ms' }), word({ id: 'b', in: 10.6, out: 11, precision: 'ms' })]);
    const tones = out.filter((c) => c.effect === 'bleep');
    expect(tones).toHaveLength(1);
    expect([tones[0].in, tones[0].out]).toEqual([10, 11]);
    expect(filterSummary(out)).toBe('2 words bleeped');
  });

  it('a merged tone over 1.5 s is capped on its midpoint, mute fills the rest', () => {
    const out = run([word({ id: 'a', in: 10, out: 11, precision: 'ms' }), word({ id: 'b', in: 11.1, out: 12.2, precision: 'ms' })]);
    const tone = out.find((c) => c.effect === 'bleep');
    expect(tone.out - tone.in).toBeCloseTo(1.5, 6);
    expect((tone.in + tone.out) / 2).toBeCloseTo(11.1, 6);
    const covered = (t) => out.some((c) => t >= c.in && t < c.out);
    for (let t = 10; t < 12.2; t += 0.05) expect(covered(t)).toBe(true);
  });

  it('a said line of 3 s is muted, never a tone', () => {
    const out = run([{ id: 'l', type: 'mute', category: 'language/x', label: 'He talks about his night out.', in: 20, out: 23, precision: 'ms' }]);
    expect(out).toHaveLength(1);
    expect(out[0].effect).toBe('mute');
  });

  it('a said exchange over 4 s becomes a skip-card with generic text and the profile hold', () => {
    const out = run([{ id: 'x', type: 'mute', category: 'language/x', label: 'They argue about the plan at length.', in: 30, out: 48, precision: 'ms' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'skip-card', text: 'Scene skipped.', holdSec: 4.5, in: 30, out: 48 });
  });

  it('a word label with a tag span over 4 s is an exchange: skip-card', () => {
    const out = run([word({ id: 'wx', label: 'd*mn', in: 40, out: 52, tagIn: 40, tagOut: 52, precision: 'ms' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'skip-card', line: 'exchange', text: 'Scene skipped.' });
  });

  it('a word whose tag is 1 s but whose safe window is 6.84 s stays a word', () => {
    const out = run([word({ id: 'ws', in: 100, out: 106.84, tagIn: 103, tagOut: 104, precision: 'safe-window' })]);
    expect(out.some((c) => c.effect === 'skip-card')).toBe(false);
    expect(out.filter((c) => c.effect === 'bleep')[0].out - out.filter((c) => c.effect === 'bleep')[0].in).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(out.some((c) => c.effect === 'mute')).toBe(true);
  });

  it('a non-word said cue of 3 s is still a mute', () => {
    const out = run([{ id: 'l3', type: 'mute', category: 'language/x', label: 'He talks about his night out.', in: 20, out: 23, precision: 'ms' }]);
    expect(out.map((c) => c.effect)).toEqual(['mute']);
  });

  it('keeps an explicit skip effect on a long line as is', () => {
    const out = run([{ id: 'x', type: 'mute', effect: 'skip', category: 'language/x', label: 'They argue about the plan at length.', in: 30, out: 48 }]);
    expect(out[0].effect).toBe('skip');
  });

  it('merge + re-cap keeps every id unique and leaves no uncovered instant', () => {
    const out = run([word({ id: 'a', in: 10, out: 13, precision: 'ms' }), word({ id: 'b', in: 12.4, out: 12.8, precision: 'ms' })]);
    const ids = out.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tones = out.filter((c) => c.effect === 'bleep');
    expect(tones).toHaveLength(1);
    expect(tones[0].out - tones[0].in).toBeCloseTo(1.5, 6);
    for (let t = 10; t < 13; t += 0.05) expect(out.some((c) => t >= c.in && t < c.out)).toBe(true);
  });

  it('an unlabeled said cue is not a word: bleep profile gives mute, no tone', () => {
    const out = run([{ id: 'u', type: 'mute', category: 'language/x', in: 5, out: 6, precision: 'ms' }]);
    expect(out.map((c) => c.effect)).toEqual(['mute']);
  });

  it('a long exchange with an approved cue card plays a skip-card with that text', () => {
    const edl = { cues: [{ id: 'x', type: 'mute', category: 'language/x', label: 'They argue about the plan at length.', in: 30, out: 48, precision: 'ms' }] };
    const override = { cueOverrides: { x: { card: { text: 'They argue.', approvedBy: 'parent' } } } };
    const out = resolveEffectiveCues({ edl, profile, override });
    expect(out[0]).toMatchObject({ effect: 'skip-card', text: 'They argue.' });
  });

  it('a skip cue with an approved card plays a skip-card with that text (R5)', () => {
    const edl = { cues: [{ id: 'k', type: 'skip', category: 'sex/x', label: 'A kiss.', in: 30, out: 38, precision: 'ms' }] };
    const override = { cueOverrides: { k: { effect: 'skip', card: { text: 'They kiss goodbye.', approvedBy: 'parent' } } } };
    const out = resolveEffectiveCues({ edl, profile, override });
    expect(out[0]).toMatchObject({ effect: 'skip-card', text: 'They kiss goodbye.' });
  });

  it('an unapproved cue card shows the generic text; a cardDraft never plays (R5)', () => {
    const edl = { cues: [{ id: 'k', type: 'skip', category: 'sex/x', label: 'A kiss.', in: 30, out: 38, precision: 'ms' }] };
    const plain = resolveEffectiveCues({ edl, profile, override: { cueOverrides: { k: { effect: 'skip', cardDraft: { text: 'Draft only.' } } } } });
    expect(plain[0].effect).toBe('skip');
    const long = { cues: [{ id: 'x', type: 'mute', category: 'language/x', label: 'They argue about the plan at length.', in: 30, out: 48, precision: 'ms' }] };
    const ex = resolveEffectiveCues({ edl: long, profile, override: { cueOverrides: { x: { cardDraft: { text: 'Draft only.' } } } } });
    expect(ex[0]).toMatchObject({ effect: 'skip-card', text: 'Scene skipped.' });
  });

  it('overlapping capped tones merge with no mute piece overlapping a bleep', () => {
    const out = run([word({ id: 'a', in: 10, out: 13, precision: 'ms' }), word({ id: 'b', in: 10.2, out: 12.2, precision: 'ms' })]);
    const ids = out.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tones = out.filter((c) => c.effect === 'bleep');
    expect(tones).toHaveLength(1);
    expect(tones[0].out - tones[0].in).toBeCloseTo(1.5, 6);
    for (const m of out.filter((c) => c.effect === 'mute')) {
      expect(m.out <= tones[0].in + 1e-9 || m.in >= tones[0].out - 1e-9).toBe(true);
    }
    for (let t = 10; t < 13; t += 0.05) expect(out.some((c) => t >= c.in && t < c.out)).toBe(true);
  });
});

describe('language groups (R9)', () => {
  const word = (id, category, label, extra = {}) => ({ id, type: 'mute', category, label, in: 10, out: 10.4, precision: 'ms', ...extra });
  const effects = (cues, profile, override) => Object.fromEntries(
    resolveEffectiveCues({ edl: { cues }, profile, override }).map((c) => [c.id, c.effect]));
  const profile = {
    categories: {
      'language/profanity': { effect: 'bleep' }, 'language/blasphemy': { effect: 'mute' },
      'language/sexual': { effect: 'mute' }, 'language/slurs': { effect: 'bleep' }, 'language/childish': { effect: 'off' },
    },
  };

  it('each cue takes its own group rule, in either taxonomy', () => {
    const cues = [
      word('a', 'language/profanity/fuck', 'f-word', { in: 10, out: 10.4 }),
      word('b', 'language/blasphemy/god', 'G*d', { in: 20, out: 20.4 }),
      word('c', 'language/vulgarity/ass', 'ass', { in: 30, out: 30.4 }),
      word('d', 'language/racial/spic', 'spic', { in: 40, out: 40.4 }),
      word('e', 'language/childish/jerk', 'jerk', { in: 50, out: 50.4 }),
      word('f', 'language/language_racial/other_racial', 'p*ck*rw**d', { in: 60, out: 60.4 }),
      word('g', 'language/other_childish', 'b*tthead', { in: 70, out: 70.4 }),
    ];
    expect(effects(cues, profile)).toEqual({ a: 'bleep', b: 'mute', c: 'mute', d: 'bleep', f: 'bleep' });
  });

  it('a per-word exception beats the group, both ways', () => {
    const cues = [
      word('damn', 'language/profanity/damn', 'damn', { in: 10, out: 10.4 }),
      word('fuck', 'language/profanity/fuck', 'f-word', { in: 20, out: 20.4 }),
      word('jerk', 'language/childish/jerk', 'jerk', { in: 30, out: 30.4 }),
      word('god', 'language/blasphemy/god', 'G*d', { in: 40, out: 40.4 }),
    ];
    const languageWords = { damn: 'off', jerk: 'mute', god: 'bleep' };
    expect(effects(cues, { ...profile, languageWords })).toEqual({ fuck: 'bleep', jerk: 'mute', god: 'bleep' });
  });

  it('the old single language rule still covers every group; a group rule beats it', () => {
    const cues = [word('a', 'language/racial/spic', 'spic'), word('b', 'language/childish/jerk', 'jerk', { in: 20, out: 20.4 })];
    expect(effects(cues, { categories: { language: { effect: 'mute' } } })).toEqual({ a: 'mute', b: 'mute' });
    expect(effects(cues, { categories: { language: { effect: 'mute' }, 'language/childish': { effect: 'off' } } })).toEqual({ a: 'mute' });
  });

  it('tones keep the word-sized caps on top of the group rule', () => {
    const cues = [word('w', 'language/slurs/x', 'spic', { in: 10, out: 14, precision: 'safe-window', tagIn: 12, tagOut: 12 })];
    const out = resolveEffectiveCues({ edl: { cues: [{ ...cues[0], category: 'language/racial/spic' }] }, profile });
    const tone = out.filter((c) => c.effect === 'bleep');
    expect(tone).toHaveLength(1);
    expect(tone[0].out - tone[0].in).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('a shown language tag stays visual whatever its group says', () => {
    const tag = { id: 't', type: 'skip', category: 'language/language_racial/other_racial', label: 'A sign shows a slur', in: 50, out: 55 };
    expect(effects([tag], profile).t).toBe('full-blur');
  });

  describe('word-list (SRT) cues', () => {
    const srt = (id, category, label, at = 10) => ({ id, effect: 'mute', category, label, in: at, out: at + 0.05, source: 'srt', precision: 'srt-line' });
    const run = (cues, prof, override = {}) => resolveEffectiveCues({ edl: { cues: [] }, profile: prof, override: { addCues: cues, ...override } });

    it('childish off leaves a childish SRT word unmuted; other groups still mute', () => {
      const out = run([srt('srt1000_0', 'language/childish/jerk', 'jerk'), srt('srt2000_0', 'language/profanity/damn', 'damn', 20)], profile);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.id.startsWith('srt2000_0'))).toBe(true);
      expect(out.some((c) => c.effect === 'bleep')).toBe(true); // profanity is bleep in this profile
    });
    it('a racial SRT word under slurs:bleep becomes a capped tone', () => {
      const out = run([srt('srt3000_0', 'language/racial/spic', 'spic')], profile);
      const tones = out.filter((c) => c.effect === 'bleep');
      expect(tones).toHaveLength(1);
      expect(tones[0].out - tones[0].in).toBeLessThanOrEqual(1.5 + 1e-9);
    });
    it('a languageWords exception beats the group for an SRT cue', () => {
      const cues = [srt('srt1000_0', 'language/childish/jerk', 'jerk'), srt('srt2000_0', 'language/profanity/damn', 'damn', 20)];
      const out = run(cues, { ...profile, languageWords: { jerk: 'mute', damn: 'off' } });
      expect(out.map((c) => [c.id, c.effect])).toEqual([['srt1000_0', 'mute']]);
    });
    it('cueOverrides effect still wins; so does a hand-authored addCue effect', () => {
      const out = run([srt('srt1000_0', 'language/childish/jerk', 'jerk')], profile, { cueOverrides: { srt1000_0: { effect: 'mute' } } });
      expect(out.map((c) => c.effect)).toEqual(['mute']);
      const hand = run([{ id: 'h', effect: 'mute', category: 'language/childish/jerk', label: 'jerk', in: 10, out: 10.4 }], profile);
      expect(hand.map((c) => c.effect)).toEqual(['mute']);
    });
    it('a hand-authored mute with an srt-looking id but no source: srt keeps its effect', () => {
      const out = run([{ id: 'srt1', effect: 'mute', category: 'language/childish/jerk', label: 'jerk', in: 10, out: 10.4 }], profile);
      expect(out.map((c) => c.effect)).toEqual(['mute']);
    });
    it('with no profile rules at all a word-list cue keeps its own mute', () => {
      expect(run([srt('srt1000_0', 'language/profanity/damn', 'damn')], {}).map((c) => c.effect)).toEqual(['mute']);
    });
  });

  it('level-2 keys, canonical or aliased, rule their group; canonical wins; invalid word values are ignored', () => {
    const w = (category, label = 'x') => ({ id: 'w', type: 'mute', category, label, in: 10, out: 10.4, precision: 'ms' });
    const eff = (cue, prof) => effects([cue], prof).w;
    expect(eff(w('language/language_racial/other_racial', 'p*ck*rw**d'), { categories: { 'language/language_racial': { effect: 'bleep' }, language: { effect: 'mute' } } })).toBe('bleep');
    expect(eff(w('language/blasphemy/god', 'G*d'), { categories: { 'language/blasphemy': { effect: 'bleep' } } })).toBe('bleep');
    expect(eff(w('language/racial/spic', 'spic'), { categories: { 'language/language_racial': { effect: 'bleep' }, 'language/slurs': { effect: 'mute' } } })).toBe('mute');
    expect(eff(w('language/childish/jerk', 'jerk'), { categories: { 'language/language_childish': { effect: 'off' }, language: { effect: 'mute' } } })).toBeUndefined();
    expect(eff(w('language/profanity/damn', 'damn'), { ...profile, languageWords: { damn: 'loud' } })).toBe('bleep');
  });
});

describe('final review fixes', () => {
  const refined = (cues, extra = {}) => ({ timebase: { clock: 'vidangel' }, cues, ...extra });
  const sync = { offsetSec: 0, scale: 1 };
  const BOX = { x: 0.5, y: 0.2, w: 0.2, h: 0.2 };
  const key = (t, over = {}) => ({ in: t, grid: 6, cells: [4], box: BOX, ...over });
  const VISUAL = new Set(['blur', 'full-blur', 'censor-bar', 'pixelate', 'blackout']);
  const covered = (out, t) => out.some((c) => VISUAL.has(c.effect) && t >= c.in && t < c.out);
  const expectCovered = (out, a, b) => {
    expect(out.length).toBeGreaterThan(0);
    const holes = [];
    for (let t = a; t < b; t += 0.05) if (!covered(out, t)) holes.push(Math.round(t * 100) / 100);
    expect(holes).toEqual([]);
  };

  describe('C1: coarse-edge cue with a track narrower than its window', () => {
    // Coarse cue 100-125; Jev saw the subject 104-118, with an unsure keyframe at 108.
    const coarse = () => ({ id: 'va1', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A theater marquee is visible', in: 100, out: 125, precision: 'second-approx',
      regions: [key(104), key(106), { in: 108, cells: [] }, key(110), key(114), { in: 118, cells: [] }], refine: { v: 1, edges: 'coarse', kind: 'visual' } });
    const profile = { categories: { sex_any: { effect: 'blur', regional: true } } };

    it('every instant of the cue window is covered (never less than the untracked full-blur)', () => {
      const out = resolveEffectiveCues({ edl: refined([coarse()]), profile, override: { sync } });
      expectCovered(out, 100, 125);
      const { regions: _r, refine: _f, ...bare } = coarse();
      const untracked = resolveEffectiveCues({ edl: refined([bare]), profile, override: { sync } });
      expect(Math.min(...out.map((c) => c.in))).toBeLessThanOrEqual(Math.min(...untracked.map((c) => c.in)) + 1e-9);
      expect(Math.max(...out.map((c) => c.out))).toBeGreaterThanOrEqual(Math.max(...untracked.map((c) => c.out)) - 1e-9);
    });
    it('holds the first box back to the window start and the last box forward to its end; an unsure keyframe inside is whole-frame', () => {
      const out = resolveEffectiveCues({ edl: refined([coarse()]), profile, override: { sync } }).sort((a, b) => a.in - b.in);
      expect(out.every((c) => c.effect === 'blur')).toBe(true);
      expect(out[0].rect).toEqual(BOX);
      expect(out[out.length - 1].rect).toEqual(BOX);
      const gap = out.find((c) => c.in <= 109 && c.out > 109);
      expect(gap.rect).toBeUndefined(); // whole picture
    });
  });

  describe('C2: a group resolves to the STRONGEST member effect; blur and full-blur become regional on a track', () => {
    const tracked = Array.from({ length: 16 }, (_, i) => key(105 + i)).concat([{ in: 121, cells: [] }]);
    const n = { id: 'n', type: 'skip', category: 'sex/nudity', label: 'Nudity shown', in: 100, out: 110, precision: 'frame', subject: 'S' };
    const s = { id: 's', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A sign', in: 105, out: 120, precision: 'frame', subject: 'S', regions: tracked };

    it('full-blur member + tracked blur member -> regional heavy blur over the union, never full-frame', () => {
      const out = resolveEffectiveCues({ edl: refined([n, s]), profile: { categories: { sex: { effect: 'full-blur', regional: true }, sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.effect === 'blur' && c.rect && c.heavy)).toBe(true);
      expect(new Set(out.map((c) => String(c.id).split('@')[0]))).toEqual(new Set(['S']));
      expectCovered(out, 100, 120);
    });
    it('a full-blur lead with a track is regional (heavy)', () => {
      const out = resolveEffectiveCues({ edl: refined([{ ...n, regions: tracked }, s]), profile: { categories: { sex: { effect: 'full-blur', regional: true }, sex_any: { effect: 'full-blur', regional: true } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.effect === 'blur' && c.rect && c.heavy)).toBe(true);
    });
    it('blur members with a track stay regional blur, not heavy', () => {
      const out = resolveEffectiveCues({ edl: refined([n, s]), profile: { categories: { sex: { effect: 'blur', regional: true }, sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.effect === 'blur' && !c.heavy)).toBe(true);
      expectCovered(out, 100, 120);
    });
    it('censor-bar beats blur and full-blur on a track and follows it; blackout beats everything', () => {
      const cb = resolveEffectiveCues({ edl: refined([n, s]), profile: { categories: { sex: { effect: 'censor-bar', regional: true }, sex_any: { effect: 'full-blur', regional: true } } }, override: { sync } });
      expect(cb.length).toBeGreaterThan(0);
      expect(cb.every((c) => c.effect === 'censor-bar')).toBe(true);
      expect(cb.some((c) => c.rect)).toBe(true);
      const bo = resolveEffectiveCues({ edl: refined([n, s]), profile: { categories: { sex: { effect: 'blur', regional: true }, sex_any: { effect: 'blackout', regional: true } } }, override: { sync } });
      expect(bo.length).toBeGreaterThan(0);
      expect(bo.every((c) => c.effect === 'blackout')).toBe(true);
      expectCovered(bo, 100, 120);
    });
    it('a track with no sighting is not usable: the group stays full-frame full-blur', () => {
      const blind = [{ in: 105, cells: [] }, { in: 110, cells: [] }, { in: 121, cells: [] }];
      const out = resolveEffectiveCues({ edl: refined([n, { ...s, regions: blind }]), profile: { categories: { sex: { effect: 'full-blur', regional: true }, sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ effect: 'full-blur', id: 'S' });
      expect(out[0].rect).toBeUndefined();
    });
  });

  describe('R2: a tracked shown cue is regional whether its effect is blur or full-blur', () => {
    const tracked = Array.from({ length: 11 }, (_, i) => key(100 + i)).concat([{ in: 111, cells: [] }]);
    const cue = { id: 'v', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A sign', in: 100, out: 111, precision: 'frame', regions: tracked, refine: { v: 1, kind: 'visual' } };
    it('profile full-blur on a tracked cue: regional heavy blur pieces only', () => {
      const out = resolveEffectiveCues({ edl: refined([cue]), profile: { categories: { sex_any: { effect: 'full-blur', regional: true } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(5);
      expect(out.every((c) => c.effect === 'blur' && c.heavy && c.rect)).toBe(true);
    });
    it('a household cueOverrides full-blur on a tracked cue is still regional', () => {
      const out = resolveEffectiveCues({ edl: refined([cue]), profile: { categories: { sex_any: { effect: 'blur' } } }, override: { sync, cueOverrides: { v: { effect: 'full-blur' } } } });
      expect(out.length).toBeGreaterThan(5);
      expect(out.every((c) => c.effect === 'blur' && c.heavy && c.rect)).toBe(true);
    });
    it('tracked shown cue in a category without regional resolves whole-frame', () => {
      const out = resolveEffectiveCues({ edl: refined([cue]), profile: { categories: { sex_any: { effect: 'full-blur' } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0].effect).toBe('full-blur');
      expect(out[0].rect).toBeUndefined();
      expect(out[0].regions).toBeUndefined();
    });
    it('tracked shown cue in a regional category stays regional', () => {
      const gore = { id: 'g', type: 'skip', category: 'violence_blood_gore/gore', label: 'Gore', in: 100, out: 111, precision: 'frame', regions: tracked, refine: { v: 1, kind: 'visual' } };
      const out = resolveEffectiveCues({ edl: refined([gore]), profile: { categories: { 'violence_blood_gore/gore': { effect: 'full-blur', regional: true } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(5);
      expect(out.every((c) => c.effect === 'blur' && c.heavy === true && c.rect)).toBe(true);
    });
    it('a human-ruled blur stays regional', () => {
      const out = resolveEffectiveCues({ edl: refined([cue]), profile: { categories: { sex_any: { effect: 'full-blur' } } }, override: { sync, cueOverrides: { v: { effect: 'blur' } } } });
      expect(out.length).toBeGreaterThan(5);
      expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
    });
    it('a subject group without regional permission resolves whole-frame', () => {
      const a = { ...cue, id: 'a', subject: 'S' };
      const b = { ...cue, id: 'b', subject: 'S', in: 102, out: 108 };
      const out = resolveEffectiveCues({ edl: refined([a, b]), profile: { categories: { sex_any: { effect: 'full-blur' } } }, override: { sync } });
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.effect === 'full-blur' && !c.rect && !c.regions)).toBe(true);
    });
    it('untracked, full-blur stays full-frame', () => {
      const { regions: _r, ...bare } = cue;
      const out = resolveEffectiveCues({ edl: refined([bare]), profile: { categories: { sex_any: { effect: 'full-blur' } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ effect: 'full-blur' });
      expect(out[0].rect).toBeUndefined();
    });
  });

  describe('the BTTF billboard (va3388987-90): only the sign is blurred', () => {
    // 987 carries the track (sign on the right); its siblings carry none. Profile: suggestive
    // -> full-blur, language -> bleep. Times are VidAngel-like second-approx points and spans.
    const SIGN = { x: 0.66, y: 0.17, w: 0.33, h: 0.33 };
    const track = Array.from({ length: 10 }, (_, i) => key(668 + i, { box: SIGN })).concat([{ in: 678, cells: [] }]);
    const cues = () => [
      { id: 'va3388987', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A theater marquee is visible', in: 668.2, out: 674.8, precision: 'frame', subject: 'subject-va3388987', regions: track, refine: { v: 1, kind: 'visual' } },
      { id: 'va3388988', type: 'skip', category: 'sex_any/sexually_suggestive', label: 'A theater marquee is visible', in: 671, out: 671, precision: 'second-approx', subject: 'subject-va3388987' },
      { id: 'va3388989', type: 'skip', category: 'language/language_sexual/other_sexual', label: 'A crude word is visible', in: 668, out: 677, precision: 'second-approx', subject: 'subject-va3388987' },
      { id: 'va3388990', type: 'skip', category: 'language/language_sexual/other_sexual', label: 'A crude word is visible', in: 673, out: 676, precision: 'second-approx', subject: 'subject-va3388987' },
    ];
    const profile = { categories: { 'sex_any/sexually_suggestive': { effect: 'full-blur', regional: true }, language: { effect: 'bleep', regional: true } } };
    const out = () => resolveEffectiveCues({ edl: refined(cues()), profile, override: { sync } });

    it('regional heavy blur pieces only over the shared track; no full-frame piece, no audio effect', () => {
      const o = out();
      expect(o.length).toBeGreaterThan(5);
      expect(o.every((c) => c.effect === 'blur' && c.heavy && c.rect)).toBe(true);
      expect(o.every((c) => c.rect.x === SIGN.x && c.rect.w === SIGN.w)).toBe(true);
      expect(o.some((c) => ['bleep', 'mute', 'duck', 'full-blur'].includes(c.effect))).toBe(false);
      expect(new Set(o.map((c) => String(c.id).split('@')[0]))).toEqual(new Set(['subject-va3388987']));
    });
    it('the sign stays hidden for at least as long as each sibling would hide it alone', () => {
      const o = out();
      for (const sib of cues()) {
        const { subject: _s, regions: _r, ...alone } = sib;
        const solo = resolveEffectiveCues({ edl: refined([alone]), profile, override: { sync } });
        expect(solo.length).toBeGreaterThan(0);
        for (const p of solo) expectCovered(o, p.in, p.out);
      }
    });
  });

  describe('a shared track: a short miss is bridged, a sliver is not a whole-frame flash', () => {
    const A = { x: 0.66, y: 0.17, w: 0.33, h: 0.33 }; const B = { x: 0.66, y: 0.33, w: 0.33, h: 0.33 };
    it('one empty keyframe (<= 1 s) between two sightings holds the box spanning both, not the whole picture', () => {
      const regions = [key(100, { box: A }), key(100.5, { box: A }), { in: 101, cells: [] }, key(101.5, { box: B }), key(102, { box: B }), { in: 102.5, cells: [] }];
      const cues = [{ id: 't', type: 'skip', category: 'sex_any/x', label: 't', in: 100, out: 102.5, precision: 'frame', subject: 'S', regions }];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'full-blur', regional: true } } }, override: { sync } });
      expectCovered(out, 100, 102.5);
      expect(out.every((c) => c.effect === 'blur' && c.rect)).toBe(true);
      const miss = out.find((c) => c.in <= 101.2 && c.out > 101.2);
      expect(miss.rect.x).toBeCloseTo(0.66, 6); expect(miss.rect.y).toBeCloseTo(0.17, 6);
      expect(miss.rect.w).toBeCloseTo(0.33, 6); expect(miss.rect.h).toBeCloseTo(0.49, 6);
    });
    it('a longer miss still hides the whole picture (I3)', () => {
      const regions = [key(100, { box: A }), { in: 100.5, cells: [] }, { in: 101, cells: [] }, { in: 101.5, cells: [] }, key(102, { box: B }), { in: 102.5, cells: [] }];
      const cues = [{ id: 't', type: 'skip', category: 'sex_any/x', label: 't', in: 100, out: 102.5, precision: 'frame', subject: 'S', regions }];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'blur' } } }, override: { sync } });
      expect(out.find((c) => c.in <= 101.2 && c.out > 101.2).rect).toBeUndefined();
    });
    it('a segment that starts a hair before its first sighting holds that box back over the sliver', () => {
      const regions = [key(100, { box: A }), key(102, { box: A }), key(104, { box: A }), { in: 105, cells: [] }, key(108, { box: B }), key(110, { box: B }), key(112, { box: B }), { in: 115, cells: [] }];
      const cues = [{ id: 't', type: 'skip', category: 'sex_any/x', label: 't', in: 100, out: 115, precision: 'frame', subject: 'S', regions, segments: [{ in: 100, out: 105 }, { in: 107.98, out: 115 }] }];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
      expectCovered(out, 100, 105); expectCovered(out, 107.98, 115);
      expect(out.every((c) => c.rect)).toBe(true);
    });
  });

  describe('group union: authored rects and widening', () => {
    it('a censor-bar lead keeps its authored rect only when every member asks for the same effect', () => {
      const rect = { x: 0.1, y: 0.8, w: 0.8, h: 0.1 };
      const cues = [
        { id: 'a', type: 'skip', category: 'sex_any/x', label: 'a', in: 100, out: 110, precision: 'frame', subject: 'S' },
        { id: 'b', type: 'skip', category: 'violence/y', label: 'b', in: 105, out: 115, precision: 'frame', subject: 'S' },
      ];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'censor-bar', regional: true, rect }, violence: { effect: 'pixelate', regional: true } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0].effect).toBe('censor-bar');
      expect(out[0].rect).toBeUndefined(); // b's pixelate covered the whole frame; a bar in a's rect would hide less
      expectCovered(out, 100, 115);
    });
    it('in a trackless group an untracked blur member counts as the full-blur it would play', () => {
      const rect = { x: 0.1, y: 0.8, w: 0.8, h: 0.1 };
      const cues = [
        { id: 'a', type: 'skip', category: 'sex_any/x', label: 'a', in: 100, out: 110, precision: 'frame', subject: 'S' },
        { id: 'b', type: 'skip', category: 'violence/y', label: 'b', in: 105, out: 115, precision: 'frame', subject: 'S' },
      ];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'censor-bar', regional: true, rect }, violence: { effect: 'blur', regional: true } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0].effect).toBe('full-blur');
      expect(out[0].rect).toBeUndefined();
    });
    it('a regional union keeps an untracked point-tag member\'s full-blur pads and minimum width', () => {
      const tr = Array.from({ length: 6 }, (_, i) => key(100 + i)).concat([{ in: 106, cells: [] }]);
      const cues = [
        { id: 't', type: 'skip', category: 'sex_any/x', label: 't', in: 100, out: 106, precision: 'frame', subject: 'S', regions: tr },
        { id: 'p', type: 'skip', category: 'sex_any/x', label: 'p', in: 106, out: 106, precision: 'second-approx', subject: 'S' },
      ];
      const profile = { categories: { sex_any: { effect: 'blur', regional: true } } };
      const out = resolveEffectiveCues({ edl: refined(cues), profile, override: { sync } });
      expect(out.every((c) => c.effect === 'blur')).toBe(true);
      const solo = resolveEffectiveCues({ edl: refined([{ ...cues[1], subject: undefined }]), profile, override: { sync } });
      expect(solo).toHaveLength(1);
      expect(solo[0].out - solo[0].in).toBeGreaterThanOrEqual(3);
      expectCovered(out, solo[0].in, solo[0].out);
    });
  });

  describe('C3: a scene removes a subject piece only where it covers it', () => {
    it('member a in a blackout scene, member b mostly outside: b\'s time outside the scene stays hidden', () => {
      const edl = refined([
        { id: 'a', type: 'skip', category: 'sex/nudity', label: 'a', in: 100, out: 118, precision: 'frame', subject: 'S' },
        { id: 'b', type: 'skip', category: 'sex/nudity', label: 'b', in: 110, out: 140, precision: 'frame', subject: 'S' },
      ], { scenes: [{ id: 'sc1', in: 99, out: 119, edges: 'cut', cues: ['a'], groups: ['sex'] }] });
      const profile = { categories: { sex: { effect: 'full-blur' } }, treatments: { 'full-blur': { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 } } };
      const out = resolveEffectiveCues({ edl, profile, override: { sync, sceneOverrides: { sc1: { effect: 'blackout' } } } });
      expectCovered(out, 99, 140);
      expect(out.filter((c) => c.effect === 'blackout')).toHaveLength(1);
      // nothing of the subject is left under the blackout
      expect(out.filter((c) => c.subject === 'S').every((c) => c.in >= 119 - 1e-9)).toBe(true);
    });
    it('all members in the scene: the subject piece goes', () => {
      const edl = refined([
        { id: 'a', type: 'skip', category: 'sex/nudity', label: 'a', in: 100, out: 110, precision: 'frame', subject: 'S' },
        { id: 'b', type: 'skip', category: 'sex/nudity', label: 'b', in: 105, out: 140, precision: 'frame', subject: 'S' },
      ], { scenes: [{ id: 'sc1', in: 99, out: 141, edges: 'cut', cues: ['a', 'b'], groups: ['sex'] }] });
      const out = resolveEffectiveCues({ edl, profile: { categories: { sex: { effect: 'full-blur' } } }, override: { sync, sceneOverrides: { sc1: { effect: 'blackout' } } } });
      expect(out.map((c) => c.effect)).toEqual(['blackout']);
    });
  });

  describe('I3: a shared group track with gaps covers every member span', () => {
    it('an untracked member inside the track\'s gap, and gaps at the track\'s ends, are covered', () => {
      const regions = [{ in: 100, cells: [] }, key(102), key(104), { in: 106, cells: [] }, { in: 112, grid: 6, cells: null }, key(114), { in: 116, cells: [] }, { in: 120, cells: [] }];
      const cues = [
        { id: 't', type: 'skip', category: 'sex_any/x', label: 't', in: 100, out: 120, precision: 'frame', subject: 'S', regions },
        { id: 'u', type: 'skip', category: 'sex_any/x', label: 'u', in: 107, out: 111, precision: 'frame', subject: 'S' },
        { id: 'v', type: 'skip', category: 'sex_any/x', label: 'v', in: 95, out: 125, precision: 'frame', subject: 'S' },
      ];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'blur', regional: true } } }, override: { sync } });
      expect(out.every((c) => c.effect === 'blur')).toBe(true);
      expectCovered(out, 95, 125);
    });
  });

  describe('M1: an untracked group keeps an authored rect', () => {
    it('censor-bar with a rect stays a bar in that rect', () => {
      const rect = { x: 0.1, y: 0.8, w: 0.8, h: 0.1 };
      const cues = [
        { id: 'a', type: 'skip', category: 'sex_any/x', label: 'a', in: 100, out: 110, precision: 'frame', subject: 'S' },
        { id: 'b', type: 'skip', category: 'sex_any/x', label: 'b', in: 105, out: 115, precision: 'frame', subject: 'S' },
      ];
      const out = resolveEffectiveCues({ edl: refined(cues), profile: { categories: { sex_any: { effect: 'censor-bar', rect } } }, override: { sync } });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ effect: 'censor-bar', rect });
      expect(out[0].in).toBeLessThanOrEqual(100); expect(out[0].out).toBeGreaterThanOrEqual(115);
    });
  });

  describe('M4: lines', () => {
    const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
    it('an overridden bleep on a long line becomes a skip-card', () => {
      const edl = { cues: [{ id: 'x', type: 'mute', category: 'language/x', label: 'They argue about the plan at length.', in: 30, out: 48, precision: 'ms' }] };
      const out = resolveEffectiveCues({ edl, profile: { categories: { language: { effect: 'mute' } } }, override: { cueOverrides: { x: { effect: 'bleep' } } } });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ effect: 'skip-card', line: 'exchange', text: 'Scene skipped.' });
    });
    it('a long heard cue keeps its mute; a long shown cue keeps its visual effect (not lines)', () => {
      const edl = { cues: [
        { id: 'h', type: 'mute', category: 'violence/graphic', label: 'Gunfire can be heard', in: 30, out: 40, precision: 'ms' },
        { id: 's', type: 'skip', category: 'sex/nudity', label: 'Nudity is shown for a while.', in: 50, out: 60, precision: 'ms' },
      ] };
      const out = resolveEffectiveCues({ edl, profile: { categories: { violence: { effect: 'mute' }, sex: { effect: 'full-blur' } }, treatments: { mute: zero, 'full-blur': zero } } });
      expect(out.find((c) => c.id === 'h')).toMatchObject({ effect: 'mute' });
      expect(out.find((c) => c.id === 'h').line).toBeUndefined();
      expect(out.find((c) => c.id === 's')).toMatchObject({ effect: 'full-blur' });
      expect(out.find((c) => c.id === 's').line).toBeUndefined();
    });
  });
});

describe('household nudges (startMs/endMs)', () => {
  const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
  const profile = { categories: { 'language/x': { effect: 'mute' }, 'violence_blood_gore/graphic': { effect: 'full-blur' } },
    treatments: { mute: zero, 'full-blur': zero, skip: zero, 'skip-card': { holdSec: 4.5 } },
    scenes: { violence_blood_gore: { blackout: { picture: 2 }, skip: { situation: 3 } } } };
  const sync = { scale: 1, offsetSec: 2, part: 'p' };
  const edl = {
    timebase: { clock: 'vidangel' }, sceneCalibration: { situation: 'trusted', picture: 'trusted' },
    cues: [
      { id: 'w', type: 'mute', category: 'language/x', in: 12.1, out: 12.5, precision: 'ms' },
      { id: 's', type: 'mute', category: 'language/x', in: 50, out: 57, precision: 'safe-window' },
      { id: 'v', type: 'skip', category: 'violence_blood_gore/graphic', in: 110, out: 112, precision: 'frame' },
    ],
    scenes: [{ id: 'sc1', in: 100, out: 160, edges: 'cut', cues: ['v'], groups: ['violence_blood_gore'],
      level: { violence_blood_gore: { situation: 3, picture: 3 } } }],
  };
  const run = (ov) => resolveEffectiveCues({ edl, profile, override: { sync, ...ov }, part: 'p' });

  it('a nudged ms cue spans the nudge mapped through the sync and is hand-fixed', () => {
    const w = run({ cueOverrides: { w: { startMs: 12000, endMs: 12800 } } }).find((c) => c.id === 'w');
    expect(w.in).toBeCloseTo(14.0, 6);
    expect(w.out).toBeCloseTo(14.8, 6);
    expect(w.handFixed).toBe(true);
  });
  it('a nudged safe-window word mutes only the nudged span', () => {
    const s = run({ cueOverrides: { s: { startMs: 53000, endMs: 53600 } } }).filter((c) => c.id === 's');
    expect(s).toHaveLength(1);
    expect(s[0].effect).toBe('mute');
    expect(s[0].in).toBeCloseTo(55.0, 6);
    expect(s[0].out).toBeCloseTo(55.6, 6);
  });
  it('a nudged scene skips over the nudged span', () => {
    const out = run({ sceneOverrides: { sc1: { startMs: 120000, endMs: 150000 } } });
    const skip = out.find((c) => /skip/.test(c.effect) && c.scene);
    expect(skip.in).toBeCloseTo(122, 6);
    expect(skip.out).toBeCloseTo(152, 6);
  });
  it('a cue without a nudge keeps nudgeMs behaviour', () => {
    const w = run({ cueOverrides: { w: { nudgeMs: 500 } } }).find((c) => c.id === 'w');
    expect(w.in).toBeCloseTo(14.6, 6);
    expect(w.handFixed).toBeUndefined();
  });
});

describe('picture-effect precedence (no stacked blurs)', () => {
  const sync = { offsetSec: 0, scale: 1 };
  const zero = { pad: { in: 0, out: 0 }, minSec: 0 };
  const profile = {
    categories: { sex_any: { effect: 'full-blur', regional: true }, violence: { effect: 'blur' }, language: { effect: 'mute' } },
    treatments: { 'full-blur': zero, blur: zero, mute: zero },
  };
  const shown = (id, a, b, over = {}) => ({ id, type: 'skip', category: 'sex_any/sexually_suggestive', in: a, out: b, precision: 'frame', ...over });
  const track = (a, b) => [{ in: a, grid: 6, cells: [8, 9], box: { x: 0.3, y: 0.2, w: 0.3, h: 0.2 } }, { in: b, cells: [] }];
  const run = (cues, over = {}, prof = profile) => resolveEffectiveCues({ edl: { timebase: { clock: 'vidangel' }, cues }, profile: prof, override: { sync, ...over }, part: 'p' });
  const picture = (out) => out.filter((c) => ['blur', 'full-blur', 'censor-bar', 'pixelate', 'blackout'].includes(c.effect));

  it('a whole-frame blur over a regional heavy blur resolves to the whole-frame blur alone', () => {
    const out = picture(run([
      shown('fb', 100, 110),
      shown('rg', 103, 106, { regions: track(103, 106) }),
    ]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'full-blur' });
    expect(out[0].in).toBeLessThanOrEqual(100); expect(out[0].out).toBeGreaterThanOrEqual(110);
  });
  it('an identical whole-frame pair is one piece', () => {
    const out = picture(run([shown('a', 100, 110), shown('b', 100, 110)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'full-blur' });
    expect(out[0].in).toBeLessThanOrEqual(100); expect(out[0].out).toBeGreaterThanOrEqual(110);
  });
  it('partly overlapping whole-frame blurs merge into one span', () => {
    const out = picture(run([shown('a', 100, 110), shown('b', 105, 120)]));
    expect(out).toHaveLength(1);
    expect(out[0].in).toBeLessThanOrEqual(100); expect(out[0].out).toBeGreaterThanOrEqual(120);
  });
  it('a regional blur sticking out of a whole-frame blur is trimmed to the outside part', () => {
    const out = picture(run([
      shown('fb', 100, 110),
      shown('rg', 108, 115, { regions: track(108, 115) }),
    ]));
    const rg = out.filter((c) => c.effect === 'blur');
    expect(rg).toHaveLength(1);
    const fb = out.find((c) => c.effect === 'full-blur');
    expect(rg[0].in).toBeCloseTo(fb.out, 6);   // starts where the whole-frame blur ends
    expect(rg[0].out).toBeGreaterThan(114.9);
    expect(pictureOverlaps(out)).toEqual([]);
  });
  it('regional blurs in different places never trim one another', () => {
    const other = [{ in: 100, grid: 6, cells: [20], box: { x: 0.7, y: 0.6, w: 0.2, h: 0.2 } }, { in: 110, cells: [] }];
    const out = picture(run([shown('r1', 100, 110, { regions: track(100, 110) }), shown('r2', 100, 110, { regions: other })]));
    expect(new Set(out.map((c) => c.id.split('@')[0]))).toEqual(new Set(['r1', 'r2']));
    expect(out.every((c) => c.in >= 100 && c.out <= 110)).toBe(true);
  });
  it('audio effects are untouched by a picture span over them', () => {
    const word = { id: 'w', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 104, out: 104.4, precision: 'ms' };
    const alone = run([word]).find((c) => c.id === 'w');
    const under = run([shown('fb', 100, 110), word]).find((c) => c.id === 'w');
    expect(under).toEqual(alone);
  });
  it('a skip-card trims a whole-frame blur under it; a skip inside a blackout is not a stack', () => {
    const out = run([shown('fb', 100, 120), shown('sk', 110, 115, { category: 'violence/gore' })], {}, { ...profile, categories: { ...profile.categories, violence: { effect: 'skip' } } });
    const card = out.find((c) => c.effect === 'skip-card' || c.effect === 'skip');
    expect(card).toBeTruthy();
    expect(pictureOverlaps(out)).toEqual([]);
    expect(out.filter((c) => c.effect === 'full-blur').every((c) => c.out <= card.in + 1e-6 || c.in >= card.out - 1e-6)).toBe(true);
    expect(pictureOverlaps([{ id: 'b', effect: 'blackout', in: 0, out: 10 }, { id: 's', effect: 'skip-card', in: 2, out: 4 }])).toEqual([]);
  });
  it('a disabled override cue never resolves, nor adds a stacked piece next to an active one', () => {
    const out = run([shown('on', 100, 110), shown('off', 101, 109)], { cueOverrides: { off: { disabled: true } } });
    expect(out.some((c) => c.id.startsWith('off') || (c.cues || []).includes('off'))).toBe(false);
    expect(picture(out)).toHaveLength(1);
  });
});

describe('hide picture as a per-filter treatment', () => {
  const profile = { categories: { 'violence/gore': { effect: 'blackout' }, language: { effect: 'mute' } } };
  const gore = (over = {}) => ({ id: 'g1', type: 'blur', kind: 'shown', category: 'violence/gore', label: 'gore', in: 100, out: 110, precision: 'ms', ...over });
  const run = (cues, override, prof = profile) => resolveEffectiveCues({ edl: { cues }, profile: prof, override });
  it('a blackout cue resolves with a card', () => {
    const out = run([gore()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'blackout', text: 'Picture hidden.', firstPiece: true, cardSec: 2.5 });
  });
  it('takes the profile treatment text and card seconds', () => {
    const out = run([gore()], undefined, { ...profile, treatments: { blackout: { text: 'Hidden.', cardSec: 3 } } });
    expect(out[0]).toMatchObject({ text: 'Hidden.', cardSec: 3 });
    const sk = run([gore()], undefined, { ...profile, treatments: { 'skip-card': { holdSec: 4 } } });
    expect(sk[0].cardSec).toBe(4);
  });
  it('an approved card text wins', () => {
    const out = run([gore()], { cueOverrides: { g1: { card: { text: 'Hidden for a moment.', approvedBy: 'parent' } } } });
    expect(out[0].text).toBe('Hidden for a moment.');
  });
  it('a segmented blackout cue cards once', () => {
    const out = run([gore()], { cueOverrides: { g1: { in: 100, out: 110, precision: 'ms', segments: [{ in: 100, out: 103 }, { in: 106, out: 110 }] } } });
    expect(out.map((c) => c.firstPiece)).toEqual([true, false]);
    expect(out.every((c) => c.effect === 'blackout')).toBe(true);
  });
  it('audio cues under a blackout still play', () => {
    const word = { id: 'w', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 104, out: 104.4, precision: 'ms' };
    const alone = run([word]).find((c) => c.id === 'w');
    const under = run([gore(), word]).find((c) => c.id === 'w');
    expect(under).toEqual(alone);
    expect(under.effect).toBe('mute');
  });
  it('a human-chosen blackout on a spoken cue still fits to mute (channel rule unchanged)', () => {
    const said = { id: 's', type: 'mute', kind: 'said', category: 'language/profanity/damn', label: 'damn', in: 5, out: 5.4, precision: 'ms' };
    expect(run([said], { cueOverrides: { s: { effect: 'blackout' } } })[0].effect).toBe('mute');
  });
  it('a zero-width second-approx blackout cue widens to at least 3 s and carries the card', () => {
    const out = run([gore({ in: 100, out: 100, precision: 'second-approx' })]);
    expect(out).toHaveLength(1);
    expect(out[0].out - out[0].in).toBeGreaterThanOrEqual(3);
    expect(out[0]).toMatchObject({ effect: 'blackout', text: 'Picture hidden.', firstPiece: true });
  });
  it('hidePiece drops regional fields', () => {
    const p = hidePiece({ id: 'x', effect: 'blur', rect: { x: 0, y: 0, w: 1, h: 1 }, regions: [], heavy: true }, { in: 1, out: 2 }, {});
    expect(p.rect).toBeUndefined(); expect(p.regions).toBeUndefined(); expect(p.heavy).toBeUndefined();
  });
});
