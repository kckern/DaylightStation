/**
 * Composite Hero Image Generator
 * @module 0_system/canvas/compositeHero
 *
 * Creates a 1280x720 composite image from multiple source images.
 * Images are placed side-by-side at equal height, cropped at 16:9 right edge.
 */

import { createCanvas, loadImage } from 'canvas';

const HERO_WIDTH = 1280;
const HERO_HEIGHT = 720;

/**
 * Composite multiple image buffers into a single 1280x720 JPEG.
 *
 * Images are scaled to fill the canvas height (720px) and placed left-to-right.
 * Content beyond x=1280 is naturally clipped.
 *
 * @param {Buffer[]} imageBuffers - Array of image buffers (PNG/JPEG). At least 1 required.
 * @param {Object} [options]
 * @param {number} [options.quality=0.85] - JPEG quality (0-1)
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function compositeHeroImage(imageBuffers, options = {}) {
  if (!imageBuffers || imageBuffers.length === 0) {
    throw new Error('compositeHeroImage requires at least 1 image buffer');
  }

  const quality = options.quality ?? 0.85;

  // Load all images
  const images = await Promise.all(
    imageBuffers.map(buf => loadImage(buf))
  );

  // Create canvas
  const canvas = createCanvas(HERO_WIDTH, HERO_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Fill background black (in case images don't cover full width)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, HERO_WIDTH, HERO_HEIGHT);

  // Draw images left-to-right, each scaled to HERO_HEIGHT
  let x = 0;
  for (const img of images) {
    const scale = HERO_HEIGHT / img.height;
    const scaledWidth = Math.round(img.width * scale);
    ctx.drawImage(img, x, 0, scaledWidth, HERO_HEIGHT);
    x += scaledWidth;

    // Stop if we've filled the canvas width
    if (x >= HERO_WIDTH) break;
  }

  // Export as JPEG
  return canvas.toBuffer('image/jpeg', { quality });
}
