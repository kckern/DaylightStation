import { describe, it, expect } from 'vitest';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows, defaultModeIndex }
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

describe('defaultModeIndex', () => {
  // gold-ornate opening ≈ 2.0:1; GALLERY=0, FRAMED-COVER=2.
  const frame = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
  const GALLERY = modeIndexByName('gallery');
  const COVER = modeIndexByName('framed-cover');

  it('off by default (fillCrop 0) → gallery even for a perfect 16:9 single', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [16 / 9], frame })).toBe(GALLERY);
  });
  it('diptychs always start matted in gallery, regardless of budget', () => {
    expect(defaultModeIndex({ mode: 'diptych', ratios: [16 / 9, 1.8], frame, fillCrop: 0.125 })).toBe(GALLERY);
  });
  it('a 16:9 single qualifies at 12.5% (needs ~5.5%) → framed-cover', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [16 / 9], frame, fillCrop: 0.125 })).toBe(COVER);
  });
  it('a 3:2 single is at the 12.5% edge (~12.45%) → framed-cover', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [1.5], frame, fillCrop: 0.125 })).toBe(COVER);
  });
  it('a 4:3 single needs ~16.6% → stays matted (gallery)', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [4 / 3], frame, fillCrop: 0.125 })).toBe(GALLERY);
  });
  it('a wider-than-opening single (2.5:1) crops the sides and qualifies', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [2.5], frame, fillCrop: 0.125 })).toBe(COVER);
  });
  it('a tighter budget (8%) excludes 3:2 but keeps 16:9', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [1.5], frame, fillCrop: 0.08 })).toBe(GALLERY);
    expect(defaultModeIndex({ mode: 'single', ratios: [16 / 9], frame, fillCrop: 0.08 })).toBe(COVER);
  });
  it('non-qualifying art falls back to the configured fallback mode', () => {
    expect(defaultModeIndex({ mode: 'single', ratios: [4 / 3], frame, fillCrop: 0.125, fallback: 'framed-contain' }))
      .toBe(modeIndexByName('framed-contain'));
  });
});
