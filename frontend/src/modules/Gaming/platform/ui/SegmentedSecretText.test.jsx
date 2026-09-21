import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SegmentedSecretText, { balanceSecretLines } from './SegmentedSecretText.jsx';
import { activeSegmentsFor, SEGMENTS, SEGMENT_NEIGHBORS } from './segmentedSecretGeometry.js';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from './segmentedSecretPalette.js';
import { SECRET_TEXT_MOTION_MS, SECRET_TEXT_MOTION_X, SECRET_TEXT_MOTION_Y } from './segmentedSecretMotion.js';
import { DECODER_DEFAULTS } from './segmentedSecretReveal.js';

const SIGNAL = new Set(SIGNAL_SEGMENT_COLORS.map(segmentColorValue));
const MASK = new Set(MASK_SEGMENT_COLORS.map(segmentColorValue));
const colorOf = polygon => polygon.style.getPropertyValue('--segment-color');
const inOwnFamily = polygon => (polygon.classList.contains('is-signal') ? SIGNAL : MASK).has(colorOf(polygon));
const STATIC = { reveal: 'static' };
const PROGRESSIVE = { reveal: 'progressive' };
const STEP = DECODER_DEFAULTS.stepMs;

// Which segments a cell has lit warm, sorted, so a frame can be compared to a letter.
const litOf = glyph => [...glyph.querySelectorAll('polygon.is-signal')].map(polygon => polygon.dataset.segment).sort();
const letterOf = character => [...activeSegmentsFor(character)].sort();
const CURSOR = ['d1', 'd2'];
const glyphsOf = container => [...container.querySelectorAll('.segmented-secret-text__glyph')];
// A frame as text, read the way a person with the red card would: each cell
// becomes whichever of the clue's own letters its lit segments spell, '_' for
// the cursor, '·' for a cell showing nothing, '?' for anything else. Reading by
// shape rather than by position is what lets a scrolled letter be recognised in
// a cell that is not its own.
const picture = (container, text) => glyphsOf(container).map((glyph) => {
  const lit = litOf(glyph).join();
  if (lit === '') return '·';
  const letter = [...new Set(text)].find(character => character.trim() && letterOf(character).join() === lit);
  if (letter) return letter;
  return lit === CURSOR.join() ? '_' : '?';
}).join('');

