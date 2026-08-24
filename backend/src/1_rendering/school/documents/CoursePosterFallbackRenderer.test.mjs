import { describe, it, expect } from 'vitest';
import { loadImage } from 'canvas';
import { renderCoursePosterFallback } from './CoursePosterFallbackRenderer.mjs';

describe('renderCoursePosterFallback', () => {
  it('returns a deterministic decodable 2:3 JPEG', async () => {
    const first = renderCoursePosterFallback('missing-course');
    const second = renderCoursePosterFallback('missing-course');
    expect(first.equals(second)).toBe(true);
    expect([...first.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const image = await loadImage(first);
    expect([image.width, image.height]).toEqual([600, 900]);
  });
});
