import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WetNoteGlyph } from './wetGlyphs.jsx';
import {
  staffPositionOf, stemDirectionFor, stemLengthUnits, MIDDLE_LINE, STEM_LEN_UNITS, STEM_MIN_UNITS,
} from './wetGlyphGeometry.js';

const STAVE = { top: 100, left: 50, right: 500, lineSpacing: 10 };
// Same derivation as PendingLayer.test.jsx: top line 100, bottom line 100 + 4*10.
const yAt = (position) => 140 - position * 5;

it('staffPositionOf matches PendingLayer conventions (treble E4 = 0, bass G2 = 0)', () => {
  expect(staffPositionOf({ step: 'E', octave: 4, alter: 0 }, { sign: 'G' })).toBe(0);
  expect(staffPositionOf({ step: 'G', octave: 2, alter: 0 }, { sign: 'F' })).toBe(0);
});

it('renders a prefixed head + stem for a middle-of-staff note', () => {
  const { container } = render(
    <svg><WetNoteGlyph x={120} staff={STAVE} clef={{ sign: 'G' }} pitch={{ step: 'B', octave: 4, alter: 0 }} classPrefix="piano-learn-ink" /></svg>,
  );
  expect(container.querySelector('.piano-learn-ink__head')).not.toBeNull();
  expect(container.querySelector('.piano-learn-ink__stem')).not.toBeNull();
});

it('draws ledger lines below the staff (C4 in treble → one ledger)', () => {
  const { container } = render(
    <svg><WetNoteGlyph x={120} staff={STAVE} clef={{ sign: 'G' }} pitch={{ step: 'C', octave: 4, alter: 0 }} /></svg>,
  );
  expect(container.querySelectorAll('.composer-wet-note__ledger')).toHaveLength(1);
});

describe('stemDirectionFor', () => {
  // position → direction, single notes. The middle line (4) stems DOWN: the rule
  // is "up below the middle line, down at or above it".
  it.each([
    [-9, 'up'], [-2, 'up'], [0, 'up'], [3, 'up'],
    [4, 'down'], [5, 'down'], [8, 'down'], [13, 'down'],
  ])('a lone note at position %i stems %s', (position, expected) => {
    expect(stemDirectionFor([position])).toBe(expected);
    expect(stemDirectionFor(position)).toBe(expected); // scalar convenience form
  });

  it.each([
    // [positions, expected, why]
    [[0, 5], 'up', 'position 0 is 4 out, position 5 only 1 — the low note decides'],
    [[3, 12], 'down', 'position 12 is 8 out, position 3 only 1 — the high note decides'],
    [[2, 6], 'down', 'symmetric straddle: a tie goes down'],
    [[4, 4], 'down', 'both on the middle line'],
    [[-6, 12], 'up', '-6 is 10 out, 12 only 8 — the low outlier still wins'],
    [[6, 7, 8], 'down', 'all above the middle line'],
    [[0, 1, 2], 'up', 'all below the middle line'],
  ])('a simultaneity at %j stems %s (%s)', (positions, expected) => {
    expect(stemDirectionFor(positions)).toBe(expected);
  });

  it('is order-independent', () => {
    expect(stemDirectionFor([5, 0])).toBe(stemDirectionFor([0, 5]));
    expect(stemDirectionFor([6, 2])).toBe(stemDirectionFor([2, 6]));
  });

  it('survives an empty or junk list without throwing', () => {
    expect(stemDirectionFor([])).toBe('down');
    expect(stemDirectionFor([undefined, null, NaN])).toBe('down');
    expect(stemDirectionFor([null, 0])).toBe('up'); // the one real position still decides
  });
});

describe('stemLengthUnits', () => {
  // Inside an octave of the middle line: the plain default, either direction.
  it.each([
    [MIDDLE_LINE, 'down'], [0, 'up'], [3, 'up'], [8, 'down'], [-3, 'up'], [11, 'down'],
  ])('keeps the %i-position stem at the default 3.5 spaces (%s)', (position, direction) => {
    expect(stemLengthUnits(position, direction)).toBe(STEM_LEN_UNITS);
  });

  // More than an octave (7 half-steps) out → reach the middle line. Positions are
  // half-steps, so the length in SPACES is half the distance.
  it.each([
    [-6, 'up', 5], [-9, 'up', 6.5], [13, 'down', 4.5], [20, 'down', 8],
  ])('extends the %i-position %s stem to %f spaces so it reaches the middle line', (position, direction, expected) => {
    expect(stemLengthUnits(position, direction)).toBeCloseTo(expected, 6);
  });

  // A group direction can point an outlier AWAY from the middle line (positions
  // [-6, 12] stem up together); extending there would shoot off the system.
  it('never extends a stem that points away from the middle line', () => {
    expect(stemLengthUnits(12, 'up')).toBe(STEM_LEN_UNITS);
    expect(stemLengthUnits(-6, 'down')).toBe(STEM_LEN_UNITS);
  });

  it('never returns anything shorter than the 2.5-space floor', () => {
    for (let p = -20; p <= 24; p++) {
      expect(stemLengthUnits(p, 'up')).toBeGreaterThanOrEqual(STEM_MIN_UNITS);
      expect(stemLengthUnits(p, 'down')).toBeGreaterThanOrEqual(STEM_MIN_UNITS);
    }
  });
});

describe('WetNoteGlyph stems', () => {
  const stemOf = (pitch, props = {}) => {
    const { container } = render(
      <svg><WetNoteGlyph x={120} staff={STAVE} clef={{ sign: 'G' }} pitch={pitch} {...props} /></svg>,
    );
    return container.querySelector('.composer-wet-note__stem');
  };

  it('reaches the middle line for a note well below the staff (position -6)', () => {
    const stem = stemOf({ step: 'F', octave: 3, alter: 0 });
    expect(Number(stem.getAttribute('y1'))).toBe(yAt(-6));
    expect(Number(stem.getAttribute('y2'))).toBeCloseTo(yAt(MIDDLE_LINE), 5);
  });

  it('stems the middle-line note (B4 in treble) down', () => {
    const stem = stemOf({ step: 'B', octave: 4, alter: 0 });
    expect(Number(stem.getAttribute('y2'))).toBeGreaterThan(Number(stem.getAttribute('y1')));
  });

  it('honours an explicit stemDirection override (a group direction)', () => {
    // C5 (position 5) would stem DOWN on its own; as part of an up-stemmed group
    // it must go up — and its stem is the default length, not extended.
    const stem = stemOf({ step: 'C', octave: 5, alter: 0 }, { stemDirection: 'up' });
    expect(Number(stem.getAttribute('y2'))).toBe(yAt(5) - 35);
    expect(Number(stem.getAttribute('x1'))).toBeGreaterThan(120); // flipped to the right side
  });

  it('ignores a junk stemDirection and falls back to the per-note rule', () => {
    const stem = stemOf({ step: 'C', octave: 5, alter: 0 }, { stemDirection: 'sideways' });
    expect(Number(stem.getAttribute('y2'))).toBeGreaterThan(Number(stem.getAttribute('y1'))); // down
  });
});
