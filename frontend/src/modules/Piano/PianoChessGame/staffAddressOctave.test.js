import { describe, expect, it } from 'vitest';
import { identifyStaffAddress, staffAxisMatch } from './staffAddress.js';
import { buildScheme } from '../game-platform/addressing/buildScheme.js';
import { resolveAddressing } from '../game-platform/addressing/resolveAddressing.js';

/**
 * HALF THE BOARD WAS UNREACHABLE, AND IT LOOKED LIKE A BROKEN PIANO.
 *
 * A dyad axis is eight two-note shapes over a pool that spans an octave
 * INCLUSIVE, so its last slot is the octave of its first: the top four cards
 * come out as octave transpositions of the bottom four. E4+B4 and B4+E5 are
 * different cards on the staff, and were the same key to the matcher, which
 * compared pitch-class sets and took the first hit.
 *
 * Four of eight files and four of eight ranks therefore answered for nothing,
 * and only sixteen of sixty-four squares could be addressed at all.
 */
const dyadScheme = () => buildScheme(
  resolveAddressing({ game: { vocabulary: 'staff', texture: 'dyad', x: { tier: 2 }, y: { tier: 2 } } }),
  { size: 8, seed: 1 },
).scheme;

describe('a dyad axis that contains its own octave', () => {
  const scheme = dyadScheme();

  it('deals shapes whose pitch classes repeat — this is the material, not a bug', () => {
    const pc = (token) => [...new Set(token.map((n) => n % 12))].sort((a, b) => a - b).join(',');
    const keys = scheme.roots.map(pc);
    expect(new Set(keys).size).toBeLessThan(keys.length);
    // ...and they are genuinely different cards: distinct pitches, an octave apart.
    expect(scheme.roots[2]).toEqual([64, 71]);   // E4 + B4
    expect(scheme.roots[6]).toEqual([71, 76]);   // B4 + E5
  });

  it('gives each of the eight files its own slot when played exactly', () => {
    const hit = scheme.roots.map((token) => staffAxisMatch([...token, ...scheme.qualities[0]], scheme).file);
    expect(hit).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives each of the eight ranks its own slot when played exactly', () => {
    const hit = scheme.qualities.map((token) => staffAxisMatch([...scheme.roots[0], ...token], scheme).rank);
    expect(hit).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('reaches the upper card of the colliding pair — the one that could not be played', () => {
    // B4+E5 over the first rank. Before the fix this resolved to file 2 (E4+B4),
    // so the square a child was reading correctly was addressed by somebody else.
    const { square } = identifyStaffAddress([...scheme.roots[6], ...scheme.qualities[0]], scheme);
    const { square: lower } = identifyStaffAddress([...scheme.roots[2], ...scheme.qualities[0]], scheme);
    expect(square).not.toBe(lower);
    expect(square[0]).toBe('g');
    expect(lower[0]).toBe('c');
  });

  it('addresses all sixty-four squares, not sixteen', () => {
    const squares = new Set();
    for (const file of scheme.roots) {
      for (const rank of scheme.qualities) {
        const { square } = identifyStaffAddress([...file, ...rank], scheme);
        if (square) squares.add(square);
      }
    }
    expect(squares.size).toBe(64);
  });

  it('still forgives an octave when nothing else claims those letters', () => {
    // The whole shape an octave high. It matches no card exactly, shares its
    // letters with two, and lands on the nearer — never on whichever was dealt
    // first. This is the same nearness rule the single-note axis has always had.
    const octaveUp = scheme.roots[6].map((n) => n + 12);
    expect(staffAxisMatch([...octaveUp, ...scheme.qualities[0]], scheme).file).toBe(6);
    // The lower card's octave-up lands on the nearer of the two as well, which
    // here is the upper card — nearness, not deal order, and that is the point.
    expect(staffAxisMatch([...scheme.roots[2].map((n) => n + 12), ...scheme.qualities[0]], scheme).file).toBe(6);
    // Downward has no case to test: an octave below the treble axis is under
    // the split, so those notes name a RANK, which is the split doing its job
    // and not this tiebreak failing.
  });

  it('still refuses a hand that names no card at all', () => {
    const matched = staffAxisMatch([61, 66, ...scheme.qualities[0]], scheme);
    expect(matched.fileComplete).toBe(false);
    expect(matched.extra).toEqual([61, 66]);
  });
});
