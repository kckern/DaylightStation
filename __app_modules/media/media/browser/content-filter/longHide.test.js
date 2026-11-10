import { describe, it, expect } from 'vitest';
import { convertLongHides } from './longHide.js';
import { resolveEffectiveCues, cuesActiveAt, pictureOverlaps } from './contentFilter.js';

const fb = (id, a, b, extra = {}) => ({ id, effect: 'full-blur', in: a, out: b, ...extra });

describe('convertLongHides', () => {
  it('a 4.9 s full-blur stays a blur', () => {
    const out = [fb('a', 0, 4.9)];
    expect(convertLongHides(out, undefined)).toEqual({ runs: 0, sec: 0 });
    expect(out).toHaveLength(1);
    expect(out[0].effect).toBe('full-blur');
  });
  it('a 6 s full-blur becomes one carded blackout over the same span', () => {
    const out = [fb('a', 10, 16)];
    expect(convertLongHides(out, undefined)).toEqual({ runs: 1, sec: 6 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'blackout', in: 10, out: 16, text: 'Picture hidden.', firstPiece: true, cardSec: 2.5 });
  });
  it('chained short blurs over 5 s convert as one run, bridged gaps included', () => {
    const out = [fb('a', 0, 2), fb('b', 2.5, 4.5), fb('c', 5, 7)];
    convertLongHides(out, undefined);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ effect: 'blackout', in: 0, out: 7, firstPiece: true });
  });
  it('a 2 s clear gap splits runs', () => {
    const out = [fb('a', 0, 4), fb('b', 6, 10)];
    expect(convertLongHides(out, undefined).runs).toBe(0);
    expect(out.map((c) => c.effect)).toEqual(['full-blur', 'full-blur']);
  });
  it('rectless blur counts; regional blur and audio cues are untouched', () => {
    const out = [
      { id: 'r', effect: 'blur', in: 0, out: 3 }, fb('b', 3, 7),
      { id: 'g', effect: 'blur', rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, in: 1, out: 9 },
      { id: 'm', effect: 'mute', in: 0, out: 9 },
    ];
    expect(convertLongHides(out, undefined).runs).toBe(1);
    expect(out.map((c) => c.effect).sort()).toEqual(['blackout', 'blur', 'mute']);
    expect(out.find((c) => c.effect === 'blur').rect).toBeTruthy();
  });
  it('maxSec null or 0 disables; a custom maxSec applies', () => {
    for (const maxSec of [null, 0]) {
      const out = [fb('a', 0, 60)];
      expect(convertLongHides(out, { 'full-blur': { maxSec } }).runs).toBe(0);
      expect(out[0].effect).toBe('full-blur');
    }
    const out = [fb('a', 0, 4)];
    expect(convertLongHides(out, { 'full-blur': { maxSec: 3 } }).runs).toBe(1);
  });
  it('takes blackout text and card seconds from the profile', () => {
    const out = [fb('a', 0, 9)];
    convertLongHides(out, { blackout: { text: 'Hidden.', cardSec: 3 } });
    expect(out[0]).toMatchObject({ text: 'Hidden.', cardSec: 3 });
  });
});

describe('long hides end to end', () => {
  const zero = { padLeadMs: 0, padTrailMs: 0, approxWidthMs: 0 };
  const profile = {
    categories: { violence: { effect: 'full-blur' }, gore: { effect: 'blur', regional: true }, rude: { effect: 'skip' } },
    treatments: { 'full-blur': zero, blur: zero, skip: zero },
  };
  const cue = (id, category, a, b) => ({ id, type: 'skip', category, in: a, out: b, precision: 'frame' });
  const run = (cues, p = profile, override) => resolveEffectiveCues({ edl: { cues }, profile: p, override });

  it('regional blurs under a converted run are removed; one outside stays', () => {
    const rect = { x: 0.4, y: 0.5, w: 0.2, h: 0.2 };
    const human = (id, a, b) => ({ id, category: 'gore', effect: 'blur', rect, in: a, out: b, precision: 'frame' });
    const out = run([cue('v1', 'violence', 0, 8)], profile, { addCues: [human('g1', 1, 3), human('g2', 9, 10)] });
    expect(out.filter((c) => c.effect === 'blackout')).toHaveLength(1);
    expect(out.some((c) => c.id === 'g1')).toBe(false);
    expect(out.some((c) => c.id === 'g2' && c.effect === 'blur')).toBe(true);
    expect(pictureOverlaps(out)).toEqual([]);
  });
  it('a skip inside a converted run still skips; the run still cards once', () => {
    const out = run([cue('v1', 'violence', 0, 8), cue('s1', 'rude', 3, 4)]);
    expect(out.some((c) => c.id === 's1' && c.effect === 'skip')).toBe(true);
    // A skip inside a blackout is deliberate (stacking leaves the pair): the picture stays hidden
    // around the skipped span and the run still cards once.
    const blacks = out.filter((c) => c.effect === 'blackout');
    expect(blacks.filter((c) => c.firstPiece)).toHaveLength(1);
    expect(blacks[0]).toMatchObject({ in: 0, out: 8 });
    expect(pictureOverlaps(out)).toEqual([]);
  });
  it('seeking into the middle of a converted run finds the picture hidden', () => {
    const out = run([cue('v1', 'violence', 0, 8)]);
    expect(cuesActiveAt(out, 5).some((c) => c.effect === 'blackout')).toBe(true);
  });
  it('a scene blackout over the run gives one card', () => {
    const lv = { violence_blood_gore: { situation: 2, picture: 2 } };
    const edl = {
      timebase: { clock: 'vidangel' }, sceneCalibration: { situation: 'trusted', picture: 'trusted' },
      cues: [cue('v1', 'violence', 2, 12)],
      scenes: [{ id: 'sc1', in: 0, out: 20, cues: [], groups: ['violence_blood_gore'], level: lv }],
    };
    const p = { ...profile, scenes: { violence_blood_gore: { blackout: { picture: 2 } } } };
    const out = resolveEffectiveCues({ edl, profile: p, override: { sync: { scale: 1, offsetSec: 0 } }, part: null });
    const cards = out.filter((c) => c.effect === 'blackout' && c.firstPiece);
    expect(cards).toHaveLength(1);
    expect(pictureOverlaps(out)).toEqual([]);
  });
  it('a profile with no treatments uses 5 s; maxSec 0 keeps the blur; stackGuard false skips conversion', () => {
    const bare = { categories: { violence: { effect: 'full-blur' } } };
    expect(run([cue('v1', 'violence', 0, 10)], bare).some((c) => c.effect === 'blackout')).toBe(true);
    expect(run([cue('v1', 'violence', 0, 4)], bare).some((c) => c.effect === 'blackout')).toBe(false);
    const off = { ...profile, treatments: { ...profile.treatments, 'full-blur': { ...zero, maxSec: 0 } } };
    expect(run([cue('v1', 'violence', 0, 30)], off).every((c) => c.effect === 'full-blur')).toBe(true);
    const raw = resolveEffectiveCues({ edl: { cues: [cue('v1', 'violence', 0, 30)] }, profile, stackGuard: false });
    expect(raw.every((c) => c.effect === 'full-blur')).toBe(true);
  });
});
