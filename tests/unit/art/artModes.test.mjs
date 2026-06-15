import { describe, it, expect } from 'vitest';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows }
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
