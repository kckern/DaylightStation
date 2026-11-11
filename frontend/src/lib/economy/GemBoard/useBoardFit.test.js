import { describe, it, expect } from 'vitest';
import { createElement, useRef } from 'react';
import { render } from '@testing-library/react';
import useBoardFit, { fitFontPx, headRowEm, trackSumPx } from './useBoardFit.js';

describe('fitFontPx', () => {
  it('picks the size that fits the tighter of width and height, clamped 12..40', () => {
    expect(fitFontPx({ wEm: 80, hEm: 30 }, { vw: 1920, vh: 1080 })).toBeCloseTo(22.8, 1); // 1824/80
    expect(fitFontPx({ wEm: 40, hEm: 40 }, { vw: 1920, vh: 1080 })).toBeCloseTo(25.65, 1); // 1026/40
    expect(fitFontPx({ wEm: 10, hEm: 10 }, { vw: 1920, vh: 1080 })).toBe(40);
    expect(fitFontPx({ wEm: 500, hEm: 10 }, { vw: 1280, vh: 800 })).toBe(12);
  });
  it('returns null for an unmeasured board (jsdom, hidden)', () => {
    expect(fitFontPx({ wEm: 0, hEm: 0 }, { vw: 1920, vh: 1080 })).toBeNull();
    expect(fitFontPx({ wEm: NaN, hEm: 10 }, { vw: 1920, vh: 1080 })).toBeNull();
  });
});

describe('headRowEm', () => {
  it('is the tallest slanted name plus a margin, never below 3em', () => {
    expect(headRowEm([1.2, 6.4, 3.1])).toBeCloseTo(7.0, 1);
    expect(headRowEm([])).toBe(3);
  });
});

describe('trackSumPx', () => {
  it('adds up a resolved grid-template-columns list', () => {
    expect(trackSumPx('120px 10px 44px 44px')).toBe(218);
    expect(trackSumPx('120.5px 10px')).toBe(130.5);
  });
  it('is 0 for anything unresolved (jsdom hands back the authored string)', () => {
    expect(trackSumPx('max-content var(--gem-gap) repeat(2, var(--gem-col))')).toBe(0);
    expect(trackSumPx('')).toBe(0);
  });
});

describe('useBoardFit', () => {
  it('does nothing where nothing has a size (jsdom): no font size, no head row', () => {
    let seen;
    function Probe() {
      const ref = useRef(null);
      seen = useBoardFit(ref, 'k');
      return createElement('div', { ref, className: 'gem-board__panel' });
    }
    render(createElement(Probe));
    expect(seen).toEqual({ fontPx: null, headEm: null, leanEm: null });
  });
});
