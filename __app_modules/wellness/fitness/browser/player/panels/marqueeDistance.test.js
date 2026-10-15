import { describe, it, expect } from 'vitest';
import { marqueeScrollDistance } from './marqueeDistance.js';

describe('marqueeScrollDistance', () => {
  it('scrolls an overflowing title left by exactly its overflow', () => {
    expect(marqueeScrollDistance(200, 320)).toBe(-120);
  });

  it('does not scroll a title that fits', () => {
    expect(marqueeScrollDistance(200, 45)).toBe(0);
    expect(marqueeScrollDistance(200, 200)).toBe(0);
  });

  it('does not scroll when the container is hidden (fullscreen sidebar at width 0)', () => {
    expect(marqueeScrollDistance(0, 45)).toBe(0);
  });

  it('does not scroll on missing measurements', () => {
    expect(marqueeScrollDistance(undefined, 45)).toBe(0);
    expect(marqueeScrollDistance(200, 0)).toBe(0);
  });
});
