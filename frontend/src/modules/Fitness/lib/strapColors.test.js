import {
  heartEmojiForColor,
  cssColorForStrap,
  hashColorForDevice,
  strapLabel
} from './strapColors.js';

describe('heartEmojiForColor', () => {
  it('maps the classic colors', () => {
    expect(heartEmojiForColor('red')).toBe('❤️');
    expect(heartEmojiForColor('green')).toBe('💚');
  });
  it('maps the configured guest-slot colors (audit N1)', () => {
    expect(heartEmojiForColor('purple')).toBe('💜');
    expect(heartEmojiForColor('beige')).toBe('🤎');
    expect(heartEmojiForColor('teal')).toBe('🩵');
  });
  it('is case-insensitive and falls back to orange', () => {
    expect(heartEmojiForColor('PURPLE')).toBe('💜');
    expect(heartEmojiForColor('chartreuse')).toBe('🧡');
    expect(heartEmojiForColor(null)).toBe('🧡');
  });
});

describe('cssColorForStrap', () => {
  it('returns a hex for known colors and null for unknown', () => {
    expect(cssColorForStrap('purple')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cssColorForStrap('teal')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(cssColorForStrap('nope')).toBeNull();
    expect(cssColorForStrap(undefined)).toBeNull();
  });
});

describe('hashColorForDevice', () => {
  it('is deterministic per device id', () => {
    expect(hashColorForDevice('51234')).toBe(hashColorForDevice('51234'));
  });
  it('differs across nearby ids', () => {
    expect(hashColorForDevice('51234')).not.toBe(hashColorForDevice('51235'));
  });
  it('returns an hsl() string', () => {
    expect(hashColorForDevice('99999')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });
});

describe('strapLabel', () => {
  it('formats a human label', () => {
    expect(strapLabel('purple')).toBe('Purple strap');
    expect(strapLabel('TEAL')).toBe('Teal strap');
  });
  it('returns null without a color', () => {
    expect(strapLabel(null)).toBeNull();
  });
});
