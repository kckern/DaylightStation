import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WetNoteGlyph, staffPositionOf } from './wetGlyphs.jsx';

const STAVE = { top: 100, left: 50, right: 500, lineSpacing: 10 };

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
