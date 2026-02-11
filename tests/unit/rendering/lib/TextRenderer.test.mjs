import { describe, it, expect } from 'vitest';
import { wrapText } from '#rendering/lib/TextRenderer.mjs';

describe('wrapText', () => {
  const mockCtx = (charWidth = 8) => ({
    measureText: (text) => ({ width: text.length * charWidth }),
  });

  it('returns single line when text fits', () => {
    const lines = wrapText(mockCtx(), 'hello world', 200);
    expect(lines).toEqual(['hello world']);
  });

  it('wraps text exceeding maxWidth', () => {
    const lines = wrapText(mockCtx(10), 'one two three four five', 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five');
  });

  it('returns empty array for empty string', () => {
    const lines = wrapText(mockCtx(), '', 200);
    expect(lines).toEqual([]);
  });

  it('handles null/undefined text', () => {
    const lines = wrapText(mockCtx(), null, 200);
    expect(lines).toEqual([]);
  });

  it('handles single long word exceeding maxWidth', () => {
    const lines = wrapText(mockCtx(10), 'superlongword', 50);
    expect(lines).toEqual(['superlongword']);
  });
});
