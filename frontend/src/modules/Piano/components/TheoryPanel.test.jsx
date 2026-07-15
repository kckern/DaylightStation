import { render, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TheoryPanel } from './TheoryPanel.jsx';

describe('TheoryPanel', () => {
  const notes = new Map([[60, {}], [64, {}], [67, {}]]);

  it.each(['row', 'column'])('renders circle, staff, and chord slots (%s layout)', (layout) => {
    const { container } = render(<TheoryPanel activeNotes={notes} layout={layout} />);
    expect(container.querySelector(`.theory-panel--${layout}`)).toBeTruthy();
    expect(container.querySelector('.theory-panel__circle .piano-circle-of-fifths')).toBeTruthy();
    expect(container.querySelector('.theory-panel__staff .chord-staff')).toBeTruthy();
    expect(container.querySelector('.theory-panel__chord .piano-chord-name')).toBeTruthy();
  });

  it('defaults to row layout', () => {
    const { container } = render(<TheoryPanel activeNotes={new Map()} />);
    expect(container.querySelector('.theory-panel--row')).toBeTruthy();
  });

  // Regression: the detected key is now owned by TheoryPanel (useDetectedKey) and
  // fed to BOTH the circle and the staff. Playing a clear G-major run must move
  // the circle off C — proving detection follows the music instead of re-seeding
  // 'C' each render. The circle's tonic marker (.cof-tonic) rotates to the tonic
  // slot's angle (C = 0°, G = 30°), a stable DOM signal for the active key.
  it('moves the circle off C when a G-major run is played (shared rolling key)', () => {
    const { container, rerender } = render(<TheoryPanel activeNotes={new Map()} />);

    // At rest the circle sits in C: tonic marker at 0°.
    expect(container.querySelector('.cof-tonic')?.getAttribute('transform'))
      .toMatch(/rotate\(0 /);

    // Stream G-major as sequential NEW notes, each at a distinct MIDI octave so
    // every step registers as a fresh note (only new notes advance the key).
    const gMajor = [7, 11, 2, 7, 11, 2, 9, 6, 4, 7];
    gMajor.forEach((pc, i) => {
      act(() => {
        rerender(<TheoryPanel activeNotes={new Map([[pc + 12 * i, {}]])} />);
      });
    });

    // Circle's tonic marker moved to G's slot (30°) — no longer C.
    const transform = container.querySelector('.cof-tonic')?.getAttribute('transform');
    expect(transform).toMatch(/rotate\(30 /);
    expect(transform).not.toMatch(/rotate\(0 /);
  });
});
