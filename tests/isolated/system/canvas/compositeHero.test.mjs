import { jest, describe, test, expect } from '@jest/globals';
import { createCanvas } from 'canvas';
import { compositeHeroImage } from '../../../../backend/src/0_system/canvas/compositeHero.mjs';

describe('compositeHeroImage', () => {
  /**
   * Helper: create a solid-color PNG buffer at given dimensions.
   */
  function makeTestImage(width, height, color = '#ff0000') {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas.toBuffer('image/png');
  }

  test('produces a 1280x720 JPEG buffer from 3 images', async () => {
    const cover = makeTestImage(400, 600, '#ff0000');
    const page1 = makeTestImage(400, 600, '#00ff00');
    const page2 = makeTestImage(400, 600, '#0000ff');

    const result = await compositeHeroImage([cover, page1, page2]);

    // Check it's a JPEG (starts with FF D8 FF)
    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);
    expect(result[2]).toBe(0xFF);

    // Verify dimensions by loading back
    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('handles 2 images (page+1 missing)', async () => {
    const cover = makeTestImage(400, 600, '#ff0000');
    const page1 = makeTestImage(400, 600, '#00ff00');

    const result = await compositeHeroImage([cover, page1]);

    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);

    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('handles 1 image (cover-only fallback)', async () => {
    const page1 = makeTestImage(400, 600, '#00ff00');

    const result = await compositeHeroImage([page1]);

    expect(result[0]).toBe(0xFF);
    expect(result[1]).toBe(0xD8);

    const { loadImage: li } = await import('canvas');
    const img = await li(result);
    expect(img.width).toBe(1280);
    expect(img.height).toBe(720);
  });

  test('throws on empty array', async () => {
    await expect(compositeHeroImage([])).rejects.toThrow();
  });
});
