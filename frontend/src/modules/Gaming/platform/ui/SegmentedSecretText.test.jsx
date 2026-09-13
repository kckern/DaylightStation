import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SegmentedSecretText, { balanceSecretLines } from './SegmentedSecretText.jsx';
import { activeSegmentsFor } from './segmentedSecretGeometry.js';

describe('SegmentedSecretText', () => {
  it('renders spaces as full masked glyphs so word boundaries are hidden without the decoder', () => {
    const { container } = render(<SegmentedSecretText text="Moon walk" />);
    expect(screen.getByRole('img', { name: 'Secret clue: MOON WALK' })).toBeInTheDocument();
    const glyphs = [...container.querySelectorAll('.segmented-secret-text__glyph')];
    expect(glyphs).toHaveLength(9);
    expect(glyphs.every(glyph => glyph.querySelectorAll('polygon').length === 16)).toBe(true);
    expect(glyphs[4].querySelectorAll('polygon.is-signal')).toHaveLength(0);
    expect(glyphs[4].querySelectorAll('polygon.is-mask')).toHaveLength(16);
    expect(container.querySelectorAll('.segmented-secret-text__space, .segmented-secret-text__word-gap')).toHaveLength(0);
  });

  it('keeps the original per-glyph signal and mask interference', () => {
    const {container}=render(<SegmentedSecretText text="CAT"/>);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(3);
    expect(container.querySelectorAll('polygon.is-signal').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('polygon.is-mask').length).toBeGreaterThan(0);
    expect(container.querySelector('.segmented-secret-text__field')).toBeNull();
  });

  it('balances multi-line clues at word boundaries without dropping the masked space', () => {
    expect(balanceSecretLines('BLOWING UP A BALLOON')).toEqual(['BLOWING UP ', 'A BALLOON']);
    expect(balanceSecretLines('LOOKING THROUGH BINOCULARS')).toEqual(['LOOKING THROUGH ', 'BINOCULARS']);
    const { container } = render(<SegmentedSecretText text="Blowing up a balloon" />);
    expect(container.querySelectorAll('.segmented-secret-text__line')).toHaveLength(2);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(20);
  });

  it('uses a recognizable sixteen-segment alphabet', () => {
    expect(activeSegmentsFor('A')).toEqual(expect.arrayContaining(['a1', 'a2', 'b', 'e', 'f', 'g1', 'g2']));
    expect(activeSegmentsFor('B')).toEqual(['a1', 'a2', 'b', 'c', 'd1', 'd2', 'e', 'f', 'g1', 'g2']);
    expect(activeSegmentsFor('X')).toEqual(expect.arrayContaining(['h', 'i', 'j', 'k']));
  });
});
