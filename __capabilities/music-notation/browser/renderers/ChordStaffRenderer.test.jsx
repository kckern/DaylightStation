import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Stroke } from 'vexflow';
import { ChordStaffRenderer } from './ChordStaffRenderer.jsx';

// The engrave effect is keyed on what is drawn. Roll strokes are drawn from each
// column's arrivals, so a flow with the SAME pitches and durations but different
// arrivals is a different picture and must re-engrave — or a stroke sticks to the
// slot it was first drawn in (a repeated chord at capacity scrolls with an identical
// pitch key every time).
describe('ChordStaffRenderer — roll strokes are part of what is drawn', () => {
  // jsdom has no layout: report a wide sidebar box (aspect 2.8) so the staff draws
  // several slots, not the single slot of a box it could not measure.
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { this.cb = cb; }
      observe() { this.cb([{ contentRect: { width: 980, height: 350 } }]); }
      disconnect() {}
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const C = [60, 64, 67];
  const rolled = C.map((midi, k) => ({ midi, at: 1000 + k * 60 }));
  const struck = (t) => C.map((midi) => ({ midi, at: t }));
  const col = (arrivals) => ({ midis: C, duration: 'q', arrivals });

  it('re-engraves when only the arrivals change: the stroke moves with its column, then goes', () => {
    const drawn = [];
    vi.spyOn(Stroke.prototype, 'draw').mockImplementation(function draw() {
      drawn.push(Math.round(this.getNote().getTickContext().getX()));
    });
    const strokes = () => drawn.splice(0);

    // Mounting engraves twice (before and after the box is measured), so read the
    // stroke the LAST engrave drew.
    const { rerender } = render(<ChordStaffRenderer columns={[col(rolled), col(struck(2000))]} />);
    const first = strokes().slice(-1);
    expect(first).toHaveLength(1);

    // Same pitches and durations; the roll is now on the second column.
    rerender(<ChordStaffRenderer columns={[col(struck(1000)), col(rolled)]} />);
    const second = strokes();
    expect(second).toHaveLength(1);
    expect(second[0]).toBeGreaterThan(first[0]);

    // And scrolled off entirely: no stroke left anywhere.
    rerender(<ChordStaffRenderer columns={[col(struck(1000)), col(struck(2000))]} />);
    // Re-engraved (the SVG was redrawn) with no stroke on it.
    expect(strokes()).toEqual([]);
  });

  it('does not re-engrave when arrival times change but every staff verdict is the same', () => {
    const { container, rerender } = render(<ChordStaffRenderer columns={[col(rolled)]} />);
    const svg = container.querySelector('svg');
    const later = C.map((midi, k) => ({ midi, at: 5000 + k * 70 }));
    rerender(<ChordStaffRenderer columns={[col(later)]} />);
    expect(container.querySelector('svg')).toBe(svg);
  });
});
