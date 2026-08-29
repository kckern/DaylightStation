import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SegmentedSecretText, { activeSegmentsFor } from './SegmentedSecretText.jsx';

describe('SegmentedSecretText', () => {
  it('maps the full clue to segmented glyphs while retaining an accessible label', () => {
    const { container } = render(<SegmentedSecretText text="Moon walk" />);
    expect(screen.getByRole('img', { name: 'Secret clue: MOON WALK' })).toBeInTheDocument();
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(8);
    expect(container.querySelectorAll('polygon.is-signal').length).toBeGreaterThan(20);
    expect(container.querySelectorAll('polygon.is-mask').length).toBeGreaterThan(20);
  });

  it('uses a recognizable sixteen-segment alphabet', () => {
    expect(activeSegmentsFor('A')).toEqual(expect.arrayContaining(['a1', 'a2', 'b', 'e', 'f', 'g1', 'g2']));
    expect(activeSegmentsFor('X')).toEqual(expect.arrayContaining(['h', 'i', 'j', 'k']));
  });
});