const clashes = container => glyphsOf(container).flatMap((glyph) => {
  const signal = [...glyph.querySelectorAll('polygon.is-signal')];
  return signal.flatMap(polygon => signal
    .filter(other => other !== polygon
      && SEGMENT_NEIGHBORS[polygon.dataset.segment].includes(other.dataset.segment)
      && colorOf(other) === colorOf(polygon))
    .map(other => `${polygon.dataset.segment}=${other.dataset.segment}`));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SegmentedSecretText', () => {
  it('renders spaces as full masked glyphs so word boundaries are hidden without the decoder', () => {
    const { container } = render(<SegmentedSecretText text="Moon walk" decoder={STATIC} />);
    expect(screen.getByRole('img', { name: 'Secret clue: MOON WALK' })).toBeInTheDocument();
    const glyphs = glyphsOf(container);
    expect(glyphs).toHaveLength(9);
    expect(glyphs.every(glyph => glyph.querySelectorAll('polygon').length === 16)).toBe(true);
    expect(glyphs[4].querySelectorAll('polygon.is-signal')).toHaveLength(0);
    expect(glyphs[4].querySelectorAll('polygon.is-mask')).toHaveLength(16);
    expect(container.querySelectorAll('.segmented-secret-text__space, .segmented-secret-text__word-gap')).toHaveLength(0);
  });

  it('keeps the original per-glyph signal and mask interference', () => {
    const { container } = render(<SegmentedSecretText text="CAT" decoder={STATIC} />);
    expect(glyphsOf(container)).toHaveLength(3);
    expect(container.querySelectorAll('polygon.is-signal').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('polygon.is-mask').length).toBeGreaterThan(0);
    expect(container.querySelector('.segmented-secret-text__field')).toBeNull();
  });

  it('varies mask colors at the same segment position across glyphs', () => {
    const { container } = render(<SegmentedSecretText text="AAAA" decoder={PROGRESSIVE} />);
    const colors = [...container.querySelectorAll('[data-segment="d1"]')].map(colorOf);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('balances multi-line clues at word boundaries and trims only line-edge spaces', () => {
    expect(balanceSecretLines('BLOWING UP A BALLOON')).toEqual(['BLOWING UP', 'A BALLOON']);
    expect(balanceSecretLines('LOOKING THROUGH BINOCULARS')).toEqual(['LOOKING THROUGH', 'BINOCULARS']);
    expect(balanceSecretLines('BUILDING A SAND CASTLE').every(line => line === line.trim())).toBe(true);
    const { container } = render(<SegmentedSecretText text="Blowing up a balloon" decoder={PROGRESSIVE} />);
    expect(container.querySelectorAll('.segmented-secret-text__line')).toHaveLength(2);
    expect(glyphsOf(container)).toHaveLength(19);
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

describe('the defaults', () => {
  it('scroll as a marquee, one step every 100ms', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" />);
    expect(screen.getByRole('img', { name: 'Secret clue: CAT' })).toHaveAttribute('data-reveal', 'marquee');
    expect(STEP).toBe(100);
    const seen = [picture(container, 'CAT')];
    for (let step = 1; step <= 3; step += 1) {
      vi.advanceTimersByTime(STEP);
      seen.push(picture(container, 'CAT'));
    }
    expect(seen).toEqual(['···', '··C', '·CA', 'CAT']);
  });

  it('hold the clue fully visible for one second before it scrolls out', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" />);
    vi.advanceTimersByTime(STEP * 3);
    expect(picture(container, 'CAT')).toBe('CAT');
    vi.advanceTimersByTime(1000);
    expect(picture(container, 'CAT')).toBe('CAT');
    vi.advanceTimersByTime(STEP);
    expect(picture(container, 'CAT')).toBe('AT·');
  });

  it('jump the card on every step, in sync with the scroll', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="CAT" />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    const indices = [card.dataset.motionIndex];
    for (let step = 1; step <= 4; step += 1) {
      vi.advanceTimersByTime(STEP);
      indices.push(card.dataset.motionIndex);
    }
    expect(indices).toEqual(['0', '1', '2', '3', '4']);
  });
});

describe('progressive reveal', () => {
  it('first paints only the cursor — the clue never flashes up before the typing starts', () => {
    const { container } = render(<SegmentedSecretText text="CAT" decoder={PROGRESSIVE} />);
    expect(screen.getByRole('img', { name: 'Secret clue: CAT' })).toHaveAttribute('data-reveal', 'progressive');
    expect(picture(container, 'CAT')).toBe('_··');
    expect(litOf(glyphsOf(container)[0])).toEqual(CURSOR);
  });

  it('types one character every step, then hides first-to-last, then loops', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" decoder={PROGRESSIVE} />);
    const seen = [picture(container, 'CAT')];
    for (let step = 1; step <= 7; step += 1) {
      vi.advanceTimersByTime(STEP);
      seen.push(picture(container, 'CAT'));
    }
    expect(seen).toEqual(['_··', 'C_·', 'CA_', 'CAT', '·AT', '··T', '···', '_··']);
  });

  it('keeps every cell fully lit — a hidden letter is mask color, never a blank cell', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" decoder={PROGRESSIVE} />);
    for (let step = 0; step < 8; step += 1) {
      for (const glyph of glyphsOf(container)) {
        expect(glyph.querySelectorAll('polygon.is-signal').length + glyph.querySelectorAll('polygon.is-mask').length).toBe(16);
      }
      vi.advanceTimersByTime(STEP);
    }
  });

  it('reshuffles every segment each step, each within its current family', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="MOON WALK" decoder={PROGRESSIVE} />);
    const polygons = [...container.querySelectorAll('polygon')];
    let previous = polygons.map(colorOf);
    vi.advanceTimersByTime(STEP - 1);
    expect(polygons.map(colorOf)).toEqual(previous);
    for (let step = 1; step <= 6; step += 1) {
      vi.advanceTimersByTime(step === 1 ? 1 : STEP);
      polygons.forEach((polygon, index) => {
        expect(colorOf(polygon)).not.toBe(previous[index]);
        expect(inOwnFamily(polygon)).toBe(true);
      });
      previous = polygons.map(colorOf);
    }
  });

  it('jumps the card once per motion interval — every fourth step when a rules file says so', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="CAT" decoder={{ reveal: 'progressive', step_ms: 250, motion_ms: 1000 }} />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    const indices = [card.dataset.motionIndex];
    for (let step = 1; step <= 8; step += 1) {
      vi.advanceTimersByTime(250);
      indices.push(card.dataset.motionIndex);
    }
    expect(indices).toEqual(['0', '0', '0', '0', '1', '1', '1', '1', '2']);
  });

  it('holds the card still when motion is turned off', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="CAT" decoder={{ motion: false }} />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    vi.advanceTimersByTime(STEP * 12);
    expect(card.style.transform).toBe('');
  });

  it('follows the step length a rules file sets', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="CAT" decoder={{ reveal: 'progressive', step_ms: 500 }} />);
    vi.advanceTimersByTime(250);
    expect(picture(container, 'CAT')).toBe('_··');
    vi.advanceTimersByTime(250);
    expect(picture(container, 'CAT')).toBe('C_·');
  });
});

