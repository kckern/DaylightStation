// ExerciseNotation.component.test.jsx — the wrapper's own render decision:
// nothing painted when instanceToAbc has nothing to say. AbcRenderer is mocked
// out (it's abcjs's job to draw a tune, not this component's) so this test
// stays about ExerciseNotation's own branch, not abcjs's SVG output.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExerciseNotation, { ExercisePreview } from './ExerciseNotation.jsx';

vi.mock('../../../../MusicNotation/renderers/AbcRenderer.jsx', () => ({
  AbcRenderer: ({ abc }) => <div data-testid="abc-renderer" data-abc={abc} />,
}));

const base = {
  key: 'C',
  meter: '4/4',
  ordering: 'strict',
  events: [{ notes: [{ midi: 60, hand: 'right' }] }],
};

describe('ExerciseNotation', () => {
  it('renders the AbcRenderer for material instanceToAbc can draw', () => {
    const { container, getByTestId } = render(<ExerciseNotation instance={base} />);
    expect(getByTestId('abc-renderer')).toBeInTheDocument();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders nothing — not even an empty AbcRenderer — for ordering:any material', () => {
    const { container, queryByTestId } = render(<ExerciseNotation instance={{ ...base, ordering: 'any' }} />);
    expect(queryByTestId('abc-renderer')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });
});

/**
 * The browser's preview card. `instanceToAbc` answers `''` for `ordering:'any'`
 * and `ExerciseNotation` then renders `null`, so the card was BLANK for every
 * unordered instance the bank publishes — `chords/*`, `intervals/all`,
 * `notes/single`, 1,128 of them — which reads as an exercise with no music in
 * it. The sequence staff draws them; ordered material keeps the ABC it had.
 */
describe('ExercisePreview', () => {
  const triad = {
    ...base,
    ordering: 'any',
    key: 'C',
    axes: { root: 'C', quality: 'major' },
    events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 64, hand: 'right' }, { midi: 67, hand: 'right' }] }],
  };

  it('draws a triad as one staff column of three noteheads', () => {
    const { container, queryByTestId } = render(<ExercisePreview instance={triad} />);
    expect(queryByTestId('abc-renderer')).not.toBeInTheDocument();
    const staff = container.querySelector('.sequence-staff');
    expect(staff).not.toBeNull();
    // ONE column — a chord is one simultaneity, not three asks in a row.
    expect(container.querySelectorAll('.action-staff__note-group')).toHaveLength(1);
    expect([...container.querySelectorAll('.action-staff__note')].map((n) => n.getAttribute('data-midi')))
      .toEqual(['60', '64', '67']);
    // No cursor: nothing is being played, so there is no "next note" to mark.
    expect(container.querySelector('.sequence-staff__cursor')).toBeNull();
  });

  it('spells a preview off the key the instance is actually in, not the root alone', () => {
    // A C minor triad. The bank writes `key` as the root ('C') and the quality
    // on an axis, so the root alone reads as C major and the staff's own
    // default spells the E♭ as D♯ — a wrong letter on the one card a child
    // reads letters from. `instanceKeySignature` walks it back to E♭ major.
    const { container } = render(<ExercisePreview instance={{
      ...triad,
      key: 'C',
      axes: { root: 'C', quality: 'minor' },
      events: [{ notes: [{ midi: 60, hand: 'right' }, { midi: 63, hand: 'right' }, { midi: 67, hand: 'right' }] }],
    }} />);
    const accidentals = [...container.querySelectorAll('.action-staff__accidental')];
    expect(accidentals.map((glyph) => glyph.getAttribute('data-kind'))).toEqual(['flat']);
  });

  it('keeps the ABC card for ordered material', () => {
    const { getByTestId, container } = render(<ExercisePreview instance={base} />);
    expect(getByTestId('abc-renderer')).toBeInTheDocument();
    expect(container.querySelector('.sequence-staff')).toBeNull();
  });

  it('renders nothing for an instance with no events at all', () => {
    const { container } = render(<ExercisePreview instance={{ ...triad, events: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
