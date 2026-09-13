import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SegmentedSecretText from './SegmentedSecretText.jsx';
import { activeSegmentsFor } from './segmentedSecretGeometry.js';

describe('SegmentedSecretText', () => {
  it('maps the full clue to segmented glyphs while retaining an accessible label', () => {
    const { container } = render(<SegmentedSecretText text="Moon walk" />);
    expect(screen.getByRole('img', { name: 'Secret clue: MOON WALK' })).toBeInTheDocument();
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(48);
    expect(container.querySelectorAll('polygon.is-signal').length).toBeGreaterThan(20);
    expect(container.querySelectorAll('.segmented-secret-text__artifact').length).toBeGreaterThan(100);
    expect(container.querySelectorAll('.segmented-secret-text__word-gap')).toHaveLength(0);
  });

  it('uses the same complete masked field for short words and multiword clues', () => {
    const {container,rerender}=render(<SegmentedSecretText text="CAT"/>);
    const viewBox=container.querySelector('svg').getAttribute('viewBox');
    const noise=container.querySelector('.segmented-secret-text__interference').innerHTML;
    rerender(<SegmentedSecretText text="CARRYING A HEAVY BOX"/>);
    expect(container.querySelector('svg').getAttribute('viewBox')).toBe(viewBox);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(48);
    expect(container.querySelector('.segmented-secret-text__interference').innerHTML).toBe(noise);
    expect(container.querySelectorAll('.segmented-secret-text__space, .segmented-secret-text__word-gap')).toHaveLength(0);
  });

  it('uses a recognizable sixteen-segment alphabet', () => {
    expect(activeSegmentsFor('A')).toEqual(expect.arrayContaining(['a1', 'a2', 'b', 'e', 'f', 'g1', 'g2']));
    expect(activeSegmentsFor('X')).toEqual(expect.arrayContaining(['h', 'i', 'j', 'k']));
  });
});