describe('marquee', () => {
  it('scrolls right to left: in from the right, held, out to the left, then a gap', () => {
    vi.useFakeTimers();
    const decoder = { reveal: 'marquee', marquee_hold_steps: 2, marquee_gap_steps: 1 };
    const { container } = render(<SegmentedSecretText text="CAT" decoder={decoder} />);
    const seen = [picture(container, 'CAT')];
    for (let step = 1; step <= 10; step += 1) {
      vi.advanceTimersByTime(STEP);
      seen.push(picture(container, 'CAT'));
    }
    expect(seen).toEqual([
      '···', '··C', '·CA', 'CAT', // in from the right
      'CAT', 'CAT',               // held
      'AT·', 'T··', '···',        // out to the left
      '···',                      // gap
      '···',                      // round again: the first frame of the next pass
    ]);
  });

  it('never shows two touching letter segments in the same color while scrolling', () => {
    vi.useFakeTimers();
    const { container } = render(<SegmentedSecretText text="B8 SPHINX OF BLACK QUARTZ" decoder={{ reveal: 'marquee' }} />);
    for (let step = 0; step < 60; step += 1) {
      expect(clashes(container)).toEqual([]);
      vi.advanceTimersByTime(STEP);
    }
  });
});

describe('static', () => {
  it('is completely inert when reveal, motion, and color animation are disabled', () => {
    vi.useFakeTimers();
    const decoder = { reveal: 'static', motion: false, color_animation: false };
    const { container, rerender } = render(<SegmentedSecretText text="CAT" decoder={decoder} />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    const polygons = [...container.querySelectorAll('polygon')];
    const colors = polygons.map(colorOf);
    expect(picture(container, 'CAT')).toBe('CAT');
    expect(card.style.transform).toBe('');
    expect(card).toHaveAttribute('data-reveal-step', '0');
    expect(card).toHaveAttribute('data-motion-index', '0');
    vi.advanceTimersByTime(60_000);
    expect(polygons.map(colorOf)).toEqual(colors);
    expect(card.style.transform).toBe('');
    expect(card).toHaveAttribute('data-reveal-step', '0');
    expect(card).toHaveAttribute('data-motion-index', '0');

    rerender(<SegmentedSecretText text="BOX" decoder={decoder} />);
    const changed = screen.getByRole('img', { name: 'Secret clue: BOX' });
    const changedColors = [...changed.querySelectorAll('polygon')].map(colorOf);
    expect(picture(container, 'BOX')).toBe('BOX');
    vi.advanceTimersByTime(60_000);
    expect([...changed.querySelectorAll('polygon')].map(colorOf)).toEqual(changedColors);
  });

  it('recolors every segment on the same tick the card jumps, each within its own family', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="CAT" decoder={STATIC} />);
    const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
    const polygons = [...card.querySelectorAll('polygon')];
    let previous = polygons.map(colorOf);
    expect(polygons.every(inOwnFamily)).toBe(true);
    vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS - 1);
    expect(polygons.map(colorOf)).toEqual(previous);
    expect(card).toHaveAttribute('data-motion-index', '0');
    for (let tick = 1; tick <= 4; tick += 1) {
      vi.advanceTimersByTime(tick === 1 ? 1 : SECRET_TEXT_MOTION_MS);
      expect(card).toHaveAttribute('data-motion-index', String(tick));
      polygons.forEach((polygon, index) => {
        expect(colorOf(polygon)).not.toBe(previous[index]);
        expect(inOwnFamily(polygon)).toBe(true);
      });
      previous = polygons.map(colorOf);
    }
  });

  it('never leaves a segment in the wrong family when the clue changes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<SegmentedSecretText text="CAT" decoder={STATIC} />);
    vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS * 7);
    rerender(<SegmentedSecretText text="BOX" decoder={STATIC} />);
    expect([...container.querySelectorAll('polygon')].every(inOwnFamily)).toBe(true);
  });
});

