import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import LearnInkLayer from './LearnInkLayer.jsx';

// Two staves of one system, treble over bass — the grand-staff shape every Learn
// score has. lineSpacing 10 keeps the glyph arithmetic readable.
const BOXES = [
  { system: 0, staff: 0, top: 100, left: 50, right: 500, lineSpacing: 10 },
  { system: 0, staff: 1, top: 200, left: 50, right: 500, lineSpacing: 10 },
];
const CLEFS = { 0: { sign: 'G' }, 1: { sign: 'F' } };

afterEach(() => cleanup());

describe('LearnInkLayer (wave-3 D)', () => {
  it('renders one svg with a glyph per ink, kind-classed', () => {
    const inks = [
      { id: 1, midi: 61, staff: 0, system: 0, x: 120, kind: 'wrong' },
      { id: 2, midi: 40, staff: 1, system: 0, x: 160, kind: 'hit' },
    ];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
    expect(container.querySelectorAll('svg.piano-learn-ink')).toHaveLength(1);
    expect(container.querySelectorAll('.piano-learn-ink__note.is-wrong')).toHaveLength(1);
    expect(container.querySelectorAll('.piano-learn-ink__note.is-hit')).toHaveLength(1);
  });

  it('spells the wrong note in the sounding key (sharp head carries an accidental group)', () => {
    const inks = [{ id: 1, midi: 61, staff: 0, system: 0, x: 120, kind: 'wrong' }]; // C# in C major
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
    expect(container.querySelector('[data-acc="sharp"]')).not.toBeNull();
  });

  it('spells the SAME midi flat in a flat key (the sounding key drives the spelling)', () => {
    // Bb major (fifths -2) spells midi 70 as Bb, not A#.
    const inks = [{ id: 1, midi: 70, staff: 0, system: 0, x: 120, kind: 'wrong' }];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={-2} />);
    expect(container.querySelector('[data-acc="flat"]')).not.toBeNull();
    expect(container.querySelector('[data-acc="sharp"]')).toBeNull();
  });

  it('places an ink on the staff box its staff/system names', () => {
    const inks = [{ id: 1, midi: 60, staff: 1, system: 0, x: 160, kind: 'neutral' }];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
    const head = container.querySelector('.piano-learn-ink__head');
    expect(head).not.toBeNull();
    // Middle C on a bass staff (bottom line G2) sits ABOVE the staff → a y above
    // the bass box's top line (200), and never up in the treble box's band.
    expect(Number(head.getAttribute('cy'))).toBeLessThan(200);
    expect(Number(head.getAttribute('cy'))).toBeGreaterThan(BOXES[0].top + 40);
    expect(Number(head.getAttribute('cx'))).toBe(160);
  });

  it('skips inks whose staff box is missing (mid re-engrave)', () => {
    const inks = [{ id: 1, midi: 60, staff: 5, system: 0, x: 120, kind: 'wrong' }];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
    expect(container.querySelectorAll('.piano-learn-ink__note')).toHaveLength(0);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing when empty', () => {
    const { container } = render(<LearnInkLayer inks={[]} staffBoxes={BOXES} clefs={CLEFS} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing when no geometry has been reported yet', () => {
    const inks = [{ id: 1, midi: 60, staff: 0, system: 0, x: 120, kind: 'wrong' }];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={[]} clefs={CLEFS} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  // Ink marks are INDEPENDENT events (one per key strike), not a simultaneity, so
  // each stems by its own position — no group direction is imposed across them.
  it('stems each ink by its own position', () => {
    const inks = [
      { id: 1, midi: 60, staff: 0, system: 0, x: 120, kind: 'wrong' }, // C4 treble → below the middle line
      { id: 2, midi: 79, staff: 0, system: 0, x: 160, kind: 'hit' },   // G5 → above it
    ];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
    const [low, high] = [...container.querySelectorAll('.piano-learn-ink__stem')];
    expect(Number(low.getAttribute('y2'))).toBeLessThan(Number(low.getAttribute('y1')));      // up
    expect(Number(high.getAttribute('y2'))).toBeGreaterThan(Number(high.getAttribute('y1'))); // down
  });

  it('falls back to a sensible clef when none is reported for the staff', () => {
    const inks = [{ id: 1, midi: 40, staff: 1, system: 0, x: 120, kind: 'wrong' }];
    const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={{}} keyFifths={0} />);
    // E2 on a bass staff (bottom line G2 = position -2) → one ledger line below.
    expect(container.querySelectorAll('.piano-learn-ink__ledger').length).toBeGreaterThan(0);
    const head = container.querySelector('.piano-learn-ink__head');
    expect(Number(head.getAttribute('cy'))).toBeGreaterThan(BOXES[1].top + 40);
  });
});
