import { describe, it, expect } from 'vitest';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows, defaultModeIndex, fillDecision }
  from '../../../frontend/src/screen-framework/widgets/artModes.js';

describe('VIEW_MODES', () => {
  it('has five modes in museum→immersive order', () => {
    expect(VIEW_MODES.map((m) => m.name)).toEqual([
      'gallery', 'framed-contain', 'framed-cover', 'bare-contain', 'bare-cover',
    ]);
  });
  it('frame on for 1-3, off for 4-5', () => {
    expect(VIEW_MODES.map((m) => m.frame)).toEqual([true, true, true, false, false]);
  });
  it('placard on for 1-3, off for 4-5', () => {
    expect(VIEW_MODES.map((m) => m.placard)).toEqual([true, true, true, false, false]);
  });
  it('fit per mode', () => {
    expect(VIEW_MODES.map((m) => m.fit)).toEqual([
      'gallery', 'contain', 'cover', 'contain', 'cover',
    ]);
  });
});

describe('modeIndexByName', () => {
  it('finds a mode index', () => { expect(modeIndexByName('bare-cover')).toBe(4); });
  it('defaults to 0 for unknown', () => { expect(modeIndexByName('nope')).toBe(0); });
});

describe('nextMode / prevMode', () => {
  it('advances and wraps', () => {
    expect(nextMode(0)).toBe(1);
    expect(nextMode(4)).toBe(0);
  });
  it('reverses and wraps', () => {
    expect(prevMode(1)).toBe(0);
    expect(prevMode(0)).toBe(4);
  });
});

describe('objectFitWindows', () => {
  const frame = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
  it('single full-window spans the whole stage', () => {
    const [w] = objectFitWindows({ count: 1, frame, fullWindow: true });
    expect(w).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(w.widthPct).toBe(100);
    expect(w.centerXPct).toBe(50);
  });
  it('single framed uses the frame insets', () => {
    const [w] = objectFitWindows({ count: 1, frame, fullWindow: false });
    expect(w).toMatchObject({ top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 });
    expect(w.widthPct).toBeCloseTo(86.5);
    expect(w.centerXPct).toBeCloseTo(50.25);
  });
  it('diptych splits the opening into two equal halves', () => {
    const [a, b] = objectFitWindows({ count: 2, frame, fullWindow: true });
    expect(a.widthPct).toBeCloseTo(50);
    expect(b.widthPct).toBeCloseTo(50);
    expect(a.left).toBe(0);
    expect(b.right).toBe(0);
    expect(a.right).toBeCloseTo(50);
    expect(b.left).toBeCloseTo(50);
  });
});

describe('defaultModeIndex / fillDecision', () => {
  // gold-ornate opening ≈ 2.0:1; GALLERY=0, FRAMED-COVER=2.
  const frame = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
  const GALLERY = modeIndexByName('gallery');
  const COVER = modeIndexByName('framed-cover');
  // App-wide defaults: top/bottom 13%, left/right 25%.
  const V = 0.13, H = 0.25;

  it('off when both budgets 0 → gallery even for a perfect 16:9 single', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [16 / 9], frame })).toBe(GALLERY);
  });
  it('diptychs always start matted in gallery, regardless of budget', () => {
    expect(defaultModeIndex({ mode: 'diptych', ratios: [16 / 9, 1.8], frame, cropV: V, cropH: H })).toBe(GALLERY);
  });
  it('a 16:9 single (needs ~5.5% top/bottom) qualifies → framed-cover', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [16 / 9], frame, cropV: V, cropH: H })).toBe(COVER);
  });
  it('a 1.6 single (needs ~9.9% top/bottom) qualifies → framed-cover', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [1.6], frame, cropV: V, cropH: H })).toBe(COVER);
  });
  it('a 3:2 single (needs ~12.4% top/bottom) qualifies under the 13% budget → framed-cover', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [1.5], frame, cropV: V, cropH: H })).toBe(COVER);
  });
  it('the Westward painting (AR 1.49, needs ~12.69%) qualifies under 13% → framed-cover', () => {
    const d = fillDecision({ mode: 'single', ratios: [3000 / 2014], frame, cropV: V, cropH: H });
    expect(d.axis).toBe('top-bottom');
    expect(d.need * 100).toBeCloseTo(12.69, 1);
    expect(d.index).toBe(COVER);
  });
  it('Embarkation of the Pilgrims (AR 1.51, needs ~12.28%) qualifies under 13%', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [1.51], frame, cropV: V, cropH: H })).toBe(COVER);
  });
  it('a 4:3 single (needs ~16.6%) and squarer stay matted at 13%', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [4 / 3], frame, cropV: V, cropH: H })).toBe(GALLERY);
    expect(defaultModeIndex({ mode: 'single', ratios: [1.31], frame, cropV: V, cropH: H })).toBe(GALLERY);
    expect(defaultModeIndex({ mode: 'single', ratios: [1.19], frame, cropV: V, cropH: H })).toBe(GALLERY);
  });
  it('crop budgets are per-axis: wide art uses the sides budget, not top/bottom', () => {
    // 3.5:1 is wider than the opening → crops left/right (needs ~21.5%): under the
    // 13% top/bottom budget it would fail, but the 25% sides budget admits it.
    const d = fillDecision({ mode: 'single', ratios: [3.5], frame, cropV: V, cropH: H });
    expect(d.axis).toBe('left-right');
    expect(d.index).toBe(COVER);
    // Same AR with the sides budget cut to 13% → over budget, stays matted.
    expect(defaultModeIndex({ mode: 'single', ratios: [3.5], frame, cropV: V, cropH: V })).toBe(GALLERY);
  });
  it('a panorama beyond the sides budget (~4.5:1) stays matted', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [4.5], frame, cropV: V, cropH: H })).toBe(GALLERY);
  });
  it('non-qualifying art falls back to the configured fallback mode', () => {
    // 1:1 square needs ~25% top/bottom — over the 13% budget → falls back.
    expect(defaultModeIndex({ mode: 'single', ratios: [1.0], frame, cropV: V, cropH: H, fallback: 'framed-contain' }))
      .toBe(modeIndexByName('framed-contain'));
  });
});
