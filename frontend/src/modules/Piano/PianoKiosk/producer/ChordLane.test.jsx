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
});
