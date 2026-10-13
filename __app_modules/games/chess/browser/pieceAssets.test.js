import { describe, it, expect } from 'vitest';
import { pieceSource } from './pieceAssets.js';

describe('pieceAssets', () => {
  it('maps every piece/colour/orientation to a /vendor/chess/pieces URL', () => {
    const urls = new Set();
    for (const rotated of [false, true]) {
      for (const color of ['w', 'b']) {
        for (const kind of ['P', 'N', 'B', 'R', 'Q', 'K']) {
          const url = pieceSource(`${color}${kind}`, { rotated });
          expect(url).toMatch(/^\/vendor\/chess\/pieces\/[a-z-]+_(light|dark)_none\.svg$/);
          urls.add(url);
        }
      }
    }
    expect(urls.size).toBe(24);
  });

  it('uses the repo file naming and light/dark colour mapping', () => {
    expect(pieceSource('wP')).toBe('/vendor/chess/pieces/pawn_light_none.svg');
    expect(pieceSource('bK', { rotated: true })).toBe('/vendor/chess/pieces/king-rot_dark_none.svg');
  });

  it('returns null for non-piece codes', () => {
    expect(pieceSource('zz')).toBeNull();
  });
});
