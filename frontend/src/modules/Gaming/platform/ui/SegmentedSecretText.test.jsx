import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SegmentedSecretText, { balanceSecretLines } from './SegmentedSecretText.jsx';
import { activeSegmentsFor, SEGMENTS, SEGMENT_NEIGHBORS } from './segmentedSecretGeometry.js';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from './segmentedSecretPalette.js';
import { FLICKER_TICK_MS } from './segmentFlicker.js';
import { SECRET_TEXT_MOTION_MS, SECRET_TEXT_MOTION_X, SECRET_TEXT_MOTION_Y } from './segmentedSecretMotion.js';

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

describe('SegmentedSecretText position jump', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const offsets = card => card.style.transform.match(/^translate3d\((-?[\d.]+)%, (-?[\d.]+)%, 0(?:px)?\)$/)?.slice(1).map(Number);

  it('moves the whole card to the opposite edge every second, inside its margin', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="Moon walk" />);
    const card = screen.getByRole('img', { name: 'Secret clue: MOON WALK' });
    expect(card).toHaveAttribute('data-motion-index', '0');
    let [x, y] = offsets(card);
    for (let tick = 1; tick <= 9; tick += 1) {
      vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS);
      expect(card).toHaveAttribute('data-motion-index', String(tick % 8));
      const [nextX, nextY] = offsets(card);
      expect(Math.sign(nextX)).toBe(-Math.sign(x));
      expect(Math.abs(nextX)).toBeLessThanOrEqual(SECRET_TEXT_MOTION_X);
      expect(Math.abs(nextY)).toBeLessThanOrEqual(SECRET_TEXT_MOTION_Y);
      [x, y] = [nextX, nextY];
    }
  });

  it('starts a new clue from its first position', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SegmentedSecretText text="CAT" />);
    vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS * 3);
    rerender(<SegmentedSecretText text="BOX" />);
    expect(screen.getByRole('img', { name: 'Secret clue: BOX' })).toHaveAttribute('data-motion-index', '0');
  });

  it('holds still, centred, when the viewer prefers reduced motion', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', query => ({
      matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {},
    }));
    render(<SegmentedSecretText text="CAT" />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS * 5);
    expect(card.style.transform).toBe('');
    expect(card).toHaveAttribute('data-motion-index', '0');
  });
});

describe('touching letter segments', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const clashes = container => [...container.querySelectorAll('.segmented-secret-text__glyph')].flatMap((glyph) => {
    const signal = [...glyph.querySelectorAll('polygon.is-signal')];
    return signal.flatMap(polygon => signal
      .filter(other => other !== polygon
        && SEGMENT_NEIGHBORS[polygon.dataset.segment].includes(other.dataset.segment)
        && colorOf(other) === colorOf(polygon))
      .map(other => `${polygon.dataset.segment}=${other.dataset.segment}`));
  });

  it('knows which segments touch, both ways', () => {
    expect(SEGMENT_NEIGHBORS.a1).toEqual(expect.arrayContaining(['a2', 'f']));
    expect(SEGMENT_NEIGHBORS.g1).toEqual(expect.arrayContaining(['g2', 'f', 'e']));
    expect(SEGMENT_NEIGHBORS.b).toContain('c');
    expect(SEGMENT_NEIGHBORS.a1).not.toContain('d1');
    for (const [name, neighbors] of Object.entries(SEGMENT_NEIGHBORS)) {
      for (const other of neighbors) expect(SEGMENT_NEIGHBORS[other]).toContain(name);
    }
  });

  it('never shows two touching letter segments in the same color, on first draw or after any change', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<SegmentedSecretText text="B8 SPHINX OF BLACK QUARTZ JUDGE MY VOW" />);
    expect(clashes(container)).toEqual([]);
    for (let tick = 0; tick < 30; tick += 1) {
      vi.advanceTimersByTime(FLICKER_TICK_MS);
      expect(clashes(container)).toEqual([]);
    }
    rerender(<SegmentedSecretText text="WAXING MOON HEIGHTS 2468" />);
    expect(clashes(container)).toEqual([]);
    for (let tick = 0; tick < 30; tick += 1) {
      vi.advanceTimersByTime(FLICKER_TICK_MS);
      expect(clashes(container)).toEqual([]);
    }
  });
});
