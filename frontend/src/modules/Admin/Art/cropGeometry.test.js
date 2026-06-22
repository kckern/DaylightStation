import { describe, it, expect } from 'vitest';
import { clampBand, pxToBand, bandToPx } from './cropGeometry.js';

describe('clampBand', () => {
  it('keeps margins in [0,90] and the sum ≤ 90', () => {
    expect(clampBand({ top: -5, bottom: 10 })).toEqual({ top: 0, bottom: 10 });
    expect(clampBand({ top: 95, bottom: 0 })).toEqual({ top: 90, bottom: 0 });
    expect(clampBand({ top: 70, bottom: 40 })).toEqual({ top: 70, bottom: 20 }); // sum capped at 90
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
