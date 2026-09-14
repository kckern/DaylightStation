import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SegmentedSecretText, { balanceSecretLines } from './SegmentedSecretText.jsx';
import { activeSegmentsFor, SEGMENTS } from './segmentedSecretGeometry.js';

describe('SegmentedSecretText', () => {
  it('renders spaces as full masked glyphs so word boundaries are hidden without the decoder', () => {
    const { container } = render(<SegmentedSecretText text="Moon walk" />);
    expect(screen.getByRole('img', { name: 'Secret clue: MOON WALK' })).toBeInTheDocument();
    const glyphs = [...container.querySelectorAll('.segmented-secret-text__glyph')];
    expect(glyphs).toHaveLength(9);
    expect(glyphs.every(glyph => glyph.querySelectorAll('polygon').length === 18)).toBe(true);
    expect(glyphs[4].querySelectorAll('polygon.is-signal')).toHaveLength(0);
    expect(glyphs[4].querySelectorAll('polygon.is-mask')).toHaveLength(18);
    expect(container.querySelectorAll('.segmented-secret-text__space, .segmented-secret-text__word-gap')).toHaveLength(0);
  });

  it('keeps the original per-glyph signal and mask interference', () => {
    const {container}=render(<SegmentedSecretText text="CAT"/>);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(3);
    expect(container.querySelectorAll('polygon.is-signal').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('polygon.is-mask').length).toBeGreaterThan(0);
    expect(container.querySelector('.segmented-secret-text__field')).toBeNull();
  });

  it('varies mask colors at the same segment position across glyphs', () => {
    const { container } = render(<SegmentedSecretText text="AAAA" />);
    const colors = [...container.querySelectorAll('[data-segment="d1"]')]
      .map(segment => segment.style.getPropertyValue('--segment-color'));
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('balances multi-line clues at word boundaries without dropping the masked space', () => {
    expect(balanceSecretLines('BLOWING UP A BALLOON')).toEqual(['BLOWING UP ', 'A BALLOON']);
    expect(balanceSecretLines('LOOKING THROUGH BINOCULARS')).toEqual(['LOOKING THROUGH ', 'BINOCULARS']);
    const { container } = render(<SegmentedSecretText text="Blowing up a balloon" />);
    expect(container.querySelectorAll('.segmented-secret-text__line')).toHaveLength(2);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(20);
  });

  it('uses a recognizable segmented alphabet with an inward-pointing D bowl', () => {
    expect(activeSegmentsFor('A')).toEqual(expect.arrayContaining(['a1', 'a2', 'b', 'e', 'f', 'g1', 'g2']));
    expect(activeSegmentsFor('B')).toEqual(['a1', 'a2', 'b', 'c', 'd1', 'd2', 'e', 'f', 'g1', 'g2']);
    expect(activeSegmentsFor('D')).toEqual(['a1', 'd1', 'e', 'f', 'n', 'o']);
    expect(SEGMENTS.n).toEqual([25, 6, 44, 50]);
    expect(SEGMENTS.o).toEqual([25, 94, 44, 50]);
    expect(activeSegmentsFor('D')).not.toEqual(activeSegmentsFor('O'));
    expect(activeSegmentsFor('K')).toEqual(['e', 'f', 'i', 'k']);
    expect(activeSegmentsFor('V')).toEqual(['h', 'i']);
    expect(activeSegmentsFor('W')).toEqual(['b', 'c', 'e', 'f', 'j', 'k']);
    expect(SEGMENTS.k).toEqual([28, 56, 40, 90]);
    expect(activeSegmentsFor('X')).toEqual(expect.arrayContaining(['h', 'i', 'j', 'k']));
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(activeSegmentsFor(letter).length, `${letter} must have a visible glyph`).toBeGreaterThan(0);
      expect(new Set(activeSegmentsFor(letter)).size, `${letter} must not repeat a segment`).toBe(activeSegmentsFor(letter).length);
    }
  });
});
