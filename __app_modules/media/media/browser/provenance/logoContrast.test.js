import { describe, it, expect } from 'vitest';
import { meanLuminance, contrastOnField, needsPlate } from './logoContrast.js';

const px = (r, g, b, a = 255, count = 4) => Array.from({ length: count }, () => [r, g, b, a]).flat();

describe('logoContrast', () => {
  it('white is readable, Disney navy is not', () => {
    expect(needsPlate(px(255, 255, 255))).toBe(false);
    expect(needsPlate(px(0x11, 0x3c, 0xcf))).toBe(true); // Disney+ blue
    expect(needsPlate(px(0x0f, 0x0f, 0x0f))).toBe(true); // near-black
  });
  it('bright brand colours pass', () => {
    expect(needsPlate(px(0xe5, 0x09, 0x14))).toBe(false); // Netflix red
    expect(needsPlate(px(0xff, 0xff, 0x13))).toBe(false); // Tubi yellow
  });
  it('ignores transparent pixels', () => {
    const mostlyClear = [...px(0, 0, 0, 0, 50), ...px(255, 255, 255, 255, 2)];
    expect(needsPlate(mostlyClear)).toBe(false);
    expect(meanLuminance(px(0, 0, 0, 0))).toBeNull();
    expect(needsPlate(px(0, 0, 0, 0))).toBe(false);
  });
  it('computes WCAG contrast against the field', () => {
    expect(contrastOnField(1)).toBeCloseTo(20.2, 0);
  });
});
