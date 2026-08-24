import { describe, expect, it } from 'vitest';
import { normalizeMaskPixels } from './decoderPixels.js';

describe('decoder image normalization', () => {
  it('uses a runtime-derived threshold and emits a two-tone mask', () => {
    const input = { data: new Uint8ClampedArray([
      10, 10, 10, 255, 30, 30, 30, 255, 220, 220, 220, 255, 250, 250, 250, 255,
    ]), width: 4, height: 1 };
    const output = normalizeMaskPixels(input);
    expect([...output.data]).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  });
});