describe('position jump', () => {
  const offsets = card => card.style.transform.match(/^translate3d\((-?[\d.]+)%, (-?[\d.]+)%, 0(?:px)?\)$/)?.slice(1).map(Number);

  it('moves the whole card to the opposite edge every motion interval, inside its margin', () => {
    vi.useFakeTimers();
    render(<SegmentedSecretText text="Moon walk" decoder={STATIC} />);
    const card = screen.getByRole('img', { name: 'Secret clue: MOON WALK' });
    expect(card).toHaveAttribute('data-motion-index', '0');
    let [x] = offsets(card);
    for (let tick = 1; tick <= 9; tick += 1) {
      vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS);
      expect(card).toHaveAttribute('data-motion-index', String(tick % 8));
      const [nextX, nextY] = offsets(card);
      expect(Math.sign(nextX)).toBe(-Math.sign(x));
      expect(Math.abs(nextX)).toBeLessThanOrEqual(SECRET_TEXT_MOTION_X);
      expect(Math.abs(nextY)).toBeLessThanOrEqual(SECRET_TEXT_MOTION_Y);
      x = nextX;
    }
  });

  it('starts a new clue from its first position', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SegmentedSecretText text="CAT" decoder={STATIC} />);
    vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS * 3);
    rerender(<SegmentedSecretText text="BOX" decoder={STATIC} />);
    expect(screen.getByRole('img', { name: 'Secret clue: BOX' })).toHaveAttribute('data-motion-index', '0');
  });
});

describe('reduced motion', () => {
  const reduce = () => vi.stubGlobal('matchMedia', query => ({
    matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {},
  }));

  it('shows the whole clue, centred and still, in every mode', () => {
    for (const reveal of ['progressive', 'marquee', 'static']) {
      vi.useFakeTimers();
      reduce();
      const { container, unmount } = render(<SegmentedSecretText text="CAT" decoder={{ reveal }} />);
      const card = screen.getByRole('img', { name: 'Secret clue: CAT' });
      const polygons = [...container.querySelectorAll('polygon')];
      const initial = polygons.map(colorOf);
      expect(picture(container, 'CAT'), reveal).toBe('CAT');
      vi.advanceTimersByTime(SECRET_TEXT_MOTION_MS * 5);
      expect(polygons.map(colorOf), reveal).toEqual(initial);
      expect(card.style.transform).toBe('');
      expect(card).toHaveAttribute('data-motion-index', '0');
      unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('touching letter segments', () => {
  it('knows which segments touch, both ways', () => {
    expect(SEGMENT_NEIGHBORS.a1).toEqual(expect.arrayContaining(['a2', 'f']));
    expect(SEGMENT_NEIGHBORS.g1).toEqual(expect.arrayContaining(['g2', 'f', 'e']));
    expect(SEGMENT_NEIGHBORS.b).toContain('c');
    expect(SEGMENT_NEIGHBORS.a1).not.toContain('d1');
    for (const [name, neighbors] of Object.entries(SEGMENT_NEIGHBORS)) {
      for (const other of neighbors) expect(SEGMENT_NEIGHBORS[other]).toContain(name);
    }
  });

  it('never shows two touching letter segments in the same color, in any mode, on first draw or after any step', () => {
    for (const reveal of ['progressive', 'static']) {
      vi.useFakeTimers();
      const step = reveal === 'static' ? SECRET_TEXT_MOTION_MS : STEP;
      const { container, rerender, unmount } = render(<SegmentedSecretText text="B8 SPHINX OF BLACK QUARTZ JUDGE MY VOW" decoder={{ reveal }} />);
      expect(clashes(container), reveal).toEqual([]);
      for (let tick = 0; tick < 40; tick += 1) {
        vi.advanceTimersByTime(step);
        expect(clashes(container), reveal).toEqual([]);
      }
      rerender(<SegmentedSecretText text="WAXING MOON HEIGHTS 2468" decoder={{ reveal }} />);
      expect(clashes(container), reveal).toEqual([]);
      for (let tick = 0; tick < 40; tick += 1) {
        vi.advanceTimersByTime(step);
        expect(clashes(container), reveal).toEqual([]);
      }
      unmount();
      vi.useRealTimers();
    }
  });
});
