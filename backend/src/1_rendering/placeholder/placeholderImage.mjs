/**
 * Placeholder image renderer — dark PNG tile with centered label text.
 * @module 1_rendering/placeholder/placeholderImage
 *
 * Pure presentation: the caller resolves WHERE the label font lives (a
 * filesystem path) and passes it in — this module never consults env vars
 * or config for paths.
 */

import { createCanvas, registerFont } from 'canvas';
import { existsSync } from 'node:fs';

// Image generation constants
const SIZE = 500;
const INITIAL_FONT_SIZE = 32;
const MIN_FONT_SIZE = 12;
const FONT_SIZE_STEP = 2;
const TEXT_PADDING = 40;

// node-canvas font registration is process-global and must happen before any
// canvas is created; register each supplied face at most once.
const registeredFontPaths = new Set();

function ensureFontRegistered(fontPath) {
  if (!fontPath || registeredFontPaths.has(fontPath)) return;
  registeredFontPaths.add(fontPath);
  try {
    if (existsSync(fontPath)) {
      registerFont(fontPath, { family: 'Roboto Condensed' });
    }
  } catch (err) {
    console.warn('placeholderImage: Failed to register Roboto Condensed font:', err.message);
  }
}

/**
 * Generate a placeholder PNG with the media path displayed
 * @param {string} displayText - Text to show (e.g., "sfx/intro")
 * @param {Object} [options]
 * @param {string} [options.fontPath] - Absolute path to the Roboto Condensed
 *   face to register (resolved by the caller). Falls back to system fonts
 *   when omitted or missing.
 * @returns {Buffer} PNG image buffer
 */
export function generatePlaceholderImage(displayText, { fontPath } = {}) {
  // Input validation with fallback
  if (!displayText || typeof displayText !== 'string') {
    displayText = 'unknown';
  }

  ensureFontRegistered(fontPath);

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
