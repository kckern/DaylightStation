import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MASK_RED_MAX, MASK_SEGMENT_COLORS, SIGNAL_RED_MIN, SIGNAL_SEGMENT_COLORS } from './segmentedSecretPalette.js';

const tokens = readFileSync(fileURLToPath(new URL('./_tokens.scss', import.meta.url)), 'utf8');

function hexFor(token) {
  return tokens.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1].toLowerCase();
}

const redOf = (hex) => parseInt(hex.slice(1, 3), 16);

describe('segmented secret palette', () => {
  it('defines every palette token as a six-digit hex color', () => {
    for (const { token } of [...SIGNAL_SEGMENT_COLORS, ...MASK_SEGMENT_COLORS]) {
      expect(hexFor(token), `${token} must be defined in _tokens.scss`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps signal colors bright through a red filter', () => {
    for (const { name, token } of SIGNAL_SEGMENT_COLORS) {
      expect(redOf(hexFor(token)), `${name} must keep full red`).toBeGreaterThanOrEqual(SIGNAL_RED_MIN);
    }
  });

  it('keeps mask colors dark through a red filter', () => {
    for (const { name, token } of MASK_SEGMENT_COLORS) {
      expect(redOf(hexFor(token)), `${name} must keep red low`).toBeLessThanOrEqual(MASK_RED_MAX);
    }
  });

  it('gives every color a distinct value so a change is visible', () => {
    const signal = SIGNAL_SEGMENT_COLORS.map(({ token }) => hexFor(token));
    const mask = MASK_SEGMENT_COLORS.map(({ token }) => hexFor(token));
    expect(new Set(signal).size).toBe(signal.length);
    expect(new Set(mask).size).toBe(mask.length);
  });
});
