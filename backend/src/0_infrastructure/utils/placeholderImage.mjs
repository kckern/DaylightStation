import { createCanvas, registerFont } from 'canvas';
import path from 'path';
import { fileExists } from './FileIO.mjs';

// Image generation constants
const SIZE = 500;
const INITIAL_FONT_SIZE = 32;
const MIN_FONT_SIZE = 12;
const FONT_SIZE_STEP = 2;
const TEXT_PADDING = 40;

// Attempt to register Roboto Condensed font
const mediaPath = process.env.path?.media || process.env.MEDIA_PATH || '/data/media';
const fontPath = path.join(mediaPath, 'fonts/RobotoCondensed-Regular.ttf');

try {
  if (fileExists(fontPath)) {
    registerFont(fontPath, { family: 'Roboto Condensed' });
  }
} catch (err) {
  console.warn('placeholderImage: Failed to register Roboto Condensed font:', err.message);
}

/**
 * Generate a placeholder PNG with the media path displayed
 * @param {string} displayText - Text to show (e.g., "sfx/intro")
 * @returns {Buffer} PNG image buffer
 */
export function generatePlaceholderImage(displayText) {
  // Input validation with fallback
  if (!displayText || typeof displayText !== 'string') {
    displayText = 'unknown';
  }

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // White text, centered
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Scale font to fit (start at initial size, shrink if needed)
  let fontSize = INITIAL_FONT_SIZE;
  ctx.font = `${fontSize}px "Roboto Condensed", sans-serif`;
  while (ctx.measureText(displayText).width > SIZE - TEXT_PADDING && fontSize > MIN_FONT_SIZE) {
    fontSize -= FONT_SIZE_STEP;
    ctx.font = `${fontSize}px "Roboto Condensed", sans-serif`;
  }

  ctx.fillText(displayText, SIZE / 2, SIZE / 2);

  return canvas.toBuffer('image/png');
}
