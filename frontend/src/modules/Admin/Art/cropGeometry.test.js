import { describe, it, expect } from 'vitest';
import { clampBand, clampPair, pxToBand, bandToPx } from './cropGeometry.js';

describe('clampBand', () => {
  it('keeps margins in [0,90] and the sum ≤ 90', () => {
    expect(clampBand({ top: -5, bottom: 10 })).toEqual({ top: 0, bottom: 10 });
    expect(clampBand({ top: 95, bottom: 0 })).toEqual({ top: 90, bottom: 0 });
    expect(clampBand({ top: 70, bottom: 40 })).toEqual({ top: 70, bottom: 20 }); // sum capped at 90
  });
});

describe('clampPair (axis-agnostic, used for left/right too)', () => {
  it('clamps each to [0,90] and caps the sum at 90', () => {
    expect(clampPair(-5, 10)).toEqual([0, 10]);
    expect(clampPair(95, 0)).toEqual([90, 0]);
    expect(clampPair(70, 40)).toEqual([70, 20]);
  });
});

describe('px ⇄ band (imageHeightPx = 200)', () => {
  it('pxToBand converts top/bottom handle px to margin %', () => {
    expect(pxToBand({ topPx: 20, bottomPx: 40 }, 200)).toEqual({ top: 10, bottom: 20 });
  });
  it('bandToPx is the inverse', () => {
    expect(bandToPx({ top: 10, bottom: 20 }, 200)).toEqual({ topPx: 20, bottomPx: 40 });
  });
});
