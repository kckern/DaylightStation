import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChordLane, cumulativeBounds } from './ChordLane.jsx';

const bundle = { notes: [{ ticks: 0, durationTicks: 4, midi: 60 }], ppq: 4, barSpan: 4 };

/** Which chord is active at fraction `frac` under these bounds (mirrors the
 *  rAF frame's findIndex). */
const activeAt = (bounds, count, frac) => {
  const i = bounds.findIndex((edge) => frac < edge);
  return i < 0 ? count - 1 : i;
};

describe('ChordLane', () => {
  it('renders a slot per chord (with its Roman glyph) plus a sweeping cursor', () => {
    const { container } = render(<ChordLane roman={['I', 'IV', 'V', 'I']} notesBundle={bundle} />);
    expect(container.querySelectorAll('.piano-chord-lane__slot').length).toBe(4);
    expect(container.querySelectorAll('.roman-chord').length).toBe(4);
    expect(container.querySelector('.piano-chord-lane__cursor')).toBeTruthy();
  });

  it('renders nothing without chords', () => {
    const { container } = render(<ChordLane roman={[]} notesBundle={bundle} />);
    expect(container.querySelector('.piano-chord-lane')).toBeNull();
  });

  it('keeps the cursor hidden while stopped', () => {
    const { container } = render(<ChordLane roman={['I']} notesBundle={bundle} isPlaying={false} />);
    expect(container.querySelector('.piano-chord-lane__cursor').style.opacity).toBe('0');
  });

  it('shows keyed chord names above the Roman when tonicPc is given (design §7)', () => {
    // tonic D (pc 2): I→D, IV→G, V→A, vi→Bm
    const { container } = render(
      <ChordLane roman={['I', 'IV', 'V', 'vi']} notesBundle={bundle} tonicPc={2} />,
    );
    const keyed = [...container.querySelectorAll('.piano-chord-lane__keyed')].map((n) => n.textContent);
    expect(keyed).toEqual(['D', 'G', 'A', 'Bm']);
  });

  it('omits keyed names in the abstract (no tonicPc) — Roman only', () => {
    const { container } = render(<ChordLane roman={['I', 'IV']} notesBundle={bundle} />);
    expect(container.querySelector('.piano-chord-lane__keyed')).toBeNull();
  });

  it('keyed names ride on top of duration-proportional slots (both merged features)', () => {
    const { container } = render(
      <ChordLane roman={['I', 'V']} durations={[6, 2]} notesBundle={bundle} tonicPc={2} />,
    );
    const slots = container.querySelectorAll('.piano-chord-lane__slot');
    expect(slots[0].style.flexGrow).toBe('6');
    expect([...container.querySelectorAll('.piano-chord-lane__keyed')].map((n) => n.textContent)).toEqual(['D', 'A']);
  });

  it('sizes slots proportionally to durations (uneven progression); equal when absent', () => {
    const { container: even } = render(<ChordLane roman={['I', 'V']} notesBundle={bundle} />);
    // No durations → no inline flexGrow (CSS default equal widths).
    expect([...even.querySelectorAll('.piano-chord-lane__slot')].every((s) => !s.style.flexGrow)).toBe(true);
    // durations [6,2] → the I slot grows 3× the V slot.
    const { container } = render(<ChordLane roman={['I', 'V']} durations={[6, 2]} notesBundle={bundle} />);
    const slots = container.querySelectorAll('.piano-chord-lane__slot');
    expect(slots[0].style.flexGrow).toBe('6');
    expect(slots[1].style.flexGrow).toBe('2');
  });

  it('cumulativeBounds maps the playhead to the RIGHT chord on an uneven progression', () => {
    // I lasts 6 of 8 slots, V the last 2 → boundary at 0.75.
    const bounds = cumulativeBounds([6, 2], 2);
    expect(bounds).toEqual([0.75, 1]);
    expect(activeAt(bounds, 2, 0.0)).toBe(0); // start of I
    expect(activeAt(bounds, 2, 0.74)).toBe(0); // still I just before the boundary
    expect(activeAt(bounds, 2, 0.75)).toBe(1); // V begins exactly at 0.75
    expect(activeAt(bounds, 2, 0.99)).toBe(1); // end of V
    // An EVEN highlighter (floor(frac*count)) would wrongly flip to V at 0.5 —
    // this is the bug the braille durations fix.
    expect(Math.floor(0.6 * 2)).toBe(1);
    expect(activeAt(bounds, 2, 0.6)).toBe(0); // correct: still I at 60%
  });

  it('cumulativeBounds returns null when durations do not match the chord count', () => {
    expect(cumulativeBounds(null, 3)).toBeNull();
    expect(cumulativeBounds([1, 2], 3)).toBeNull();
    expect(cumulativeBounds([0, 0], 2)).toBeNull(); // zero total
  });

  it('a repeating progression (cycles>1) wraps the playhead within one cycle', () => {
    // Two equal chords, one 4-beat cycle, loop repeats it twice (cycles=2).
    const bounds = cumulativeBounds([2, 2], 2); // [0.5, 1]
    const cyc = 2;
    const wrap = (loopFrac) => ((loopFrac * cyc) % 1); // mirrors the rAF frame
    // 60% through the loop = 20% into the SECOND cycle → still chord I (0).
    expect(activeAt(bounds, 2, wrap(0.6))).toBe(0);
    // 30% through the loop = 60% into the FIRST cycle → chord V (1).
    expect(activeAt(bounds, 2, wrap(0.3))).toBe(1);
  });

  it('accepts a cycles prop without breaking render', () => {
    const { container } = render(
      <ChordLane roman={['I', 'V']} durations={[2, 2]} cycles={2} notesBundle={bundle} />,
    );
    expect(container.querySelectorAll('.piano-chord-lane__slot').length).toBe(2);
  });
});
