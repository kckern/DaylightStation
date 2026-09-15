import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SegmentedSecretText, { balanceSecretLines } from './SegmentedSecretText.jsx';
import { activeSegmentsFor, SEGMENTS } from './segmentedSecretGeometry.js';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from './segmentedSecretPalette.js';
import { FLICKER_TICK_MS } from './segmentFlicker.js';

const SIGNAL = new Set(SIGNAL_SEGMENT_COLORS.map(segmentColorValue));
const MASK = new Set(MASK_SEGMENT_COLORS.map(segmentColorValue));
const colorOf = polygon => polygon.style.getPropertyValue('--segment-color');
const inOwnFamily = polygon => (polygon.classList.contains('is-signal') ? SIGNAL : MASK).has(colorOf(polygon));

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

  it('varies mask colors at the same segment position across glyphs', () => {
    const { container } = render(<SegmentedSecretText text="AAAA" />);
    const colors = [...container.querySelectorAll('[data-segment="d1"]')]
      .map(segment => segment.style.getPropertyValue('--segment-color'));
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('balances multi-line clues at word boundaries and trims only line-edge spaces', () => {
    expect(balanceSecretLines('BLOWING UP A BALLOON')).toEqual(['BLOWING UP', 'A BALLOON']);
    expect(balanceSecretLines('LOOKING THROUGH BINOCULARS')).toEqual(['LOOKING THROUGH', 'BINOCULARS']);
    expect(balanceSecretLines('BUILDING A SAND CASTLE').every(line => line === line.trim())).toBe(true);
    const { container } = render(<SegmentedSecretText text="Blowing up a balloon" />);
    expect(container.querySelectorAll('.segmented-secret-text__line')).toHaveLength(2);
    expect(container.querySelectorAll('.segmented-secret-text__glyph')).toHaveLength(19);
  });

  it('uses a recognizable segmented alphabet with a lowercase-style D', () => {
    expect(activeSegmentsFor('A')).toEqual(expect.arrayContaining(['a1', 'a2', 'b', 'e', 'f', 'g1', 'g2']));
    expect(activeSegmentsFor('D')).toEqual(['b', 'c', 'd1', 'd2', 'e', 'g1', 'g2']);
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

  it('draws B with diagonals meeting at the center so it cannot be read as 8', () => {
    expect(activeSegmentsFor('B')).toEqual(['a1', 'a2', 'd1', 'd2', 'e', 'f', 'g1', 'i', 'k']);
    expect(SEGMENTS.i).toEqual([40, 10, 28, 44]);
    expect(activeSegmentsFor('B')).not.toEqual(activeSegmentsFor('8'));
  });
});

describe('SegmentedSecretText color flicker', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('changes one third of the segments per tick, each to a new color in its own family', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" />);
    const polygons = [...container.querySelectorAll('polygon')];
    const initial = polygons.map(colorOf);
    expect(polygons.every(inOwnFamily)).toBe(true);

    vi.advanceTimersByTime(FLICKER_TICK_MS);
    const changed = polygons.filter((polygon, index) => colorOf(polygon) !== initial[index]);
    expect(changed).toHaveLength(polygons.length / 3);

    vi.advanceTimersByTime(FLICKER_TICK_MS * 2);
    polygons.forEach((polygon, index) => {
      expect(colorOf(polygon)).not.toBe(initial[index]);
      expect(inOwnFamily(polygon)).toBe(true);
    });
  });

  it('never leaves a segment in the wrong family when the clue changes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<SegmentedSecretText text="CAT" />);
    vi.advanceTimersByTime(FLICKER_TICK_MS * 7);
    rerender(<SegmentedSecretText text="BOX" />);
    expect([...container.querySelectorAll('polygon')].every(inOwnFamily)).toBe(true);
  });

  it('keeps colors still when the viewer prefers reduced motion', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', query => ({
      matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {},
    }));
    const { container } = render(<SegmentedSecretText text="CAT" />);
    const polygons = [...container.querySelectorAll('polygon')];
    const initial = polygons.map(colorOf);
    vi.advanceTimersByTime(FLICKER_TICK_MS * 9);
    expect(polygons.map(colorOf)).toEqual(initial);
  });
});
